"""JD document upload endpoint — B-032.

Contract:
  POST /jobs/{job_id}/jd-document → 200 JdUploadResponse | 400 | 401 | 404

Accepts a PDF upload (multipart/form-data), extracts plain text via pypdf,
stores the file in S3/R2, and writes jd_text + jd_s3_key to the jobs row.

Any authenticated user may upload (admin-level role restriction is deferred
to post-MVP role-based access control).
"""

from __future__ import annotations

import asyncio
import io
import uuid
from typing import Annotated

import structlog
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from pydantic import BaseModel
from pypdf import PdfReader
from shared.auth.base import User
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.database import get_db_session
from app.dependencies import get_current_user
from app.models import Job
from app.s3_upload import upload_file

log = structlog.get_logger(__name__)

router = APIRouter(prefix="/jobs", tags=["jd"])

# ---------------------------------------------------------------------------
# Dependency shortcuts
# ---------------------------------------------------------------------------
CurrentUserDep = Annotated[User, Depends(get_current_user)]
DbSessionDep = Annotated[AsyncSession, Depends(get_db_session)]

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_MAX_JD_BYTES = 10 * 1024 * 1024  # 10 MB


# ---------------------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------------------


class JdUploadResponse(BaseModel):
    """Response body for a successful JD document upload."""

    message: str
    jd_s3_key: str
    text_length: int


# ---------------------------------------------------------------------------
# Endpoint
# ---------------------------------------------------------------------------


@router.post(
    "/{job_id}/jd-document",
    status_code=status.HTTP_200_OK,
    response_model=JdUploadResponse,
    summary="Upload a PDF job description for a job role (B-032)",
    description=(
        "Accepts a PDF file (multipart/form-data field name: `file`). "
        "Extracts plain text, stores the file in R2/S3, and updates the job record. "
        "Maximum file size: 10 MB. Returns 404 if the job does not exist."
    ),
)
async def upload_jd_document(
    job_id: uuid.UUID,
    file: UploadFile,
    current_user: CurrentUserDep,
    db: DbSessionDep,
) -> JdUploadResponse:
    """Upload a JD PDF and persist the extracted text + S3 key.

    Steps:
    1. Validate content-type is application/pdf.
    2. Read bytes and enforce 10 MB size cap.
    3. Verify the job exists (active, not soft-deleted).
    4. Extract text with pypdf.
    5. Upload to S3 at key ``jd-documents/{job_id}.pdf``.
    6. Persist ``jd_text`` and ``jd_s3_key`` on the jobs row.
    """
    # --- 1. content-type check ---
    if file.content_type != "application/pdf":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only PDF files are accepted for JD document upload.",
        )

    # --- 2. read + size check ---
    # A mid-upload client disconnect / spooled temp OSError must not escape as
    # an unhandled, CORS-less 500.
    try:
        raw: bytes = await file.read()
    except Exception as exc:
        log.warning("jd.upload.read_failed", error_type=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read the uploaded file. Please try again.",
        ) from exc
    if len(raw) > _MAX_JD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="JD document must be under 10 MB.",
        )

    # --- 3. job existence check ---
    stmt = select(Job).where(
        Job.id == job_id,
        Job.is_active.is_(True),
        Job.deleted_at.is_(None),
    )
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()

    if job is None:
        log.info(
            "jd.upload.job_not_found",
            job_id=str(job_id),
            user_id=current_user.user_id,
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found.",
        )

    # --- 4. text extraction (off the event loop — CVE-2025-62707 + DoS guard) ---
    # pypdf is synchronous and CPU-bound. Running it via asyncio.to_thread with a
    # hard timeout prevents a crafted PDF from blocking the event loop.
    # CVE-2025-62707 is fixed in pypdf>=6.1.1 (pinned in requirements.txt);
    # the to_thread wrapper is defence-in-depth.
    try:
        text_content = await _extract_pdf_text(raw)
    except TimeoutError as exc:
        log.warning(
            "jd.upload.pdf_parse_timeout",
            timeout_seconds=_PDF_PARSE_TIMEOUT_SECONDS,
        )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The PDF took too long to process. Please try a simpler file.",
        ) from exc
    except Exception as exc:
        log.warning("jd.upload.pdf_parse_failed", error_type=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not read the PDF. Please upload a valid, unencrypted PDF file.",
        ) from exc

    # --- 5. S3 upload ---
    # Convert storage failures (bad credentials, unreachable endpoint) to a 502
    # so they reach the browser WITH CORS headers, instead of escaping as an
    # unhandled 500 that surfaces as a misleading "Network error".
    key = f"jd-documents/{job_id}.pdf"
    try:
        await upload_file(
            bucket=settings.s3_bucket_name,
            key=key,
            data=raw,
            content_type="application/pdf",
            settings=settings,
        )
    except (BotoCoreError, ClientError) as exc:
        log.error(
            "jd.upload.storage_failed",
            job_id=str(job_id),
            s3_key=key,
            error_type=type(exc).__name__,
            error=str(exc),
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Document storage is currently unavailable. Please try again later.",
        ) from exc

    # --- 6. DB update ---
    # The JD object lives at a deterministic key (overwritten on each upload), so
    # a failed DB write leaves no true orphan. Convert the failure to a 503
    # (CORS-decorated) rather than letting it escape as an unhandled 500.
    try:
        await db.execute(
            text(
                "UPDATE jobs SET jd_text = :jd_text, "
                "jd_s3_key = :jd_s3_key, updated_at = now() "
                "WHERE id = :jid"
            ),
            {
                "jd_text": text_content,
                "jd_s3_key": key,
                "jid": job_id,
            },
        )
        await db.commit()
    except Exception as db_exc:
        log.error(
            "jd.upload.db_write_failed",
            job_id=str(job_id),
            s3_key=key,
            error_type=type(db_exc).__name__,
            error=str(db_exc),
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not save the job description. Please try again.",
        ) from db_exc

    log.info(
        "jd.upload.ok",
        job_id=str(job_id),
        user_id=current_user.user_id,
        s3_key=key,
        text_length=len(text_content),
    )

    return JdUploadResponse(
        message="JD uploaded",
        jd_s3_key=key,
        text_length=len(text_content),
    )


# ---------------------------------------------------------------------------
# Internal helpers — PDF extraction (off event loop, CVE-2025-62707 guard)
# ---------------------------------------------------------------------------

_PDF_PARSE_TIMEOUT_SECONDS: float = 30.0  # crafted PDFs must not hang the event loop


def _extract_pdf_text_sync(raw: bytes) -> str:
    """Extract plain text from a PDF byte payload using pypdf (synchronous).

    Must be called via asyncio.to_thread.  CVE-2025-62707 fixed by pypdf>=6.1.1.
    Returns an empty string for scanned PDFs with no text layer — never raises.
    """
    reader = PdfReader(io.BytesIO(raw))
    pages: list[str] = []
    for page in reader.pages:
        extracted = page.extract_text()
        if extracted:
            pages.append(extracted)
    return "\n".join(pages)


async def _extract_pdf_text(raw: bytes) -> str:
    """Async wrapper: runs pypdf parsing in a thread with a hard timeout.

    Raises asyncio.TimeoutError when the PDF takes longer than
    _PDF_PARSE_TIMEOUT_SECONDS — callers surface a 400.
    """
    return await asyncio.wait_for(
        asyncio.to_thread(_extract_pdf_text_sync, raw),
        timeout=_PDF_PARSE_TIMEOUT_SECONDS,
    )

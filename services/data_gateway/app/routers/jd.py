"""JD document upload endpoint — B-032.

Contract:
  POST /jobs/{job_id}/jd-document → 200 JdUploadResponse | 400 | 401 | 404

Accepts a PDF upload (multipart/form-data), extracts plain text via pypdf,
stores the file in S3/R2, and writes jd_text + jd_s3_key to the jobs row.

Any authenticated user may upload (admin-level role restriction is deferred
to post-MVP role-based access control).
"""

from __future__ import annotations

import io
import uuid
from typing import Annotated

import structlog
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
    raw: bytes = await file.read()
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

    # --- 4. text extraction ---
    text_content = _extract_pdf_text(raw)

    # --- 5. S3 upload ---
    key = f"jd-documents/{job_id}.pdf"
    await upload_file(
        bucket=settings.s3_bucket_name,
        key=key,
        data=raw,
        content_type="application/pdf",
        settings=settings,
    )

    # --- 6. DB update ---
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
# Internal helper
# ---------------------------------------------------------------------------


def _extract_pdf_text(raw: bytes) -> str:
    """Extract plain text from a PDF byte payload using pypdf.

    Returns an empty string for scanned PDFs with no text layer — never raises.
    """
    reader = PdfReader(io.BytesIO(raw))
    pages: list[str] = []
    for page in reader.pages:
        extracted = page.extract_text()
        if extracted:
            pages.append(extracted)
    return "\n".join(pages)

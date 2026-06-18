"""Unit tests for the resume upload endpoint — B-031.

All external I/O (S3, DB) is mocked so these tests run without infrastructure.
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException
from pypdf import PdfReader

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_minimal_pdf() -> bytes:
    """Return the bytes of the smallest valid single-page PDF recognised by pypdf."""
    # This is a hand-crafted minimal valid PDF with one blank page.
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/MediaBox[0 0 3 3]/Parent 2 0 R>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n"
        b"0000000009 00000 n \n"
        b"0000000058 00000 n \n"
        b"0000000115 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\n"
        b"startxref\n190\n%%EOF"
    )


# ---------------------------------------------------------------------------
# 1. test_pdf_text_extraction — unit-tests the _extract_pdf_text helper
# ---------------------------------------------------------------------------


def test_pdf_text_extraction() -> None:
    """_extract_pdf_text must join text from multiple pages with newlines."""
    from app.routers.resume import _extract_pdf_text

    page1 = MagicMock()
    page1.extract_text.return_value = "Hello from page one"
    page2 = MagicMock()
    page2.extract_text.return_value = "Hello from page two"

    mock_reader = MagicMock(spec=PdfReader)
    mock_reader.pages = [page1, page2]

    with patch("app.routers.resume.PdfReader", return_value=mock_reader):
        result = _extract_pdf_text(b"fake-pdf-bytes")

    assert result == "Hello from page one\nHello from page two"


# ---------------------------------------------------------------------------
# 2. test_non_pdf_rejected — wrong content-type → 400
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_pdf_rejected() -> None:
    """upload_resume must raise HTTP 400 when the file is not a PDF."""
    from app.routers.resume import upload_resume

    mock_file = MagicMock()
    mock_file.content_type = "image/jpeg"

    mock_user = MagicMock()
    mock_user.user_id = str(uuid.uuid4())

    mock_db = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await upload_resume(file=mock_file, current_user=mock_user, db=mock_db)

    assert exc_info.value.status_code == 400
    assert "PDF" in exc_info.value.detail


# ---------------------------------------------------------------------------
# 3. test_oversized_file_rejected — 6 MB file → 400
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_oversized_file_rejected() -> None:
    """upload_resume must raise HTTP 400 when the file exceeds 5 MB."""
    from app.routers.resume import upload_resume

    oversized_bytes = b"x" * (6 * 1024 * 1024)  # 6 MB

    mock_file = MagicMock()
    mock_file.content_type = "application/pdf"
    mock_file.read = AsyncMock(return_value=oversized_bytes)

    mock_user = MagicMock()
    mock_user.user_id = str(uuid.uuid4())

    mock_db = AsyncMock()

    with pytest.raises(HTTPException) as exc_info:
        await upload_resume(file=mock_file, current_user=mock_user, db=mock_db)

    assert exc_info.value.status_code == 400
    assert "5 MB" in exc_info.value.detail


# ---------------------------------------------------------------------------
# 4. test_resume_upload_happy_path — mock S3 + DB, assert 200 + key format
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_resume_upload_happy_path() -> None:
    """upload_resume happy path: correct key format and text_length in response.

    Updated for the versioned router (Area 3 — UI redesign v2):
    - upload_file is a local import inside _upload_to_s3; we patch _upload_to_s3
      at the module level instead.
    - Key format is now resumes/{user_id}/{resume_id}.pdf (versioned per upload).
    - db.add() is called for the new Resume ORM row.
    """
    from app.routers.resume import upload_resume

    user_id = uuid.uuid4()
    pdf_bytes = _make_minimal_pdf()

    mock_file = MagicMock()
    mock_file.content_type = "application/pdf"
    mock_file.read = AsyncMock(return_value=pdf_bytes)
    mock_file.filename = "my_cv.pdf"

    mock_user = MagicMock()
    mock_user.user_id = str(user_id)

    mock_db = AsyncMock()
    mock_db.execute = AsyncMock()
    mock_db.add = MagicMock()
    mock_db.commit = AsyncMock()

    extracted_text = "Extracted resume text"

    with (
        patch("app.routers.resume._upload_to_s3", new=AsyncMock()),
        patch("app.routers.resume._extract_pdf_text", return_value=extracted_text),
    ):
        response = await upload_resume(
            file=mock_file, current_user=mock_user, db=mock_db
        )

    assert response.message == "Resume uploaded"
    assert response.text_length == len(extracted_text)

    # DB must have been committed
    mock_db.commit.assert_awaited_once()

    # Key format must be resumes/{user_id}/{resume_id}.pdf (versioned)
    assert response.resume_s3_key.startswith(f"resumes/{user_id}/")
    assert response.resume_s3_key.endswith(".pdf")
    # resume_id segment must be a valid UUID
    raw_id = response.resume_s3_key.split("/")[-1].replace(".pdf", "")
    uuid.UUID(raw_id)

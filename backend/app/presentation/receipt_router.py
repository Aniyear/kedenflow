"""API routes for Receipt upload and parsing."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional

import logging
from app.application.receipt_parser_service import ReceiptParserService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/receipts", tags=["Receipts"])


# --- Schemas ---

class ReceiptParseResponse(BaseModel):
    type: str
    amount: Optional[float] = None
    datetime: Optional[str] = None
    receipt_number: Optional[str] = None
    party_from: Optional[str] = None
    party_to: Optional[str] = None
    kbk: Optional[str] = None
    knp: Optional[str] = None
    comment: Optional[str] = None
    raw_text: str = ""
    errors: list[str] = []


# --- Endpoints ---

@router.post("/upload", response_model=ReceiptParseResponse)
async def upload_receipt(file: UploadFile = File(...)):
    """Upload a PDF receipt, extract text, and parse structured data.

    Returns parsed preview for user review before saving.
    """
    # Validate file type
    allowed_extensions = [".pdf", ".jpg", ".jpeg", ".png"]
    allowed_mimes = ["application/pdf", "image/jpeg", "image/png"]
    if not file.filename or not any(file.filename.lower().endswith(ext) for ext in allowed_extensions):
        raise HTTPException(
            status_code=400,
            detail="Unsupported file type. Allowed: PDF, JPG, PNG",
        )

    content_type = file.content_type or ""
    if content_type and content_type not in allowed_mimes:
        raise HTTPException(
            status_code=400,
            detail="Unsupported MIME type. Allowed: application/pdf, image/jpeg, image/png",
        )

    # Read file
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Empty file")

    # Parse
    try:
        result = ReceiptParserService.parse(file_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return ReceiptParseResponse(
        type=result.type,
        amount=result.amount,
        datetime=result.parsed_datetime.isoformat() if result.parsed_datetime else result.datetime_str,
        receipt_number=result.receipt_number,
        party_from=result.party_from,
        party_to=result.party_to,
        kbk=result.kbk,
        knp=result.knp,
        comment=result.comment,
        raw_text=result.raw_text,
        errors=result.errors,
    )

@router.post("/bulk_upload", response_model=list[ReceiptParseResponse])
async def bulk_upload_receipts(files: list[UploadFile] = File(...)):
    """Upload multiple PDF receipts and parse them sequentially."""
    responses = []
    logger.info(f"Received bulk upload request with {len(files)} files")
    allowed_extensions = [".pdf", ".jpg", ".jpeg", ".png"]
    for file in files:
        logger.info(f"Processing file: {file.filename} (Type: {file.content_type})")
        if not file.filename or not any(file.filename.lower().endswith(ext) for ext in allowed_extensions):
            logger.warning(f"File {file.filename} skipped: unsupported type")
            continue
            
        try:
            file_bytes = await file.read()
            result = ReceiptParserService.parse(file_bytes)
            responses.append(ReceiptParseResponse(
                type=result.type,
                amount=result.amount,
                datetime=result.parsed_datetime.isoformat() if result.parsed_datetime else result.datetime_str,
                receipt_number=result.receipt_number,
                party_from=result.party_from,
                party_to=result.party_to,
                kbk=result.kbk,
                knp=result.knp,
                comment=result.comment,
                raw_text=result.raw_text,
                errors=result.errors,
            ))
        except Exception as exc:
            # We can return an error block or skip
            responses.append(ReceiptParseResponse(
                type="payment",
                raw_text=file.filename or "unknown.pdf",
                errors=[f"Failed to parse: {exc}"]
            ))
            
    return responses

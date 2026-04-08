"""PDF Receipt Parser Service.

Extracts text from PDF receipts and parses structured data using LLM with Regex fallback.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.infrastructure.config import get_settings

logger = logging.getLogger(__name__)


@dataclass
class ParsedReceipt:
    """Structured data extracted from a receipt."""
    type: str  # "payment" or "transfer"
    amount: Optional[float] = None
    datetime_str: Optional[str] = None
    parsed_datetime: Optional[datetime] = None
    receipt_number: Optional[str] = None
    party_from: Optional[str] = None
    party_to: Optional[str] = None
    party_identifier: Optional[str] = None
    kbk: Optional[str] = None
    knp: Optional[str] = None
    raw_text: str = ""
    errors: list[str] = field(default_factory=list)


class LLMReceiptSchema(BaseModel):
    """Pydantic schema for LLM structured output."""
    type: Literal["payment", "transfer"] = Field(
        description="Тип чека: 'payment' (оплата услуг, налогов) или 'transfer' (перевод физ. лицу)."
    )
    amount: float | None = Field(
        default=None, description="Сумма операции. Только число (разделитель - точка)."
    )
    datetime_str: str | None = Field(
        default=None, description="Дата и время из чека 'как есть' (например '03.02.2026 15:35')."
    )
    receipt_number: str | None = Field(
        default=None, description="Номер чека или квитанции, документа."
    )
    party_from: str | None = Field(
        default=None, description="Отправитель или плательщик (ФИО или название)."
    )
    party_to: str | None = Field(
        default=None, description="Получатель, бенефициар (ФИО или название)."
    )
    party_identifier: str | None = Field(
        default=None, description="ИИН/БИН плательщика или получателя, если указано."
    )
    kbk: str | None = Field(
        default=None, description="КБК (код бюджетной классификации)."
    )
    knp: str | None = Field(
        default=None, description="КНП (код назначения платежа)."
    )


class ReceiptParserService:
    """Service for extracting and parsing PDF receipt data."""

    # --- Regex Fallback Configuration ---
    AMOUNT_PATTERNS = [
        r"(\d[\d\s]*\d)\s*₸",
        r"(\d[\d\s]*[\.,]\d{2})\s*(?:KZT|тенге|тг)",
        r"[Сс]умма[:\s]*(\d[\d\s]*[\.,]?\d*)",
        r"[Aa]mount[:\s]*(\d[\d\s]*[\.,]?\d*)",
    ]
    DATETIME_PATTERNS = [
        r"(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}(?::\d{2})?)",
        r"(\d{2}-\d{2}-\d{4}\s+\d{2}:\d{2}(?::\d{2})?)",
        r"(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(?::\d{2})?)",
        r"[Дд]ата[:\s]*(\d{2}[\.\-]\d{2}[\.\-]\d{4})",
    ]
    DATETIME_FORMATS = [
        "%d.%m.%Y %H:%M", "%d.%m.%Y %H:%M:%S",
        "%d-%m-%Y %H:%M", "%d-%m-%Y %H:%M:%S",
        "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S",
        "%d.%m.%Y", "%d-%m-%Y",
    ]
    RECEIPT_NUMBER_PATTERNS = [
        r"№\s*(?:квитанции|документа|чека)[:\s]*([^\n]+)",
        r"(?:Квитанция|Чек|Документ)\s*№?\s*[:\s]*([A-Za-z0-9\-]+)",
        r"(?:Receipt|Document)\s*#?\s*[:\s]*([A-Za-z0-9\-]+)",
    ]

    @staticmethod
    def extract_text(file_bytes: bytes) -> str:
        """Extract text from PDF bytes using PyMuPDF."""
        import fitz  # PyMuPDF
        text_parts = []
        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            for page in doc:
                text_parts.append(page.get_text())
            doc.close()
        except Exception as exc:
            raise ValueError(f"Failed to extract text from PDF: {exc}") from exc

        full_text = "\n".join(text_parts).strip()
        if not full_text:
            raise ValueError("No text could be extracted from the PDF.")
        return full_text

    @classmethod
    def _parse_datetime_str(cls, dt_str: str | None) -> tuple[Optional[str], Optional[datetime]]:
        if not dt_str:
            return None, None
        
        # Try finding a pattern in the LLM response just in case
        for pattern in cls.DATETIME_PATTERNS:
            match = re.search(pattern, dt_str)
            if match:
                raw_dt = match.group(1).strip()
                for fmt in cls.DATETIME_FORMATS:
                    try:
                        return raw_dt, datetime.strptime(raw_dt, fmt)
                    except ValueError:
                        pass
                        
        # If no pattern matches but we have a string, try direct parsing
        for fmt in cls.DATETIME_FORMATS:
            try:
                return dt_str, datetime.strptime(dt_str, fmt)
            except ValueError:
                pass
        return dt_str, None

    # --- Regex Fallback Methods ---
    @classmethod
    def detect_type(cls, text: str) -> str:
        text_upper = text.upper()
        if "КНП" in text_upper or "КБК" in text_upper: return "payment"
        if "ОТПРАВИТЕЛЬ" in text_upper or "SENDER" in text_upper: return "transfer"
        return "payment"

    @classmethod
    def _parse_amount(cls, text: str) -> Optional[float]:
        for pattern in cls.AMOUNT_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    return float(match.group(1).replace(" ", "").replace(",", "."))
                except ValueError:
                    pass
        return None

    @classmethod
    def _parse_receipt_number(cls, text: str) -> Optional[str]:
        for pattern in cls.RECEIPT_NUMBER_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match: return match.group(1).strip()
        return None

    @classmethod
    def _parse_field(cls, text: str, keywords: list[str]) -> Optional[str]:
        for keyword in keywords:
            match = re.search(rf"{keyword}[:\s]*([^\n]+)", text, re.IGNORECASE)
            if match and match.group(1).strip():
                return match.group(1).strip()
        return None

    @classmethod
    def _regex_parse(cls, text: str) -> ParsedReceipt:
        """Old regex pipeline (Fallback)."""
        r_type = cls.detect_type(text)
        dt_raw, dt_parsed = cls._parse_datetime_str(text) # actually we need to search text first for date
        # Recalculate datetime explicitly from raw text
        for pattern in cls.DATETIME_PATTERNS:
            match = re.search(pattern, text)
            if match:
                dt_raw_match = match.group(1).strip()
                for fmt in cls.DATETIME_FORMATS:
                    try:
                        dt_parsed = datetime.strptime(dt_raw_match, fmt)
                        dt_raw = dt_raw_match
                        break
                    except ValueError:
                        pass

        result = ParsedReceipt(
            type=r_type, raw_text=text, amount=cls._parse_amount(text),
            datetime_str=dt_raw, parsed_datetime=dt_parsed,
            receipt_number=cls._parse_receipt_number(text)
        )

        if r_type == "payment":
            result.party_from = cls._parse_field(text, ["Плательщик", "Отправитель", "From"])
            result.party_to = cls._parse_field(text, ["Получатель", "Бенефициар", "To"])
            result.party_identifier = cls._parse_field(text, ["ИИН", "БИН"])
            result.kbk = cls._parse_field(text, ["КБК"])
            result.knp = cls._parse_field(text, ["КНП"])
        else:
            result.party_from = cls._parse_field(text, ["Отправитель", "From", "Плательщик"])
            result.party_to = cls._parse_field(text, ["Получатель", "To", "Бенефициар"])

        if result.amount is None: result.errors.append("Could not extract amount via fallback")
        if result.parsed_datetime is None: result.errors.append("Could not extract datetime via fallback")
        return result

    # --- LLM Pipeline ---
    @classmethod
    def _llm_parse(cls, text: str, api_key: str, base_url: str | None, model: str) -> ParsedReceipt:
        """Parse strict JSON from text using OpenAI-compatible API in standard JSON mode."""
        try:
            import openai
            import json
        except ImportError:
            logger.warning("OpenAI library not installed, using regex fallback.")
            return cls._regex_parse(text)

        client = openai.OpenAI(api_key=api_key, base_url=base_url)
        schema_json = LLMReceiptSchema.schema() if hasattr(LLMReceiptSchema, "schema") else LLMReceiptSchema.model_json_schema()
        prompt = (
            f"You are a receipt parser. Extract data from the raw text into a strictly formatted JSON object.\n"
            f"Your output MUST be a SINGLE JSON object exactly matching this schema:\n"
            f"{json.dumps(schema_json['properties'], ensure_ascii=False)}\n\n"
            f"RULES:\n"
            f"1. Return ONLY the values for these keys. Do NOT include descriptions or the word 'Pydantic'.\n"
            f"2. Do NOT wrap the JSON in an array [].\n"
            f"3. If a field is missing, set its value to null.\n\n"
            f"Raw text:\n\n{text}"
        )

        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a helpful data extraction assistant that outputs only a single JSON object."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.0
            )
            content = response.choices[0].message.content
            parsed_data = json.loads(content)
            
            # Handle if Llama wraps the object in a list
            if isinstance(parsed_data, list) and len(parsed_data) > 0:
                parsed_data = parsed_data[0]
                
            parsed = LLMReceiptSchema.model_validate(parsed_data)
        except Exception as e:
            logger.error(f"LLM Parsing failed: {e}")
            return cls._regex_parse(text)  # seamless fallback

        dt_raw, dt_parsed = cls._parse_datetime_str(parsed.datetime_str)
        
        result = ParsedReceipt(
            type=parsed.type,
            amount=parsed.amount,
            datetime_str=dt_raw,
            parsed_datetime=dt_parsed,
            receipt_number=parsed.receipt_number,
            party_from=parsed.party_from,
            party_to=parsed.party_to,
            party_identifier=parsed.party_identifier,
            kbk=parsed.kbk,
            knp=parsed.knp,
            raw_text=text
        )

        if result.amount is None: result.errors.append("LLM could not find amount")
        if result.parsed_datetime is None: result.errors.append("LLM could not find/validate datetime format")

        return result

    @classmethod
    def parse(cls, file_bytes: bytes) -> ParsedReceipt:
        """Main entry point for parsing."""
        text = cls.extract_text(file_bytes)
        
        settings = get_settings()
        if settings.llm_api_key:
            logger.info(f"Using LLM {settings.llm_model_name} for parsing")
            return cls._llm_parse(
                text=text,
                api_key=settings.llm_api_key,
                base_url=settings.llm_base_url,
                model=settings.llm_model_name
            )
        else:
            logger.info("Using REGEX fallback for parsing (No LLM key)")
            return cls._regex_parse(text)

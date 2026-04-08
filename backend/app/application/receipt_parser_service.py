"""PDF Receipt Parser Service.

Extracts text from PDF receipts and parses structured data using LLM with Regex fallback.
"""

from __future__ import annotations

import logging
import re
import json
import traceback
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, Literal

import fitz  # PyMuPDF
import openai
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
    receipt_number: str | int | None = Field(
        default=None, description="Номер чека или квитанции, документа."
    )
    party_from: str | None = Field(
        default=None, description="Отправитель или плательщик (ФИО или название)."
    )
    party_to: str | None = Field(
        default=None, description="Получатель, бенефициар (ФИО или название)."
    )
    party_identifier: str | int | None = Field(
        default=None, description="ИИН/БИН плательщика или получателя, если указано."
    )
    kbk: str | int | None = Field(
        default=None, description="КБК (код бюджетной классификации)."
    )
    knp: str | int | None = Field(
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
        text_parts = []
        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            for page in doc:
                text_parts.append(page.get_text())
            doc.close()
        except Exception as exc:
            logger.error(f"PyMuPDF extraction failed: {exc}")
            raise ValueError(f"Failed to extract text from PDF: {exc}") from exc

        full_text = "\n".join(text_parts).strip()
        logger.info(f"Extracted text length: {len(full_text)} characters")
        if len(full_text) > 0:
            logger.info(f"First 100 chars of text: {full_text[:100].replace('\n', ' ')}")
            
        if not full_text:
            logger.error("Extraction result: empty text (likely scan)")
            raise ValueError("PDF не содержит текста. Возможно, это скан или фото. Пожалуйста, используйте текстовый PDF.")
        return full_text

    @classmethod
    def _parse_datetime_str(cls, dt_str: str | None) -> tuple[Optional[str], Optional[datetime]]:
        if not dt_str:
            return None, None
        
        for pattern in cls.DATETIME_PATTERNS:
            match = re.search(pattern, dt_str)
            if match:
                raw_dt = match.group(1).strip()
                for fmt in cls.DATETIME_FORMATS:
                    try:
                        return raw_dt, datetime.strptime(raw_dt, fmt)
                    except ValueError:
                        pass
                        
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
        dt_raw, dt_parsed = cls._parse_datetime_str(text)
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

        return result

    # --- LLM Pipeline ---
    @classmethod
    def _llm_parse(cls, text: str, api_key: str, base_url: str | None, model: str) -> ParsedReceipt:
        """Parse strict JSON from text using OpenAI-compatible API."""
        try:
            logger.info("Initializing OpenAI client...")
            client = openai.OpenAI(api_key=api_key, base_url=base_url)
            
            logger.info("Preparing model schema and prompt...")
            # Pydantic v2 check
            if hasattr(LLMReceiptSchema, "model_json_schema"):
                schema_json = LLMReceiptSchema.model_json_schema()
            else:
                schema_json = LLMReceiptSchema.schema()
                
            props = schema_json.get('properties', {})
            
            prompt = (
                "You are a professional financial receipt parser.\n"
                "Extract data from the raw text into a strictly formatted JSON object.\n"
                f"Schema properties to extract: {list(props.keys())}\n\n"
                "Raw text:\n"
                f"{text}\n\n"
                "Return ONLY a JSON object."
            )

            logger.info(f"Sending request to LLM ({model})...")
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": "You are a professional financial data extractor. You only output valid JSON."},
                    {"role": "user", "content": prompt}
                ],
                response_format={"type": "json_object"},
                temperature=0.0
            )
            
            content = response.choices[0].message.content
            logger.info(f"LLM Response received. Content length: {len(content) if content else 0}")
            logger.info(f"LLM Raw Content: {content}")
            
            if not content:
                logger.warning("LLM returned empty content.")
                return cls._regex_parse(text)

            parsed_data = json.loads(content)
            
            # --- Data Sanitization (for models that ignore strict schema) ---
            # 1. Map 'type' to valid literals
            raw_type = str(parsed_data.get("type", "payment")).lower()
            if "transfer" in raw_type or "перевод" in raw_type:
                parsed_data["type"] = "transfer"
            else:
                parsed_data["type"] = "payment"

            # 2. Convert dicts in party fields to strings
            for field_name in ["party_from", "party_to"]:
                val = parsed_data.get(field_name)
                if isinstance(val, dict):
                    # Combine name/iin/bin into a single string
                    parts = []
                    if val.get("name"): parts.append(str(val["name"]))
                    if val.get("bin"): parts.append(f"БИН {val['bin']}")
                    if val.get("iin"): parts.append(f"ИИН {val['iin']}")
                    parsed_data[field_name] = ", ".join(parts)

            # Handle if Llama wraps the object in a list
            if isinstance(parsed_data, list) and len(parsed_data) > 0:
                parsed_data = parsed_data[0]
                
            logger.info(f"Sanitized data before validation: {parsed_data}")
            parsed = LLMReceiptSchema.model_validate(parsed_data)
            logger.info("Pydantic validation successful.")
            
            dt_raw, dt_parsed = cls._parse_datetime_str(parsed.datetime_str)
            
            return ParsedReceipt(
                type=parsed.type,
                amount=parsed.amount,
                datetime_str=dt_raw,
                parsed_datetime=dt_parsed,
                receipt_number=str(parsed.receipt_number) if parsed.receipt_number is not None else None,
                party_from=parsed.party_from,
                party_to=parsed.party_to,
                party_identifier=str(parsed.party_identifier) if parsed.party_identifier is not None else None,
                kbk=str(parsed.kbk) if parsed.kbk is not None else None,
                knp=str(parsed.knp) if parsed.knp is not None else None,
                raw_text=text
            )

        except Exception as e:
            logger.error(f"LLM Step failed: {str(e)}")
            logger.error(traceback.format_exc())
            return cls._regex_parse(text)

    @classmethod
    def parse(cls, file_bytes: bytes) -> ParsedReceipt:
        """Main entry point for parsing."""
        try:
            text = cls.extract_text(file_bytes)
            settings = get_settings()
            
            if settings.llm_api_key:
                logger.info(f"Starting LLM parse path (Key len: {len(settings.llm_api_key)})")
                return cls._llm_parse(
                    text=text,
                    api_key=settings.llm_api_key,
                    base_url=settings.llm_base_url,
                    model=settings.llm_model_name
                )
            else:
                logger.info("No LLM key, using regex.")
                return cls._regex_parse(text)
        except Exception as e:
            logger.error(f"Global parse error: {e}")
            logger.error(traceback.format_exc())
            # Final fallback
            return ParsedReceipt(type="payment", raw_text="Global Error", errors=[str(e)])

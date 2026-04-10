"""PDF Receipt Parser Service.

Extracts data from receipts using Text-based LLM (for readable PDFs) 
or Vision-based LLM (for scanned documents and images).
"""

from __future__ import annotations

import logging
import re
import json
import traceback
import base64
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
    kbk: Optional[str] = None
    knp: Optional[str] = None
    comment: Optional[str] = None
    raw_text: str = ""
    errors: list[str] = field(default_factory=list)


class LLMReceiptSchema(BaseModel):
    """Pydantic schema for LLM structured output."""
    type: Literal["payment", "transfer"] = Field(
        description="ONLY 'payment' or 'transfer'. Use 'transfer' ONLY if it is a bank transfer to an individual."
    )
    amount: float | None = Field(
        default=None,
        description="The total payment amount as a number only. No spaces, no currency signs. Use dot as decimal separator."
    )
    datetime_str: str | None = Field(
        default=None,
        description="Date and time exactly as written in the receipt, e.g. '09.01.2026 15:03'."
    )
    receipt_number: str | int | None = Field(
        default=None,
        description="The receipt/document/transaction number. A numeric or alphanumeric ID."
    )
    party_from: str | None = Field(
        default=None,
        description="The sender or payer. Return ONLY a plain string with their name. NO nested objects."
    )
    party_to: str | None = Field(
        default=None,
        description="The recipient or beneficiary. Return ONLY a plain string with their name. NO nested objects."
    )
    kbk: str | int | None = Field(
        default=None,
        description="Budget Classification Code. Look for the label 'КБК' or 'Платеж'. Set null for transfers."
    )
    knp: str | int | None = Field(
        default=None,
        description="Payment Purpose Code. Look ONLY for the label 'КНП'. If the label 'КНП' is NOT in the text, set null. Set null for transfers."
    )


# Explicit prompt template for Kazakhstani financial receipts
_SYSTEM_PROMPT = """You are a precise financial receipt data extractor for Kazakhstani bank receipts.
You extract ONLY what is explicitly written in the receipt. You NEVER invent or guess fields.
You ALWAYS output a single valid JSON object. You NEVER output arrays or nested objects inside string fields."""

_USER_PROMPT_TEMPLATE = """Extract data from this Kazakhstani bank receipt into a JSON object.

=== OUTPUT JSON SCHEMA ===
{{
  "type": "payment" | "transfer",
  "amount": <number or null>,
  "datetime_str": "<string or null>",
  "receipt_number": "<string or null>",
  "party_from": "<plain string or null>",
  "party_to": "<plain string or null>",
  "kbk": "<string or null>",
  "knp": "<string or null>"
}}

=== STRICT RULES ===

RULE 1 - TYPE:
- Use "payment" if the receipt is a payment for government services, taxes, duties, or utility bills.
- Use "transfer" ONLY if it is a money transfer to another individual's bank account/card.
- Default is "payment" if uncertain.

RULE 2 - AMOUNT (⚠️ CRITICAL — DO NOT GET THIS WRONG):
- Extract the TOTAL payment amount as a plain JSON number.
- ⚠️ IMPORTANT: Cross-verify the numeric amount with the "Amount in words" (Сумма прописью/Пять миллионов...) if it exists. If they diverge, the "Amount in words" is usually more reliable.
- In Kazakh/Russian formatting: SPACE is the THOUSANDS separator, COMMA or DOT before 2 final digits is the DECIMAL separator.
- CORRECT parsing examples:
    "24 650,00 ₸"      → 24650.0       (24 thousand 650, NOT 2465000)
    "3 910 000.00 ₸"   → 3910000.0
    "1 000 000,00 ₸"   → 1000000.0
    "500,00 ₸"         → 500.0
    "75 000 ₸"         → 75000.0
- DO NOT remove the decimal part. DO NOT multiply the number.
- Return ONLY the final number, no currency signs, no spaces.

RULE 3 - DATETIME:
- Copy the date and time EXACTLY as it appears in the text (e.g. "09.01.2026 15:03:22").
- If no time is present, copy just the date.

RULE 4 - RECEIPT NUMBER:
- Look for the document/receipt/transaction ID labeled: "№ квитанции", "Документ №", "ID транзакции", "Номер", "E1008...", or a long numeric string near such labels.
- Copy the ID value only, not the label.

RULE 5 - PARTY_FROM:
- Return ONLY a plain text string — the name of the payer/sender.
- Example: "Товарищество с ограниченной ответственностью \"EKAY LTD\"" or "Иванов Иван Иванович".
- NEVER return a JSON object, dict, or nested structure. ALWAYS a simple string.

RULE 6 - PARTY_TO:
- Return ONLY a plain text string — the name of the recipient/beneficiary.
- ⚠️ IMPORTANT: In Kaspi transfers, the recipient's name (e.g., "Дастан О.") often follows the amount. OCR might add noise characters like "oe", "ә", "«" to the name. Clean them up.
- ⚠️ IMPORTANT: If a name is followed by "0." or "o.", this is likely a misread initial "О.". Return it as "О." (e.g., "Дастан О.").
- ⚠️ IMPORTANT: Search for names in the whole text. Often they are near labels like "Получатель", "Бенефициар", "ФИО получателя" or "Место получения услуги".
- ⚠️ IMPORTANT: If you see "Место получения услуги", extract the full authority/department name as the recipient (e.g., "РГУ УГД по городу...").
- ⚠️ IMPORTANT: Ignore generic labels like "клиенту Kaspi", "клиенту Казр!", "Kaspi Gold", or "на карту" if a person's name is found anywhere else.
- NEVER return a JSON object, dict, or nested structure. ALWAYS a simple string.

RULE 7 - KBK (Код бюджетной классификации):
- Extract this ONLY if you find the label "КБК" or "Назначение платежа" or "Платеж" in the text.
- Copy the code and its description together as one string.
- Example: "106119 - Авансовые платежи..."
- Set to null for "transfer" type receipts.

RULE 8 - KNP (Код назначения платежа):
- Extract this ONLY IF the text contains the explicit label "КНП" followed by a value.
- If the label "КНП" is NOT present in the text → set to null.
- Do NOT confuse KNP with KBK. They are different fields.
- Set to null for "transfer" type receipts.

=== ADDITIONAL CONTEXT ===
{text}

=== YOUR JSON OUTPUT (no explanation, just JSON) ==="""


class ReceiptParserService:
    """Service for extracting and parsing receipt data using Text or Vision LLM."""

    DATETIME_PATTERNS = [
        r"(\d{2}\.\d{2}\.\d{4}\s+\d{2}[:\.]\d{2}(?::\d{2})?)",
        r"(\d{2}-\d{2}-\d{4}\s+\d{2}[:\.]\d{2}(?::\d{2})?)",
        r"(\d{4}-\d{2}-\d{2}\s+\d{2}[:\.]\d{2}(?::\d{2})?)",
        r"[Дд]ата[:\s]*(\d{2}[\.\-]\d{2}[\.\-]\d{4})",
    ]
    DATETIME_FORMATS = [
        "%d.%m.%Y %H:%M", "%d.%m.%Y %H:%M:%S",
        "%d-%m-%Y %H:%M", "%d-%m-%Y %H:%M:%S",
        "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S",
        "%d.%m.%Y", "%d-%m-%Y",
    ]

    @staticmethod
    def _parse_amount_string(value: str | float | int | None) -> float | None:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)

        s = str(value).strip()
        s = re.sub(r"[₸$€£¥]", "", s).strip()
        if not s:
            return None

        decimal_match = re.search(r"([.,])(\d{1,2})$", s)
        if decimal_match:
            decimal_sep = decimal_match.group(1)
            thousands_sep = "," if decimal_sep == "." else "."
            s = s.replace(" ", "").replace(thousands_sep, "").replace(decimal_sep, ".")
        else:
            s = re.sub(r"[\s,.]", "", s)

        try:
            return float(s)
        except ValueError:
            return None

    @classmethod
    def extract_text_from_pdf(cls, file_bytes: bytes) -> str:
        """Extract text from PDF accurately. No OCR used here."""
        text_parts = []
        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            for page in doc:
                page_text = page.get_text()
                text_parts.append(page_text)
            doc.close()
        except Exception as exc:
            logger.error(f"PDF text extraction failed: {exc}")
            return ""
        return "\n".join(text_parts).strip()

    @classmethod
    def _parse_datetime_str(cls, dt_str: str | None) -> tuple[Optional[str], Optional[datetime]]:
        if not dt_str: return None, None
        if re.search(r"\d{2}\.\d{2}$", dt_str):
            dt_str = re.sub(r"(\d{2})\.(\d{2})$", r"\1:\2", dt_str)
        for pattern in cls.DATETIME_PATTERNS:
            match = re.search(pattern, dt_str)
            if match:
                raw_dt = match.group(1).strip()
                if "." in raw_dt[-5:]:
                    raw_dt = raw_dt[:-5] + raw_dt[-5:].replace(".", ":")
                for fmt in cls.DATETIME_FORMATS:
                    try: return raw_dt, datetime.strptime(raw_dt, fmt)
                    except ValueError: pass
        for fmt in cls.DATETIME_FORMATS:
            try: return dt_str, datetime.strptime(dt_str, fmt)
            except ValueError: pass
        return dt_str, None

    @classmethod
    def _regex_parse(cls, text: str) -> ParsedReceipt:
        text_upper = text.upper()
        r_type = "transfer" if any(kw in text_upper for kw in ["ОТПРАВИТЕЛЬ", "ПЕРЕВОД"]) else "payment"
        
        # Very simplified regex fallback
        result = ParsedReceipt(type=r_type, raw_text=text)
        return result

    @classmethod
    def _sanitize_llm_output(cls, parsed_data: dict) -> dict:
        raw_type = str(parsed_data.get("type", "payment")).lower()
        parsed_data["type"] = "transfer" if "transfer" in raw_type or "перевод" in raw_type else "payment"
        
        for field_name in ["party_from", "party_to"]:
            val = parsed_data.get(field_name)
            if isinstance(val, dict):
                parts = [str(val[k]) for k in ["name", "full_name", "organization"] if val.get(k)]
                parsed_data[field_name] = ", ".join(parts) if parts else str(next(iter(val.values()), ""))
        
        parsed_data["amount"] = cls._parse_amount_string(parsed_data.get("amount"))
        return parsed_data

    @classmethod
    def _llm_parse(cls, text: str, api_key: str, base_url: str | None, model: str) -> ParsedReceipt:
        """Standard text-only LLM parse."""
        try:
            client = openai.OpenAI(api_key=api_key, base_url=base_url)
            prompt = _USER_PROMPT_TEMPLATE.format(text=text)
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": prompt},
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
            )
            content = response.choices[0].message.content
            if not content: return cls._regex_parse(text)
            
            parsed_data = cls._sanitize_llm_output(json.loads(content))
            parsed = LLMReceiptSchema.model_validate(parsed_data)
            
            if parsed.type == "transfer":
                parsed.kbk = parsed.knp = None

            dt_raw, dt_parsed = cls._parse_datetime_str(parsed.datetime_str)
            return ParsedReceipt(
                type=parsed.type, amount=parsed.amount, datetime_str=dt_raw, parsed_datetime=dt_parsed,
                receipt_number=str(parsed.receipt_number) if parsed.receipt_number else None,
                party_from=parsed.party_from, party_to=parsed.party_to,
                kbk=str(parsed.kbk) if parsed.kbk else None, knp=str(parsed.knp) if parsed.knp else None,
                raw_text=text
            )
        except Exception as e:
            logger.error(f"LLM parse failed: {e}")
            return cls._regex_parse(text)

    @classmethod
    def _vision_parse(cls, image_bytes: bytes, api_key: str, base_url: str | None, model: str) -> ParsedReceipt:
        """Multi-modal Vision LLM parse (No local OCR)."""
        try:
            logger.info(f"Sending Vision request to LLM ({model})...")
            client = openai.OpenAI(api_key=api_key, base_url=base_url)
            base64_image = base64.b64encode(image_bytes).decode("utf-8")
            
            prompt = _USER_PROMPT_TEMPLATE.format(text="[IMAGE DATA]")
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{base64_image}"}}
                        ]
                    },
                ],
                response_format={"type": "json_object"},
                temperature=0.0,
            )
            content = response.choices[0].message.content
            if not content: raise ValueError("Empty Vision response")

            parsed_data = cls._sanitize_llm_output(json.loads(content))
            parsed = LLMReceiptSchema.model_validate(parsed_data)
            
            dt_raw, dt_parsed = cls._parse_datetime_str(parsed.datetime_str)
            return ParsedReceipt(
                type=parsed.type, amount=parsed.amount, datetime_str=dt_raw, parsed_datetime=dt_parsed,
                receipt_number=str(parsed.receipt_number) if parsed.receipt_number else None,
                party_from=parsed.party_from, party_to=parsed.party_to,
                kbk=str(parsed.kbk) if parsed.kbk else None, knp=str(parsed.knp) if parsed.knp else None,
                raw_text="[Vision Extracted]"
            )
        except Exception as e:
            logger.error(f"Vision parse failed: {e}")
            return ParsedReceipt(type="payment", raw_text="", errors=[f"Vision error: {str(e)}"])

    @classmethod
    def parse(cls, file_bytes: bytes) -> ParsedReceipt:
        """Main entry point. Automatically switches between Text and Vision modes."""
        try:
            settings = get_settings()
            if not settings.llm_api_key:
                return cls._regex_parse(cls.extract_text_from_pdf(file_bytes))

            is_pdf = file_bytes.startswith(b"%PDF-")
            text = cls.extract_text_from_pdf(file_bytes) if is_pdf else ""
            
            # Decide: Vision or Text?
            if is_pdf and text.strip() and len(text) > 100:
                logger.info("Readable PDF detected. Using Text mode.")
                return cls._llm_parse(text, settings.llm_api_key, settings.llm_base_url, settings.llm_model_name)
            else:
                logger.info("Scanned document or Image detected. Using Vision mode.")
                image_bytes = file_bytes
                if is_pdf:
                    doc = fitz.open(stream=file_bytes, filetype="pdf")
                    page = doc[0]
                    pix = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0))
                    image_bytes = pix.tobytes("png")
                    doc.close()
                
                return cls._vision_parse(image_bytes, settings.llm_api_key, settings.llm_base_url, settings.llm_model_name)

        except Exception as e:
            logger.error(f"Global parse error: {e}")
            return ParsedReceipt(type="payment", raw_text="", errors=[str(e)])

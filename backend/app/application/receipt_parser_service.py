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
    kbk: Optional[str] = None
    knp: Optional[str] = None
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
You extract ONLY what is explicitly written in the receipt text. You NEVER invent or guess fields.
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
- Example: "Товарищество с ограниченной ответственностью \\"EKAY LTD\\"" or "Иванов Иван Иванович".
- NEVER return a JSON object, dict, or nested structure. ALWAYS a simple string.

RULE 6 - PARTY_TO:
- Return ONLY a plain text string — the name of the recipient/beneficiary.
- Example: "РГУ \\"УГД по городу Талдыкорган ДГД по области Жетісу КГД МФ РК\\"".
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

=== RECEIPT TEXT ===
{text}

=== YOUR JSON OUTPUT (no explanation, just JSON) ==="""


class ReceiptParserService:
    """Service for extracting and parsing PDF receipt data."""

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
    @staticmethod
    def _parse_amount_string(value: str | float | int | None) -> float | None:
        """
        Safely parse Kazakh/Russian formatted amounts.

        Handles:
          - "24 650,00"   → 24650.00  (space=thousands, comma=decimal)
          - "3 910 000.00" → 3910000.00 (space=thousands, dot=decimal)
          - "1 000 000,00" → 1000000.00
          - 3910000.0     → 3910000.0  (already a number)
        """
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)

        s = str(value).strip()
        # Remove currency symbols
        s = re.sub(r"[₸$€£¥]", "", s).strip()

        if not s:
            return None

        # Detect decimal separator: the last comma or dot followed by exactly 1-2 digits at end
        decimal_match = re.search(r"([.,])(\d{1,2})$", s)
        if decimal_match:
            decimal_sep = decimal_match.group(1)
            # Remove thousands separators (spaces + the opposite separator)
            thousands_sep = "," if decimal_sep == "." else "."
            s = s.replace(" ", "").replace(thousands_sep, "").replace(decimal_sep, ".")
        else:
            # No decimal part — just remove all separators
            s = re.sub(r"[\s,.]", "", s)

        try:
            return float(s)
        except ValueError:
            return None

    RECEIPT_NUMBER_PATTERNS = [
        r"№\s*(?:квитанции|документа|чека)[:\s]*([^\n]+)",
        r"(?:Квитанция|Чек|Документ)\s*№?\s*[:\s]*([A-Za-z0-9\-]+)",
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
        if full_text:
            logger.info(f"First 150 chars: {full_text[:150].replace(chr(10), ' ')}")

        if not full_text:
            logger.error("Empty text extracted — likely a scanned image PDF")
            raise ValueError(
                "PDF не содержит текста. Возможно, это скан или фото. "
                "Пожалуйста, используйте текстовый PDF."
            )
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

    # --- Regex Fallback ---
    @classmethod
    def _regex_parse(cls, text: str) -> ParsedReceipt:
        """Regex fallback pipeline used when LLM is unavailable or fails."""
        text_upper = text.upper()

        # Detect type
        if "КНП" in text_upper or "КБК" in text_upper or "ГОСПОШЛИН" in text_upper:
            r_type = "payment"
        elif "ОТПРАВИТЕЛЬ" in text_upper or "ПЕРЕВОД" in text_upper:
            r_type = "transfer"
        else:
            r_type = "payment"

        # Extract datetime
        dt_raw, dt_parsed = None, None
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
                if dt_parsed:
                    break

        # Extract amount
        amount = None
        for pattern in cls.AMOUNT_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                try:
                    amount = float(match.group(1).replace(" ", "").replace(",", "."))
                    break
                except ValueError:
                    pass

        # Extract receipt number
        receipt_number = None
        for pattern in cls.RECEIPT_NUMBER_PATTERNS:
            match = re.search(pattern, text, re.IGNORECASE)
            if match:
                receipt_number = match.group(1).strip()
                break

        def find_field(keywords: list[str]) -> Optional[str]:
            for kw in keywords:
                m = re.search(rf"{kw}[:\s]*([^\n]+)", text, re.IGNORECASE)
                if m and m.group(1).strip():
                    return m.group(1).strip()
            return None

        result = ParsedReceipt(
            type=r_type,
            raw_text=text,
            amount=amount,
            datetime_str=dt_raw,
            parsed_datetime=dt_parsed,
            receipt_number=receipt_number,
        )

        if r_type == "payment":
            result.party_from = find_field(["Плательщик", "Отправитель"])
            result.party_to = find_field(["Получатель", "Бенефициар"])
            result.kbk = find_field(["КБК", "Назначение платежа", "Платеж"])
            result.knp = find_field(["КНП"])
        else:
            result.party_from = find_field(["Отправитель", "Плательщик"])
            result.party_to = find_field(["Получатель", "Бенефициар"])

        return result

    # --- LLM Pipeline ---
    @classmethod
    def _sanitize_llm_output(cls, parsed_data: dict) -> dict:
        """Fix common LLM mistakes before Pydantic validation."""
        # 1. Normalize type field
        raw_type = str(parsed_data.get("type", "payment")).lower()
        if "transfer" in raw_type or "перевод" in raw_type:
            parsed_data["type"] = "transfer"
        else:
            parsed_data["type"] = "payment"

        # 2. Unwrap nested dicts in party fields
        for field_name in ["party_from", "party_to"]:
            val = parsed_data.get(field_name)
            if isinstance(val, dict):
                parts = []
                for key in ["name", "full_name", "organization"]:
                    if val.get(key):
                        parts.append(str(val[key]))
                if not parts:
                    # Take the first string value found
                    for v in val.values():
                        if isinstance(v, str) and v.strip():
                            parts.append(v.strip())
                            break
                parsed_data[field_name] = ", ".join(parts) if parts else None

        # 3. Normalize amount using smart parser
        parsed_data["amount"] = cls._parse_amount_string(parsed_data.get("amount"))

        # 4. Unwrap list wrapping
        if isinstance(parsed_data, list) and len(parsed_data) > 0:
            parsed_data = parsed_data[0]

        return parsed_data

    @classmethod
    def _llm_parse(cls, text: str, api_key: str, base_url: str | None, model: str) -> ParsedReceipt:
        """Parse receipt using LLM with sanitized output and Pydantic validation."""
        try:
            logger.info("Initializing OpenAI client...")
            client = openai.OpenAI(api_key=api_key, base_url=base_url)

            prompt = _USER_PROMPT_TEMPLATE.format(text=text)

            logger.info(f"Sending request to LLM ({model})...")
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
            logger.info(f"LLM response length: {len(content) if content else 0}")
            logger.info(f"LLM raw content: {content}")

            if not content:
                logger.warning("LLM returned empty content — falling back to regex.")
                return cls._regex_parse(text)

            parsed_data = json.loads(content)
            parsed_data = cls._sanitize_llm_output(parsed_data)

            logger.info(f"Sanitized data: {parsed_data}")
            parsed = LLMReceiptSchema.model_validate(parsed_data)
            logger.info("Pydantic validation successful.")

            # Force clear KBK/KNP for transfers
            if parsed.type == "transfer":
                parsed.kbk = None
                parsed.knp = None
                logger.info("Transfer receipt: KBK/KNP cleared.")

            dt_raw, dt_parsed = cls._parse_datetime_str(parsed.datetime_str)

            return ParsedReceipt(
                type=parsed.type,
                amount=parsed.amount,
                datetime_str=dt_raw,
                parsed_datetime=dt_parsed,
                receipt_number=str(parsed.receipt_number) if parsed.receipt_number is not None else None,
                party_from=parsed.party_from,
                party_to=parsed.party_to,
                kbk=str(parsed.kbk) if parsed.kbk is not None else None,
                knp=str(parsed.knp) if parsed.knp is not None else None,
                raw_text=text,
            )

        except Exception as e:
            logger.error(f"LLM parse failed: {str(e)}")
            logger.error(traceback.format_exc())
            return cls._regex_parse(text)

    @classmethod
    def parse(cls, file_bytes: bytes) -> ParsedReceipt:
        """Main entry point for parsing a receipt PDF."""
        try:
            text = cls.extract_text(file_bytes)
            settings = get_settings()

            if settings.llm_api_key:
                logger.info(f"Using LLM [{settings.llm_model_name}] (key length: {len(settings.llm_api_key)})")
                return cls._llm_parse(
                    text=text,
                    api_key=settings.llm_api_key,
                    base_url=settings.llm_base_url,
                    model=settings.llm_model_name,
                )
            else:
                logger.warning("No LLM_API_KEY found — using regex fallback.")
                return cls._regex_parse(text)

        except Exception as e:
            logger.error(f"Global parse error: {e}")
            logger.error(traceback.format_exc())
            return ParsedReceipt(type="payment", raw_text="", errors=[str(e)])

"""SQLAlchemy ORM models."""

from __future__ import annotations

import uuid
import datetime as dt

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.database import Base


class BrokerModel(Base):
    """ORM model for the brokers table."""

    __tablename__ = "brokers"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=dt.datetime.utcnow
    )

    transactions: Mapped[list["TransactionModel"]] = relationship(
        back_populates="broker", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Broker(id={self.id}, name={self.name!r})>"


class TransactionModel(Base):
    """ORM model for the transactions table."""

    __tablename__ = "transactions"
    __table_args__ = (
        CheckConstraint("amount > 0", name="ck_transactions_amount_positive"),
        CheckConstraint(
            "type IN ('accrual', 'payment', 'transfer', 'cash')",
            name="ck_transactions_type_valid",
        ),
        CheckConstraint(
            "source IN ('manual', 'receipt')",
            name="ck_transactions_source_valid",
        ),
        Index("idx_transactions_broker_id", "broker_id"),
        Index("idx_transactions_type", "type"),
        Index("idx_transactions_datetime", "datetime"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    broker_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("brokers.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(String(20), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(15, 2), nullable=False)
    datetime: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    receipt_number: Mapped[str | None] = mapped_column(Text)
    party_from: Mapped[str | None] = mapped_column(Text)
    party_to: Mapped[str | None] = mapped_column(Text)
    party_identifier: Mapped[str | None] = mapped_column(Text)
    kbk: Mapped[str | None] = mapped_column(Text)
    knp: Mapped[str | None] = mapped_column(Text)
    comment: Mapped[str | None] = mapped_column(Text)
    source: Mapped[str] = mapped_column(String(20), default="manual")
    raw_text: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), default=dt.datetime.utcnow
    )

    broker: Mapped["BrokerModel"] = relationship(back_populates="transactions")

    def __repr__(self) -> str:
        return f"<Transaction(id={self.id}, type={self.type}, amount={self.amount})>"

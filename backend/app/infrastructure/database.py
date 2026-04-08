"""Database connection and session management."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.infrastructure.config import get_settings

settings = get_settings()

# Convert postgresql:// to postgresql+psycopg:// for async support (psycopg 3)
database_url = settings.database_url.replace(
    "postgresql://", "postgresql+psycopg://"
)

engine = create_async_engine(
    database_url,
    echo=False,
    pool_size=5,
    max_overflow=10,
    connect_args={
        "prepare_threshold": None,
    },
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    """Base class for SQLAlchemy ORM models."""
    pass


async def get_session() -> AsyncSession:
    """Dependency: yield an async DB session."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Create all tables (used on startup)."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

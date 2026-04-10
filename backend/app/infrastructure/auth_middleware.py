"""JWT Authentication middleware using Supabase.

Verifies JWT tokens locally using the Supabase JWT secret (HS256).
No external HTTP calls are made during verification.
"""

from __future__ import annotations

import logging
from functools import wraps
import json
from typing import Optional
from uuid import UUID

import jwt
from jwt import PyJWK
from fastapi import Depends, HTTPException, Header, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config import get_settings
from app.infrastructure.database import get_session
from app.infrastructure.user_repository import UserRepository
from app.infrastructure.models import UserProfileModel

logger = logging.getLogger(__name__)

async def get_current_user(
    authorization: str = Header(default=""),
    session: AsyncSession = Depends(get_session),
) -> UserProfileModel:
    """
    Extract and verify JWT from Authorization header.
    Returns the UserProfileModel for the authenticated user.

    Flow:
    1. Extract Bearer token from header
    2. Verify JWT signature using Supabase JWT secret
    3. Look up user profile by auth_id (sub claim)
    4. Check user is active
    """
    settings = get_settings()

    # Allow unauthenticated access if auth is not configured
    if not settings.supabase_jwt_secret:
        logger.warning("Auth not configured — allowing unauthenticated access")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication system not configured",
        )

    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid Authorization header",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.removeprefix("Bearer ").strip()

    try:
        secret = settings.supabase_jwt_secret.strip()
        if secret.startswith("{"):
            # It's a JWK (JSON Web Key) like ES256
            jwk_dict = json.loads(secret)
            key = PyJWK(jwk_dict).key
            payload = jwt.decode(
                token,
                key,
                algorithms=["HS256", "ES256", "RS256"],
                audience="authenticated",
                leeway=300,
            )
        else:
            # It's a standard HS256 string
            payload = jwt.decode(
                token,
                secret,
                algorithms=["HS256", "ES256", "RS256"],
                audience="authenticated",
                leeway=300,
            )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError as e:
        logger.error(f"JWT verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )
    except Exception as e:
        logger.error(f"Failed to verify JWT signature: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not verify token signature",
        )

    # Extract user info from JWT
    auth_id_str = payload.get("sub")
    if not auth_id_str:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject claim",
        )

    try:
        auth_id = UUID(auth_id_str)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid subject claim format",
        )

    # Look up user profile
    repo = UserRepository(session)
    user = await repo.get_by_auth_id(auth_id)

    if user is None:
        # Auto-create profile on first login
        email = payload.get("email", "")
        user_metadata = payload.get("user_metadata", {})
        display_name = user_metadata.get("display_name", email.split("@")[0])

        # Check if this is the admin email
        role = "admin" if (settings.admin_email and email.lower() == settings.admin_email.lower()) else "user"

        user = await repo.create(
            auth_id=auth_id,
            email=email,
            display_name=display_name,
            role=role,
            is_active=True if role == "admin" else False,
        )

        # If admin, grant access to all modules
        if role == "admin":
            from app.infrastructure.user_repository import ModuleRepository
            module_repo = ModuleRepository(session)
            all_modules = await module_repo.get_all()
            await repo.set_user_modules(
                user.id,
                [m.id for m in all_modules],
            )

        await session.commit()
        logger.info(f"Auto-created profile for {email} (role={role})")

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Ваш аккаунт ожидает подтверждения администратором",
        )

    return user


async def get_optional_user(
    authorization: str = Header(default=""),
    session: AsyncSession = Depends(get_session),
) -> Optional[UserProfileModel]:
    """Like get_current_user but returns None if not authenticated."""
    settings = get_settings()
    if not settings.supabase_jwt_secret or not authorization.startswith("Bearer "):
        return None
    try:
        return await get_current_user(authorization=authorization, session=session)
    except HTTPException:
        return None


def require_module(module_id: str):
    """Dependency factory — checks that the user has access to a specific module."""

    async def _check(
        user: UserProfileModel = Depends(get_current_user),
    ) -> UserProfileModel:
        # Admins have access to everything
        if user.role == "admin":
            return user

        # Check module access
        module_ids = [ma.module_id for ma in user.module_access]
        if module_id not in module_ids:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"No access to module: {module_id}",
            )
        return user

    return _check


def require_admin():
    """Dependency — checks that the user has admin role."""

    async def _check(
        user: UserProfileModel = Depends(get_current_user),
    ) -> UserProfileModel:
        if user.role != "admin":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin access required",
            )
        return user

    return _check

"""Password hashing and JWT helpers.

Passwords use PBKDF2-HMAC-SHA256 from the standard library (salted, 240k
iterations) so the MVP needs no native crypto build step.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone

import jwt

from app.config import settings

_ITERATIONS = 240_000


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return "$".join(
        [
            "pbkdf2_sha256",
            str(_ITERATIONS),
            base64.b64encode(salt).decode(),
            base64.b64encode(digest).decode(),
        ]
    )


def verify_password(password: str, encoded: str) -> bool:
    try:
        algorithm, iterations, salt_b64, digest_b64 = encoded.split("$")
        if algorithm != "pbkdf2_sha256":
            return False
        salt = base64.b64decode(salt_b64)
        expected = base64.b64decode(digest_b64)
        candidate = hashlib.pbkdf2_hmac(
            "sha256", password.encode(), salt, int(iterations)
        )
        return hmac.compare_digest(candidate, expected)
    except (ValueError, TypeError):
        return False


def create_access_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {"sub": user_id, "exp": expire, "iat": datetime.now(timezone.utc)}
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> str | None:
    try:
        payload = jwt.decode(
            token, settings.jwt_secret, algorithms=[settings.jwt_algorithm]
        )
        return payload.get("sub")
    except jwt.PyJWTError:
        return None

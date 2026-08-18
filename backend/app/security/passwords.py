"""Password hashing (bcrypt).

bcrypt truncates at 72 bytes, silently. Rather than let a long password have
its tail ignored, we reject it at validation time (see api/auth.py) and assert
here as a backstop.
"""
from __future__ import annotations

import bcrypt

from ..config import config

MAX_PASSWORD_BYTES = 72


def hash_password(plaintext: str) -> str:
    encoded = plaintext.encode("utf-8")
    if len(encoded) > MAX_PASSWORD_BYTES:
        raise ValueError(f"Password exceeds {MAX_PASSWORD_BYTES} bytes.")
    return bcrypt.hashpw(encoded, bcrypt.gensalt(rounds=config.bcrypt_rounds)).decode("utf-8")


def verify_password(plaintext: str, hashed: str | None) -> bool:
    """Constant-time check. Returns False rather than raising on a malformed hash."""
    if not hashed:
        # Still burn a comparison so a user with no password set is not
        # distinguishable from a wrong password by response time.
        bcrypt.checkpw(b"x", bcrypt.hashpw(b"x", bcrypt.gensalt(rounds=4)))
        return False
    try:
        return bcrypt.checkpw(plaintext.encode("utf-8")[:MAX_PASSWORD_BYTES], hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def needs_rehash(hashed: str) -> bool:
    """True when a stored hash predates the current cost factor."""
    try:
        return int(hashed.split("$")[2]) < config.bcrypt_rounds
    except (IndexError, ValueError):
        return True

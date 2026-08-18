"""Blueprint registry. Every module here owns one resource family."""
from __future__ import annotations

from .auth import bp as auth_bp

BLUEPRINTS = (auth_bp,)

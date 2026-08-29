"""Authentication and authorisation decorators.

Order matters: @require_auth resolves the principal onto `g`; every other
decorator here assumes it has already run, and applies it implicitly if the
caller forgot, so a role check can never silently pass on an anonymous request.

These cover coarse, role-shaped gates. Rules that depend on the *state of a
row* (only the applicant may edit this proposal; only the head of the unit this
task routed to may approve it) live in services/authorization.py, because they
need the row loaded first.
"""
from __future__ import annotations

import functools
from typing import Callable

from flask import g, request

from ..errors import Forbidden, Unauthorized
from .principal import current_principal, load_principal
from .tokens import ACCESS, decode_token


def _bearer_token() -> str:
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthorized("Authentication is required.", code="missing_token")
    return token.strip()


def authenticate() -> None:
    """Resolve the bearer token to a Principal on `g`. Idempotent."""
    if getattr(g, "principal", None) is not None:
        return
    claims = decode_token(_bearer_token(), expected_type=ACCESS)
    principal = load_principal(claims["user_id"])
    g.principal = principal
    g.user_id = principal.user_id


def authenticate_optional() -> None:
    """authenticate() for endpoints that are public but personalise their response when the caller
    happens to be signed in (/ai/ask, the event discovery routes).

    NO credential offered -> guest, and the endpoint serves its public tier. That is the whole
    reason this exists rather than authenticate().

    A credential that does not VERIFY -> 401, exactly like any protected route. It used to be
    swallowed and treated as a guest, on the reasoning that a public endpoint should never refuse
    anyone. That was wrong in a way that was invisible from the server: an expired access token is
    what a signed-in user sends, so their request came back 200 with the signed-out answer, and
    because it was never a 401, auth.interceptor.ts never ran its refresh-and-replay - the one
    mechanism that recovers an expired session. The user stayed silently downgraded to a guest for
    the life of that tab while every other page in the app refreshed normally and worked.

    On /ai/ask that surfaced as a wrong authorization answer, not just missing personalisation: a
    guest holds no assignments, so ai/topic_access.py denied `clubs` (and kept `events`, its one
    GUEST_OPEN_TOPIC) and the assistant told a signed-in student "an administrator has not granted
    your role" about pages their role is in fact granted - see tests/test_auth_wiring.py.

    Unauthorized from decode_token/load_principal therefore propagates: expired, malformed, wrong
    token type, archived or deactivated account. Each one means "your session is over, refresh or
    sign in again", which is a thing the client can act on, and none of them is a guest."""
    if getattr(g, "principal", None) is not None:
        return
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return
    claims = decode_token(token.strip(), expected_type=ACCESS)
    principal = load_principal(claims["user_id"])
    g.principal = principal
    g.user_id = principal.user_id


def require_auth(fn: Callable) -> Callable:
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        authenticate()
        return fn(*args, **kwargs)

    wrapper.__auth_required__ = True
    return wrapper


def require_roles(*role_codes: str) -> Callable:
    """Actor must hold at least one of `role_codes`, in any unit. system-admin always passes."""

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            authenticate()
            principal = current_principal()
            if not principal.is_admin and not principal.has_role(*role_codes):
                raise Forbidden("You do not have permission to perform this action.")
            return fn(*args, **kwargs)

        wrapper.__auth_required__ = True
        wrapper.__required_roles__ = role_codes
        return wrapper

    return decorator


def require_admin(fn: Callable) -> Callable:
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        authenticate()
        if not current_principal().is_admin:
            raise Forbidden("This action requires system administrator access.")
        return fn(*args, **kwargs)

    wrapper.__auth_required__ = True
    wrapper.__required_roles__ = ("system-admin",)
    return wrapper


def require_unit_head(unit_arg: str = "unit_code") -> Callable:
    """Actor must head the unit named by the view's `unit_arg` path parameter."""

    def decorator(fn: Callable) -> Callable:
        @functools.wraps(fn)
        def wrapper(*args, **kwargs):
            authenticate()
            principal = current_principal()
            unit_code = kwargs.get(unit_arg)
            if not principal.is_admin and not principal.heads_unit(unit_code):
                raise Forbidden("You do not head this unit.")
            return fn(*args, **kwargs)

        wrapper.__auth_required__ = True
        return wrapper

    return decorator


def require_internal(fn: Callable) -> Callable:
    """Block self-registered external guest accounts from internal endpoints."""

    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        authenticate()
        if current_principal().is_external:
            raise Forbidden("This area is for staff and students only.")
        return fn(*args, **kwargs)

    wrapper.__auth_required__ = True
    return wrapper

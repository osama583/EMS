"""Wiring tests that need no database.

They assert the security envelope: unauthenticated requests are refused, bad
tokens are refused, error bodies keep their shape, and security headers are
present. Anything touching real rows is covered by the integration tests that
run against a seeded database.
"""
from __future__ import annotations

from datetime import timedelta

import pytest
from flask import g

from app import create_app
from app.security import authenticate_optional
from app.security.tokens import ACCESS, _issue, issue_access_token, issue_refresh_token


@pytest.fixture()
def client():
    app = create_app(validate_config=False)
    app.config["TESTING"] = True
    return app.test_client()


def test_protected_route_requires_a_token(client):
    res = client.get("/api/v1/auth/me")
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "missing_token"


def test_garbage_token_is_rejected(client):
    res = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer not-a-jwt"})
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "token_invalid"


def test_refresh_token_cannot_be_used_as_an_access_token(client):
    """The `typ` claim is what stops a long-lived refresh token authenticating requests."""
    refresh, _ = issue_refresh_token(1)
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {refresh}"})
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "token_invalid"


def test_access_token_cannot_be_used_to_refresh(client):
    access, _ = issue_access_token(1)
    res = client.post("/api/v1/auth/refresh", json={"refreshToken": access})
    assert res.status_code == 401


def test_login_requires_email_and_password(client):
    assert client.post("/api/v1/auth/login", json={}).status_code == 400
    assert client.post("/api/v1/auth/login", json={"email": "a@b.c"}).status_code == 400


def test_login_rejects_a_non_json_body(client):
    res = client.post("/api/v1/auth/login", data="email=a@b.c")
    assert res.status_code == 400
    assert res.get_json()["error"]["code"] == "bad_request"


def test_unknown_route_returns_the_standard_error_envelope(client):
    res = client.get("/api/v1/does-not-exist")
    assert res.status_code == 404
    body = res.get_json()
    assert body["error"]["code"] == "not_found"
    assert "request_id" in body["error"]


def test_security_headers_and_request_id_are_set(client):
    res = client.get("/api/v1/auth/me")
    assert res.headers["X-Content-Type-Options"] == "nosniff"
    assert res.headers["X-Frame-Options"] == "DENY"
    assert res.headers["Cache-Control"] == "no-store"
    assert res.headers["X-Request-Id"]


def test_inbound_request_id_is_echoed_back(client):
    res = client.get("/api/v1/auth/me", headers={"X-Request-Id": "trace-me-123"})
    assert res.headers["X-Request-Id"] == "trace-me-123"
    assert res.get_json()["error"]["request_id"] == "trace-me-123"


# --- Optional authentication on the public endpoints ---------------------------------------
# authenticate_optional() backs the endpoints that are public but personalise themselves for a signed-
# in caller (/ai/ask, the event discovery routes).


def _expired_access_token(user_id: int = 1) -> str:
    token, _ = _issue(user_id, ACCESS, timedelta(minutes=-5))
    return token


def test_expired_token_on_a_public_endpoint_is_refused_not_downgraded_to_guest(client):
    """The regression: 200-as-a-guest gave the interceptor nothing to refresh on."""
    res = client.post(
        "/api/v1/ai/ask",
        json={"question": "suggest clubs for me"},
        headers={"Authorization": f"Bearer {_expired_access_token()}"},
    )
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "token_expired"


def test_garbage_token_on_a_public_endpoint_is_refused(client):
    res = client.post(
        "/api/v1/ai/ask",
        json={"question": "suggest clubs for me"},
        headers={"Authorization": "Bearer not-a-jwt"},
    )
    assert res.status_code == 401
    assert res.get_json()["error"]["code"] == "token_invalid"


def test_a_refresh_token_cannot_authenticate_a_public_endpoint(client):
    refresh, _ = issue_refresh_token(1)
    res = client.post(
        "/api/v1/ai/ask",
        json={"question": "suggest clubs for me"},
        headers={"Authorization": f"Bearer {refresh}"},
    )
    assert res.status_code == 401


def test_no_token_at_all_is_still_a_guest_not_a_401():
    """The other half of the rule, and the reason this is not just authenticate(): a visitor who
    offers no credential must keep reaching the public tier."""
    app = create_app(validate_config=False)
    with app.test_request_context("/api/v1/ai/ask"):
        authenticate_optional()
        assert getattr(g, "principal", None) is None


def test_a_non_bearer_authorization_header_is_still_a_guest():
    app = create_app(validate_config=False)
    with app.test_request_context("/api/v1/ai/ask", headers={"Authorization": "Basic abc123"}):
        authenticate_optional()
        assert getattr(g, "principal", None) is None

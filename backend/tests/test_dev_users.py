"""Tests for the TESTING ONLY demo-user picker endpoint (GET /auth/dev-users).

Delete this file when the feature is removed — see config.demo_mode.
"""
from __future__ import annotations

from dataclasses import replace

import pytest

from app import create_app
from app.api import auth as auth_module
from app.config import _bool


@pytest.fixture()
def client():
    app = create_app(validate_config=False)
    app.config["TESTING"] = True
    return app.test_client()


def test_demo_mode_is_off_when_the_variable_is_unset(monkeypatch):
    """The shipped default. Asserted against the parser rather than the
    imported singleton, whose field defaults were evaluated once at import -
    a developer with the picker enabled in their own .env would otherwise fail
    an assertion about the default, which says nothing about the code."""
    monkeypatch.delenv("DEMO_MODE", raising=False)
    assert _bool("DEMO_MODE") is False


@pytest.mark.parametrize("raw", ["", "false", "False", "0", "no", "yes", "1", "TRUE-ish"])
def test_demo_mode_needs_the_literal_string_true(raw, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", raw)
    assert _bool("DEMO_MODE") is False


@pytest.mark.parametrize("raw", ["true", "TRUE", " True "])
def test_demo_mode_accepts_true_case_insensitively(raw, monkeypatch):
    monkeypatch.setenv("DEMO_MODE", raw)
    assert _bool("DEMO_MODE") is True


def test_dev_users_route_404s_when_demo_mode_is_off(client, monkeypatch):
    monkeypatch.setattr(
        auth_module, "config", replace(auth_module.config, demo_mode=False)
    )
    res = client.get("/api/v1/auth/dev-users")
    assert res.status_code == 404


def test_dev_users_route_returns_users_when_demo_mode_is_on(client, monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "config",
        replace(auth_module.config, demo_mode=True, demo_password="Demo-test123"),
    )
    fake_rows = [
        {
            "id": "1",
            "displayName": "Jane Tan",
            "email": "jane.tan@apu.edu.my",
            "roleLabel": "Lecturer",
            "department": "School of Computing",
        },
    ]
    monkeypatch.setattr(auth_module, "_dev_user_rows", lambda: fake_rows)

    res = client.get("/api/v1/auth/dev-users")
    assert res.status_code == 200
    body = res.get_json()
    assert body == [
        {
            "id": "1",
            "displayName": "Jane Tan",
            "email": "jane.tan@apu.edu.my",
            "roleLabel": "Lecturer",
            "department": "School of Computing",
            "password": "Demo-test123",
        },
    ]


def test_dev_users_route_omits_password_field_shape_when_no_users(client, monkeypatch):
    monkeypatch.setattr(
        auth_module,
        "config",
        replace(auth_module.config, demo_mode=True, demo_password="Demo-test123"),
    )
    monkeypatch.setattr(auth_module, "_dev_user_rows", lambda: [])

    res = client.get("/api/v1/auth/dev-users")
    assert res.status_code == 200
    assert res.get_json() == []

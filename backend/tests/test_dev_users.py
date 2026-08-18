"""Tests for the TESTING ONLY demo-user picker endpoint (GET /auth/dev-users).

Delete this file when the feature is removed — see config.demo_mode.
"""
from __future__ import annotations

from dataclasses import replace

import pytest

from app import create_app
from app.api import auth as auth_module


@pytest.fixture()
def client():
    app = create_app(validate_config=False)
    app.config["TESTING"] = True
    return app.test_client()


def test_dev_users_config_defaults_to_disabled():
    from app.config import config

    assert config.demo_mode is False
    assert config.demo_password == ""


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

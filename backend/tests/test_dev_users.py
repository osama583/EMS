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

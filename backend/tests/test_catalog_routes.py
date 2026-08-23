"""Routing and guard tests for the event category/format catalogues.

No database: these assert the URL map and the auth envelope, which is where
the frontend/backend mismatch actually lived. Behaviour that touches rows is
covered by the live check in tests/test_catalog_live.py.
"""
from __future__ import annotations

import pytest

from app import create_app
from app.api.catalog import CATALOGUES


@pytest.fixture()
def client():
    app = create_app(validate_config=False)
    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture()
def rules():
    return {str(r) for r in create_app(validate_config=False).url_map.iter_rules()}


PREFIX = "/api/v1/catalog"


def test_both_catalogues_are_registered():
    assert set(CATALOGUES) == {"categories", "formats"}


@pytest.mark.parametrize(
    "rule",
    [
        f"{PREFIX}/<resource>",
        f"{PREFIX}/<resource>/deleted",
        f"{PREFIX}/<resource>/<int:entry_id>",
        f"{PREFIX}/<resource>/<int:entry_id>/status",
        f"{PREFIX}/<resource>/<int:entry_id>/restore",
        f"{PREFIX}/<resource>/<int:entry_id>/purge",
        f"{PREFIX}/<resource>/<int:entry_id>/deletion-check",
    ],
)
def test_the_frontend_surface_exists(rule, rules):
    """Every operation event-catalog.repository.ts calls has a route.

    The bug this covers: the client drove /catalog/categories and
    /catalog/formats against a backend that only served two read-only
    /catalog/event-* endpoints, so seven of its nine calls 404'd.
    """
    assert rule in rules


def test_the_pre_migration_paths_still_resolve(rules):
    assert f"{PREFIX}/event-categories" in rules
    assert f"{PREFIX}/event-formats" in rules


@pytest.mark.parametrize("resource", ["categories", "formats"])
def test_reads_are_public(client, resource):
    """Category/format names are reference vocabulary, not private data - the
    Explore Events filters need them before a guest has signed in, same as
    the published events they filter (GET /events uses authenticate_optional
    for the same reason)."""
    assert client.get(f"{PREFIX}/{resource}").status_code == 200


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", ""),
        ("put", "/1"),
        ("patch", "/1/status"),
        ("delete", "/1"),
        ("post", "/1/restore"),
        ("delete", "/1/purge"),
        ("get", "/1/deletion-check"),
        ("get", "/deleted"),
    ],
)
def test_writes_and_the_bin_are_closed_to_anonymous_callers(client, method, path):
    """A missing token must never reach the handler - an unauthenticated 404
    here would mean the route ran and merely failed to find a row."""
    res = getattr(client, method)(f"{PREFIX}/categories{path}")
    assert res.status_code == 401


def test_static_sibling_routes_win_over_the_resource_placeholder(client):
    """/catalog/config and friends must not be swallowed by /catalog/<resource>.

    Werkzeug prefers static rules, so these reach their own handlers and fail
    on the token rather than on an unknown-catalogue lookup.
    """
    for path in ("config", "requirements", "units", "cafeterias"):
        assert client.get(f"{PREFIX}/{path}").status_code == 401

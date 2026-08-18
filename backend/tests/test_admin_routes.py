"""The admin surface the Angular directory pages actually call.

No database: these assert the URL map and the auth envelope. The bug they
cover is a whole class of migration gap - the client driving endpoints that
were never carried over from the Node backend, so the pages loaded and then
every button 404'd. Behaviour against real rows is exercised separately.
"""
from __future__ import annotations

import pytest

from app import create_app

PREFIX = "/api/v1/admin"


@pytest.fixture()
def client():
    app = create_app(validate_config=False)
    app.config["TESTING"] = True
    return app.test_client()


@pytest.fixture(scope="module")
def rules():
    app = create_app(validate_config=False)
    return {(str(r), m) for r in app.url_map.iter_rules() for m in r.methods}


# (path, method) for every call in admin-directory.repository.ts.
CLIENT_SURFACE = [
    ("/users", "GET"),
    ("/users", "POST"),
    ("/users/deleted", "GET"),
    ("/users/<int:user_id>", "PUT"),
    ("/users/<int:user_id>", "DELETE"),
    ("/users/<int:user_id>/status", "PATCH"),
    ("/users/<int:user_id>/deletion-check", "GET"),
    ("/users/<int:user_id>/restore", "POST"),
    ("/users/<int:user_id>/purge", "DELETE"),
    ("/users/<int:user_id>/assignments", "GET"),
    ("/users/<int:user_id>/assignments", "POST"),
    ("/users/<int:user_id>/assignments/<int:assignment_id>", "DELETE"),
    ("/units", "GET"),
    ("/units", "POST"),
    ("/units/archive", "GET"),
    ("/units/<code>", "PUT"),
    ("/units/<code>", "DELETE"),
    ("/units/<code>/status", "PATCH"),
    ("/units/<code>/deletion-check", "GET"),
    ("/units/<code>/restore", "POST"),
    ("/units/<code>/purge", "DELETE"),
    ("/units/<code>/eligible-roles", "GET"),
    ("/roles", "GET"),
    ("/roles", "POST"),
    ("/roles/flat", "GET"),
    ("/roles/archive", "GET"),
    ("/roles/<code>", "PUT"),
    ("/roles/<code>", "DELETE"),
    ("/roles/<code>/deletion-check", "GET"),
    ("/roles/<code>/restore", "POST"),
    ("/roles/<code>/purge", "DELETE"),
    ("/nav-pages", "GET"),
    ("/nav-pages", "POST"),
    ("/nav-pages/deleted", "GET"),
    ("/nav-pages/eligible-roles", "GET"),
    ("/nav-pages/<page_code>", "PUT"),
    ("/nav-pages/<page_code>", "DELETE"),
    ("/nav-pages/<page_code>/deletion-check", "GET"),
    ("/nav-pages/<page_code>/restore", "POST"),
    ("/nav-pages/<page_code>/purge", "DELETE"),
    ("/nav-pages/<page_code>/grants", "POST"),
    ("/nav-pages/<page_code>/grants/<int:grant_id>", "PUT"),
    ("/nav-pages/<page_code>/grants/<int:grant_id>", "PATCH"),
    ("/nav-pages/<page_code>/grants/<int:grant_id>", "DELETE"),
]


@pytest.mark.parametrize(("path", "method"), CLIENT_SURFACE)
def test_the_client_surface_exists(path, method, rules):
    assert (PREFIX + path, method) in rules


# Every admin route is admin-only, so an anonymous caller must be turned away
# by the token check - never by the handler, which would leak whether a record
# exists through the difference between 401 and 404.
ANONYMOUS_PROBES = [
    ("get", "/users"),
    ("post", "/users"),
    ("get", "/users/deleted"),
    ("put", "/users/1"),
    ("delete", "/users/1"),
    ("patch", "/users/1/status"),
    ("delete", "/users/1/purge"),
    ("get", "/units"),
    ("post", "/units"),
    ("get", "/units/archive"),
    ("put", "/units/x"),
    ("delete", "/units/x/purge"),
    ("get", "/units/x/eligible-roles"),
    ("get", "/roles"),
    ("get", "/roles/flat"),
    ("get", "/roles/archive"),
    ("put", "/roles/x"),
    ("delete", "/roles/x/purge"),
    ("get", "/nav-pages"),
    ("post", "/nav-pages"),
    ("get", "/nav-pages/deleted"),
    ("get", "/nav-pages/eligible-roles"),
    ("put", "/nav-pages/x"),
    ("delete", "/nav-pages/x/purge"),
    ("post", "/nav-pages/x/grants"),
    ("put", "/nav-pages/x/grants/1"),
    ("patch", "/nav-pages/x/grants/1"),
    ("delete", "/nav-pages/x/grants/1"),
]


@pytest.mark.parametrize(("method", "path"), ANONYMOUS_PROBES)
def test_admin_routes_reject_anonymous_callers(client, method, path):
    assert getattr(client, method)(PREFIX + path).status_code == 401


def test_static_role_routes_win_over_the_code_placeholder(client):
    """/roles/flat and /roles/archive must not be read as a role code.

    Werkzeug prefers static rules, so both reach their own handler and fail on
    the token rather than looking up a role literally named "flat".
    """
    assert client.get(f"{PREFIX}/roles/flat").status_code == 401
    assert client.get(f"{PREFIX}/roles/archive").status_code == 401


def test_static_nav_page_routes_win_over_the_page_code_placeholder(client):
    assert client.get(f"{PREFIX}/nav-pages/deleted").status_code == 401
    assert client.get(f"{PREFIX}/nav-pages/eligible-roles").status_code == 401


def test_users_deleted_is_not_read_as_a_user_id(client):
    """/users/deleted resolves to the bin, not to <int:user_id>, which would
    404 on the converter instead."""
    assert client.get(f"{PREFIX}/users/deleted").status_code == 401

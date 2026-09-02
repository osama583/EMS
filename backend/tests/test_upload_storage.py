"""Where an uploaded file's bytes live.

They used to live only in backend/var/uploads, which is gitignored and local to
one machine, while the /api/v1/uploads/{key} pointer that references them lives
in a shared remote database. So the pointer travelled between machines and
checkouts and the bytes did not: a proposal reopened anywhere else - draft,
resubmission, ongoing or history - showed a broken event image, permanently.

These pin the property that fixes it: a file stored through this API serves back
without the upload directory holding anything, and a file that predates the move
still serves off disk.
"""
from __future__ import annotations

import pytest

from app import create_app
from app.api import uploads
from app.db import transaction

PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDAT\x78\x9c\x63\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture()
def app():
    return create_app()


@pytest.fixture()
def stored(app):
    """A file put through the real _store, removed from the table afterwards."""
    keys: list[str] = []

    def store(data: bytes) -> str:
        with app.app_context():
            key = uploads._store(data, "image/png", ".png")
        keys.append(key)
        return key

    yield store
    with app.app_context(), transaction() as cur:
        for key in keys:
            cur.execute("DELETE FROM upload_file WHERE storage_key = %s", (key,))


def test_a_stored_file_serves_without_touching_the_upload_directory(app, stored):
    key = stored(PNG + b"db-backed")
    assert not (uploads.UPLOAD_DIR / key).exists()

    response = app.test_client().get(f"/api/v1/uploads/{key}")
    assert response.status_code == 200
    assert response.data == PNG + b"db-backed"
    assert response.mimetype == "image/png"


def test_a_file_written_before_the_move_still_serves_off_disk(app):
    """The fallback that makes deploying this safe: an upload made against the
    old build must not start 404ing the moment the new one ships."""
    uploads.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    key = "0123456789abcdef0123456789abcdef.png"
    path = uploads.UPLOAD_DIR / key
    path.write_bytes(PNG + b"legacy")
    try:
        response = app.test_client().get(f"/api/v1/uploads/{key}")
        assert response.status_code == 200
        assert response.data == PNG + b"legacy"
        assert response.mimetype == "image/png"
    finally:
        path.unlink(missing_ok=True)

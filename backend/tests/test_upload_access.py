"""Who may read a stored upload.

GET /uploads/{key} serves two populations out of one directory: event images,
which the landing page shows to signed-out visitors, and payment receipts, which
are somebody's bank record. It used to serve both to anyone holding the key,
with no authentication and no expiry.

The fix cannot be @require_auth - a receipt is displayed with <img src> and this
app authenticates with a bearer token, which a browser does not attach to an
image request - so a private file is gated on a short-lived signature instead.
These tests pin the properties that makes it worth anything:

  * an event image still serves to a guest,
  * a receipt does not serve without a signature,
  * a signature for one file does not open another,
  * an expired signature is refused, and
  * the signature the API actually hands out works.

The private/public split is decided by what REFERENCES the file, so each test
inserts a real event_registration row and rolls it back.
"""
from __future__ import annotations

import hashlib
import time
from pathlib import Path

import pytest

from app import create_app
from app.api import uploads
from app.db import fetch_one, get_connection

PNG = (
    b"\x89PNG\r\n\x1a\n"
    b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
    b"\x00\x00\x00\nIDAT\x78\x9c\x63\x00\x01\x00\x00\x05\x00\x01\r\n\x2d\xb4"
    b"\x00\x00\x00\x00IEND\xaeB`\x82"
)


@pytest.fixture()
def client():
    return create_app().test_client()


@pytest.fixture()
def cur():
    with get_connection() as conn:
        with conn.cursor() as c:
            yield c
        conn.rollback()


# Files these tests put on disk, removed afterwards so a test run does not
# accumulate junk in the real upload directory.
_WRITTEN: list[Path] = []


@pytest.fixture(autouse=True)
def _clean_up_stored_files():
    yield
    for path in _WRITTEN:
        path.unlink(missing_ok=True)
    _WRITTEN.clear()


def _store_file(payload: bytes) -> str:
    """Put a real file on disk the way upload() would, and return its key."""
    uploads.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha256(payload).hexdigest()[:32] + ".png"
    path = uploads.UPLOAD_DIR / key
    path.write_bytes(payload)
    _WRITTEN.append(path)
    return key


def _mark_as_payment_proof(cur, key: str, nth: int = 0) -> None:
    """Cite the key as some registration's payment proof, which is what makes it
    private - sensitivity is a property of the reference, not of the bytes.

    `nth` picks a DIFFERENT registration each time. Marking two keys against one
    row would have the second overwrite the first, quietly leaving the first key
    public and the test asserting nothing.
    """
    row = fetch_one(
        cur,
        "SELECT event_registration_id FROM event_registration "
        " ORDER BY event_registration_id OFFSET %s LIMIT 1",
        (nth,),
    )
    assert row, f"seed has fewer than {nth + 1} registrations to attach a proof to"
    cur.execute(
        "UPDATE event_registration SET payment_proof_url = %s WHERE event_registration_id = %s",
        (f"{uploads.URL_PREFIX}{key}", row["event_registration_id"]),
    )
    # The endpoint opens its own connection, so the row has to be visible to it.
    cur.connection.commit()


def test_an_event_image_still_serves_to_a_guest(client):
    """The landing page has no token to offer. Locking every upload behind auth
    would have shown every signed-out visitor broken pictures."""
    key = _store_file(PNG + b"public")
    response = client.get(f"/api/v1/uploads/{key}")
    assert response.status_code == 200
    assert response.data.startswith(b"\x89PNG")


def test_a_payment_receipt_is_refused_without_a_signature(client, cur):
    """The reported hole: anyone holding the URL could read somebody's receipt."""
    key = _store_file(PNG + b"receipt-unsigned")
    _mark_as_payment_proof(cur, key)
    try:
        response = client.get(f"/api/v1/uploads/{key}")
        assert response.status_code == 403
        # The file is on disk and the key is valid; what is missing is permission.
        assert (uploads.UPLOAD_DIR / key).exists()
    finally:
        cur.connection.rollback()


def test_a_signature_for_one_file_does_not_open_another(client, cur):
    """The signature covers the key, so it cannot be lifted onto a different one."""
    private_key = _store_file(PNG + b"receipt-a")
    other_key = _store_file(PNG + b"receipt-b")
    _mark_as_payment_proof(cur, private_key, nth=0)
    _mark_as_payment_proof(cur, other_key, nth=1)
    try:
        expires = int(time.time()) + 600
        borrowed = uploads._signature(other_key, expires)
        response = client.get(
            f"/api/v1/uploads/{private_key}?expires={expires}&signature={borrowed}"
        )
        assert response.status_code == 403
    finally:
        cur.connection.rollback()


def test_an_expired_signature_is_refused(client, cur):
    """The expiry window is the whole protection for a URL that has leaked."""
    key = _store_file(PNG + b"receipt-expired")
    _mark_as_payment_proof(cur, key)
    try:
        expires = int(time.time()) - 1
        response = client.get(
            f"/api/v1/uploads/{key}?expires={expires}&signature={uploads._signature(key, expires)}"
        )
        assert response.status_code == 403
    finally:
        cur.connection.rollback()


def test_the_expiry_cannot_be_extended_without_resigning(client, cur):
    """Expiry is inside the signed message, so pushing it forward invalidates it."""
    key = _store_file(PNG + b"receipt-extend")
    _mark_as_payment_proof(cur, key)
    try:
        issued = int(time.time()) + 60
        signature = uploads._signature(key, issued)
        response = client.get(
            f"/api/v1/uploads/{key}?expires={issued + 86400}&signature={signature}"
        )
        assert response.status_code == 403
    finally:
        cur.connection.rollback()


def test_the_signed_url_the_api_hands_out_actually_works(client, cur):
    """The other four tests are worthless if the real link is broken too."""
    key = _store_file(PNG + b"receipt-valid")
    _mark_as_payment_proof(cur, key)
    try:
        signed = uploads.sign_upload_url(f"{uploads.URL_PREFIX}{key}")
        response = client.get(signed)
        assert response.status_code == 200
        assert response.data.startswith(b"\x89PNG")
        # A private file must not linger in a shared cache after its link dies.
        assert "no-store" in response.headers.get("Cache-Control", "")
    finally:
        cur.connection.rollback()


def test_a_legacy_or_empty_proof_url_passes_through_unsigned():
    """The column predates this endpoint and once held data URLs. Signing must
    not mangle a value it does not recognise as one of our own keys."""
    assert uploads.sign_upload_url(None) is None
    assert uploads.sign_upload_url("") == ""
    assert uploads.sign_upload_url("data:image/png;base64,AAAA") == "data:image/png;base64,AAAA"

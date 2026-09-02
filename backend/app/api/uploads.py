"""File uploads: event images and payment receipts.

    POST /uploads          accept a base64 data URL, return a stable URL
    GET  /uploads/{key}    serve a stored file

`kind` picks the accepted type set: images only by default, images plus
PDF for kind='document' (payment receipts).

WHO MAY READ A STORED FILE. Two populations share this directory and they are
not equally public:

  * An event image is rendered on the landing page, which serves guests. It has
    to be readable without a token or every unauthenticated visitor sees broken
    pictures.
  * A payment receipt is somebody's bank record. Only the payer and the
    organiser deciding their registration have any business reading it.

serve() used to require nothing at all, so a receipt was readable by anyone who
had its URL, forever, signed in or not. The keys are SHA-256 prefixes and not
guessable, but a URL that leaks - a shared screenshot, a browser history, a
referrer - stayed valid indefinitely, and nothing about the request identified
who was asking.

The obvious fix, @require_auth on serve(), does not work here: the receipt is
displayed with <img src> (hub-registrations.html) and this app authenticates
with a bearer token, which a browser does not attach to an image request. It
would have replaced a privacy hole with a broken feature.

So a private file needs a SIGNATURE rather than a session: the endpoints that
already decide who may see a registration hand out a short-lived signed URL
(sign_upload_url below), and serve() verifies the signature. Authorisation stays
where it already was and was already correct - my_registration is the caller's
own, list_registrations is organiser-only - and this file merely stops honouring
URLs that authorisation never issued. An event image is unaffected and stays
public.

`request.event_image` is VARCHAR(255), so a data URL cannot be stored in the
column at all — it has to become a reference. That is why this endpoint exists
rather than the client inlining base64 the way the JSON mock allowed.

WHERE THE BYTES LIVE. In the upload_file table, next to the rows that reference
them. They used to live only on local disk under UPLOAD_DIR, which is gitignored
while the database is shared and remote - so the /api/v1/uploads/{key} pointer
travelled between machines and checkouts and the file did not, and every image
uploaded somewhere else resolved to a 404 forever. The URL contract is unchanged;
only _store and serve moved. Disk is still read as a fallback so files written
before the move keep serving (scripts/backfill_uploads.py folds them in).
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import hmac
import pathlib
import re
import time

import psycopg2
from flask import Blueprint, Response, jsonify, request

from ..config import config
from ..db import fetch_one, transaction
from ..errors import BadRequest, Forbidden, NotFound
from ..extensions import limiter
from ..security import require_auth
from ._helpers import body

bp = Blueprint("uploads", __name__, url_prefix="/uploads")

UPLOAD_DIR = pathlib.Path(__file__).resolve().parent.parent.parent / "var" / "uploads"
MAX_BYTES = 5 * 1024 * 1024

# Raster formats only. SVG is excluded deliberately: it can carry script, and
# these files are served from our own origin.
IMAGE_TYPES = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

# A payment proof is whatever the bank handed the payer, and for an online
# transfer that is very often a PDF receipt rather than a screenshot. The upload
# form has always offered PDF ("PNG, JPG, WebP or PDF"); the server accepted
# images only, so choosing the receipt the bank actually sent failed with
# "Unsupported image type" and the only way to register was to screenshot it.
#
# PDF is confined to kind='document' and deliberately kept out of IMAGE_TYPES: an
# event image is rendered in an <img>, so accepting a PDF there would produce
# nothing but a broken picture on the event card.
DOCUMENT_TYPES = {**IMAGE_TYPES, "application/pdf": ".pdf"}

KINDS = {"image": IMAGE_TYPES, "document": DOCUMENT_TYPES}

_DATA_URL = re.compile(r"^data:(?P<mime>[\w/+.-]+);base64,(?P<payload>.+)$", re.DOTALL)
# A stored key is exactly this shape; anything else never reaches the filesystem.
_KEY = re.compile(r"^[0-9a-f]{32}\.(png|jpg|webp|gif|pdf)$")

# The one shape this API mints. Both the signer and the private-file lookup
# compare against it, so a change here cannot desynchronise them.
URL_PREFIX = "/api/v1/uploads/"


def _store(data: bytes, mime: str, extension: str) -> str:
    # Content-addressed: re-uploading the same image reuses one row rather than
    # accumulating duplicates, so the same key is safe to insert twice.
    key = hashlib.sha256(data).hexdigest()[:32] + extension
    with transaction() as cur:
        cur.execute(
            "INSERT INTO upload_file (storage_key, content_type, content) VALUES (%s, %s, %s) "
            "ON CONFLICT (storage_key) DO NOTHING",
            (key, mime, psycopg2.Binary(data)),
        )
    return key


@bp.post("")
@require_auth
@limiter.limit("30 per minute")
def upload():
    """Accept a base64 data URL and return {storageKey, url}.

    kind='image' (the default) takes pictures only, for anything that ends up in
    an <img>. kind='document' additionally takes PDF, for a file that is merely
    stored and linked - a payment receipt being the one caller.
    """
    payload = body()
    kind = str(payload.get("kind") or "image").lower()
    allowed = KINDS.get(kind)
    if allowed is None:
        raise BadRequest("kind must be one of: " + ", ".join(sorted(KINDS)) + ".")
    accepted = "PNG, JPEG, WebP or GIF" if kind == "image" else "PNG, JPEG, WebP, GIF or PDF"

    data_url = str(payload.get("dataUrl") or "")
    match = _DATA_URL.match(data_url)
    if not match:
        raise BadRequest("Provide the file as a base64 data URL in 'dataUrl'.")

    mime = match.group("mime").lower()
    if mime not in allowed:
        raise BadRequest(f"Unsupported file type. Use {accepted}.")

    try:
        raw = base64.b64decode(match.group("payload"), validate=True)
    except (binascii.Error, ValueError):
        raise BadRequest("The file data is not valid base64.") from None

    if not raw:
        raise BadRequest("The file is empty.")
    if len(raw) > MAX_BYTES:
        raise BadRequest(f"Files must be {MAX_BYTES // (1024 * 1024)} MB or smaller.")

    # Trust the magic bytes, not the declared MIME type: a caller can label
    # anything image/png. Matched against the DECLARED type specifically rather
    # than against "any known format", so a PDF cannot be smuggled past
    # kind='image' by labelling it image/png.
    if not _matches_magic(raw, mime):
        raise BadRequest("That file's contents do not match the type it claims to be.")

    key = _store(raw, mime, allowed[mime])
    return jsonify({"storageKey": key, "url": f"{URL_PREFIX}{key}"}), 201


def _matches_magic(raw: bytes, mime: str) -> bool:
    if mime == "image/png":
        return raw.startswith(b"\x89PNG\r\n\x1a\n")
    if mime == "image/jpeg":
        return raw.startswith(b"\xff\xd8\xff")
    if mime == "image/gif":
        return raw.startswith(b"GIF87a") or raw.startswith(b"GIF89a")
    if mime == "image/webp":
        return raw[:4] == b"RIFF" and raw[8:12] == b"WEBP"
    if mime == "application/pdf":
        return raw.startswith(b"%PDF-")
    return False


# How long a signed link stays good. Long enough that a reviewer can leave the
# registrations page open through a meeting and still see the receipts when they
# come back, short enough that a URL which escapes into a chat log or a browser
# history is worthless by the time anyone finds it. The window is the whole
# protection, so it is deliberately not "a day".
SIGNED_URL_TTL_SECONDS = 6 * 60 * 60


def _signature(key: str, expires_at: int) -> str:
    """HMAC over the key AND its expiry, so neither can be edited independently.

    Signing the key alone would produce a permanent token; signing the expiry
    alone would let one file's token open another. They are signed together and
    compared whole.
    """
    message = f"{key}:{expires_at}".encode()
    return hmac.new(config.secret_key.encode(), message, hashlib.sha256).hexdigest()[:32]


def sign_upload_url(stored_url: str | None) -> str | None:
    """Turn a stored payment-proof URL into a short-lived signed one.

    Called by every endpoint that hands a receipt to somebody it has already
    decided may see it. Anything that is not one of our own upload URLs - a
    legacy data URL, an empty column - passes through untouched, so this is safe
    to apply to a column whose history predates the endpoint.
    """
    if not stored_url:
        return stored_url
    key = stored_url.rsplit("/", 1)[-1].split("?", 1)[0]
    if not _KEY.match(key) or not stored_url.startswith(URL_PREFIX):
        return stored_url
    expires_at = int(time.time()) + SIGNED_URL_TTL_SECONDS
    return f"{URL_PREFIX}{key}?expires={expires_at}&signature={_signature(key, expires_at)}"


def _is_private(key: str) -> bool:
    """Is this file somebody's payment receipt?

    Sensitivity is not a property of the bytes, so it cannot be read off the key
    - it is a property of what REFERENCES them. A key cited by any registration
    as its payment proof is private, and stays private even if the same file is
    also used as an event image: storage is content-addressed, so one hash can
    have two referrers, and the safe reading of that collision is the stricter
    one.
    """
    with transaction() as cur:
        row = fetch_one(
            cur,
            "SELECT 1 AS found FROM event_registration "
            " WHERE payment_proof_url = %s LIMIT 1",
            (f"{URL_PREFIX}{key}",),
        )
    return row is not None


def _read(key: str) -> tuple[bytes, str] | None:
    """The file's bytes and content type, or None if this deployment has neither.

    The table is authoritative; disk is only consulted for files written before
    the bytes moved into the database, so an upload made against an older build
    keeps serving instead of 404ing the moment it is deployed.
    """
    with transaction() as cur:
        row = fetch_one(
            cur, "SELECT content, content_type FROM upload_file WHERE storage_key = %s", (key,)
        )
    if row is not None:
        return bytes(row["content"]), row["content_type"]
    path = UPLOAD_DIR / key
    if path.exists():
        extension = pathlib.Path(key).suffix
        return path.read_bytes(), _MIME_BY_EXTENSION.get(extension, "application/octet-stream")
    return None


# The inverse of the KINDS maps above, for a legacy on-disk file whose declared
# type was never recorded anywhere but its extension.
_MIME_BY_EXTENSION = {extension: mime for mime, extension in DOCUMENT_TYPES.items()}


@bp.get("/<key>")
@limiter.exempt
def serve(key: str):
    """Serve a stored file.

    The key is matched against a strict pattern before it reaches storage, so no
    caller-supplied path can escape the upload directory on the disk fallback.

    An event image serves to anyone, guests included - the landing page needs it.
    A payment receipt serves only against a valid, unexpired signature minted by
    an endpoint that had already established the caller may see it.
    """
    if not _KEY.match(key):
        raise NotFound("File not found.")
    stored = _read(key)
    if stored is None:
        raise NotFound("File not found.")
    content, content_type = stored

    if _is_private(key):
        expires = request.args.get("expires", "")
        signature = request.args.get("signature", "")
        if not expires.isdigit() or int(expires) < int(time.time()):
            # Same message for expired and unsigned: a caller without a valid
            # link learns only that they need one.
            raise Forbidden("This file needs a valid access link.")
        # compare_digest, not ==: a plain comparison returns faster the earlier
        # it finds a difference, which leaks the signature a byte at a time.
        if not hmac.compare_digest(signature, _signature(key, int(expires))):
            raise Forbidden("This file needs a valid access link.")
        # Private and time-boxed, so it must not be cached by a shared proxy or
        # left in the disk cache after the link dies.
        return Response(content, mimetype=content_type, headers={"Cache-Control": "private, no-store"})

    # Content-addressed, so the bytes behind a key never change and the response
    # can be cached for as long as the browser is willing to keep it.
    return Response(content, mimetype=content_type, headers={"Cache-Control": "public, max-age=31536000, immutable"})

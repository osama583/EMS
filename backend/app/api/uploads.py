"""File uploads: event images and payment receipts.

    POST /uploads          accept a base64 data URL, return a stable URL
    GET  /uploads/{key}    serve a stored file

`kind` picks the accepted type set: images only by default, images plus
PDF for kind='document' (payment receipts).

`request.event_image` is VARCHAR(255), so a data URL cannot be stored in the
column at all — it has to become a reference. That is why this endpoint exists
rather than the client inlining base64 the way the JSON mock allowed.

Files land on local disk under UPLOAD_DIR. For a real deployment this should be
object storage (S3 or Supabase Storage); the URL contract below does not change
when it moves, only the implementation of _store.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import pathlib
import re

from flask import Blueprint, jsonify, send_from_directory

from ..errors import BadRequest, NotFound
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


def _store(data: bytes, extension: str) -> str:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    # Content-addressed: re-uploading the same image reuses one file rather than
    # accumulating duplicates.
    key = hashlib.sha256(data).hexdigest()[:32] + extension
    path = UPLOAD_DIR / key
    if not path.exists():
        path.write_bytes(data)
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

    key = _store(raw, allowed[mime])
    return jsonify({"storageKey": key, "url": f"/api/v1/uploads/{key}"}), 201


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


@bp.get("/<key>")
@limiter.exempt
def serve(key: str):
    """Serve a stored file.

    The key is matched against a strict pattern before touching the filesystem,
    so no caller-supplied path can escape the upload directory.
    """
    if not _KEY.match(key) or not (UPLOAD_DIR / key).exists():
        raise NotFound("File not found.")
    return send_from_directory(UPLOAD_DIR, key, max_age=31536000)

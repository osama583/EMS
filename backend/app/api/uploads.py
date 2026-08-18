"""Image uploads.

    POST /uploads          accept a base64 data URL, return a stable URL
    GET  /uploads/{key}    serve a stored file

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
ALLOWED = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}

_DATA_URL = re.compile(r"^data:(?P<mime>[\w/+.-]+);base64,(?P<payload>.+)$", re.DOTALL)
# A stored key is exactly this shape; anything else never reaches the filesystem.
_KEY = re.compile(r"^[0-9a-f]{32}\.(png|jpg|webp|gif)$")


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
    """Accept a base64 data URL and return {storageKey, url}."""
    payload = body()
    data_url = str(payload.get("dataUrl") or "")
    match = _DATA_URL.match(data_url)
    if not match:
        raise BadRequest("Provide an image as a base64 data URL in 'dataUrl'.")

    mime = match.group("mime").lower()
    if mime not in ALLOWED:
        raise BadRequest("Unsupported image type. Use PNG, JPEG, WebP or GIF.")

    try:
        raw = base64.b64decode(match.group("payload"), validate=True)
    except (binascii.Error, ValueError):
        raise BadRequest("The image data is not valid base64.") from None

    if not raw:
        raise BadRequest("The image is empty.")
    if len(raw) > MAX_BYTES:
        raise BadRequest(f"Images must be {MAX_BYTES // (1024 * 1024)} MB or smaller.")

    # Trust the magic bytes, not the declared MIME type: a caller can label
    # anything image/png.
    if not _looks_like_image(raw):
        raise BadRequest("That file does not look like an image.")

    key = _store(raw, ALLOWED[mime])
    return jsonify({"storageKey": key, "url": f"/api/v1/uploads/{key}"}), 201


def _looks_like_image(raw: bytes) -> bool:
    return (
        raw.startswith(b"\x89PNG\r\n\x1a\n")
        or raw.startswith(b"\xff\xd8\xff")           # JPEG
        or raw.startswith(b"GIF87a")
        or raw.startswith(b"GIF89a")
        or (raw[:4] == b"RIFF" and raw[8:12] == b"WEBP")
    )


@bp.get("/<key>")
@limiter.exempt
def serve(key: str):
    """Serve a stored image.

    The key is matched against a strict pattern before touching the filesystem,
    so no caller-supplied path can escape the upload directory.
    """
    if not _KEY.match(key):
        raise NotFound("Image not found.")
    if not (UPLOAD_DIR / key).exists():
        raise NotFound("Image not found.")
    return send_from_directory(UPLOAD_DIR, key, max_age=31536000)

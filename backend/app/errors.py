"""Centralised error handling.

Every failure leaves the API as the same JSON envelope:

    {"error": {"code": "not_found", "message": "...", "details": {...}}}

`message` is safe to show a user. Unexpected exceptions are logged with a
stack trace and traded for a generic 500 body, so internal detail (SQL, file
paths, driver messages) never reaches the client.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from flask import Flask, current_app, g, jsonify
from werkzeug.exceptions import HTTPException

log = logging.getLogger(__name__)


class ApiError(Exception):
    """Base for every deliberate, client-visible failure."""

    status_code = 500
    code = "internal_error"

    def __init__(self, message: str, *, details: dict[str, Any] | None = None, code: str | None = None):
        super().__init__(message)
        self.message = message
        self.details = details or {}
        if code:
            self.code = code


class BadRequest(ApiError):
    status_code, code = 400, "bad_request"


class ValidationError(ApiError):
    status_code, code = 422, "validation_error"


class Unauthorized(ApiError):
    status_code, code = 401, "unauthorized"


class Forbidden(ApiError):
    status_code, code = 403, "forbidden"


class NotFound(ApiError):
    status_code, code = 404, "not_found"


class Conflict(ApiError):
    status_code, code = 409, "conflict"


class WorkflowError(ApiError):
    """A business-rule violation in the proposal state machine.

    Defaults to 409: the request was well-formed, but the proposal is not in a
    state where the action is legal (approving a draft, resubmitting something
    nobody sent back).
    """

    status_code, code = 409, "workflow_error"


def _payload(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"error": {"code": code, "message": message}}
    if details:
        body["error"]["details"] = details
    request_id = getattr(g, "request_id", None)
    if request_id:
        body["error"]["request_id"] = request_id
    return body


def register_error_handlers(app: Flask) -> None:
    @app.errorhandler(ApiError)
    def _api_error(exc: ApiError):
        log.warning(
            "api.error",
            extra={"error_code": exc.code, "status": exc.status_code, "detail": exc.message},
        )
        return jsonify(_payload(exc.code, exc.message, exc.details)), exc.status_code

    @app.errorhandler(HTTPException)
    def _http_error(exc: HTTPException):
        code = {
            400: "bad_request",
            401: "unauthorized",
            403: "forbidden",
            404: "not_found",
            405: "method_not_allowed",
            409: "conflict",
            413: "payload_too_large",
            415: "unsupported_media_type",
            422: "validation_error",
            429: "rate_limited",
        }.get(exc.code or 500, "http_error")
        return jsonify(_payload(code, exc.description or "Request failed.")), exc.code or 500

    @app.errorhandler(Exception)
    def _unexpected(exc: Exception):
        # The reference is the only thing tying the opaque client message to the
        # logged stack trace.
        reference = getattr(g, "request_id", None) or uuid.uuid4().hex
        log.exception("api.unhandled_exception", extra={"request_id": reference})
        message = "An unexpected error occurred."
        if current_app.config.get("EXPOSE_ERRORS"):
            message = f"{type(exc).__name__}: {exc}"
        return jsonify(_payload("internal_error", message, {"reference": reference})), 500

"""Flask application factory for the APU EMS API."""
from __future__ import annotations

import datetime
import logging
import time
import uuid

from flask import Flask, g, jsonify, request
from flask.json.provider import DefaultJSONProvider
from flask_cors import CORS

from .config import config
from .db import close_pool, health_check, init_pool
from .errors import register_error_handlers
from .extensions import limiter
from .logging_setup import configure_logging

log = logging.getLogger(__name__)

API_PREFIX = "/api/v1"


class _JSONProvider(DefaultJSONProvider):
    """Flask's DefaultJSONProvider does serialize datetime.date/datetime.datetime
    without crashing, but as an RFC 1123 string ("Fri, 21 Aug 2026 00:00:00
    GMT") rather than ISO 8601 - surprising for a JSON API and silently wrong
    for any client doing a string comparison against an ISO date (e.g.
    serve_date === "2026-08-21"). It also doesn't handle a bare datetime.time
    at all - psycopg2 returns TIME columns (start_time, serve_time,
    moving_time, ...) as datetime.time, and any endpoint that jsonifies a raw
    fetch_all()/fetch_one() row containing one of those columns 500s. Route
    handlers that already format dates/times into strings themselves are
    unaffected; this is a safety net for the ones that return raw rows (e.g.
    GET /cafeteria-orders)."""

    @staticmethod
    def default(o):
        if isinstance(o, (datetime.date, datetime.time)):
            return o.isoformat()
        return DefaultJSONProvider.default(o)


def create_app(*, validate_config: bool = True) -> Flask:
    configure_logging(config.log_level, config.log_format)

    app = Flask(__name__)
    app.json = _JSONProvider(app)
    app.config["EXPOSE_ERRORS"] = config.is_development
    # Reject oversized bodies before they are parsed. Event images arrive as
    # base64 data URLs, hence the headroom.
    app.config["MAX_CONTENT_LENGTH"] = 12 * 1024 * 1024
    app.config["JSON_SORT_KEYS"] = False

    if validate_config:
        config.validate()
        init_pool()

    # Exact origins only, never "*": the frontend sends an Authorization header,
    # and a wildcard origin with credentials is both invalid and unsafe.
    CORS(
        app,
        resources={rf"{API_PREFIX}/*": {"origins": config.cors_origins}},
        supports_credentials=True,
        allow_headers=["Authorization", "Content-Type", "X-Request-Id"],
        expose_headers=["X-Request-Id", "X-RateLimit-Remaining"],
        max_age=600,
    )

    limiter.init_app(app)
    register_error_handlers(app)
    _register_request_hooks(app)
    _register_blueprints(app)

    @app.get("/health")
    @limiter.exempt
    def health():
        ok = health_check() if validate_config else False
        return jsonify({"status": "ok" if ok else "degraded", "database": ok}), (200 if ok else 503)

    app.teardown_appcontext(lambda _exc: None)
    log.info("app.created", extra={"env": config.env, "origins": ",".join(config.cors_origins)})
    return app


def _register_request_hooks(app: Flask) -> None:
    @app.before_request
    def _start():
        # Honour an inbound correlation id so a browser-reported error can be
        # matched to server logs; otherwise mint one.
        g.request_id = request.headers.get("X-Request-Id") or uuid.uuid4().hex
        g.started_at = time.perf_counter()

    @app.after_request
    def _finish(response):
        duration_ms = round((time.perf_counter() - getattr(g, "started_at", time.perf_counter())) * 1000, 2)
        response.headers["X-Request-Id"] = getattr(g, "request_id", "-")
        # Defence in depth: the API serves JSON, but these cost nothing and
        # blunt content-sniffing and framing attacks on anything that isn't.
        response.headers.setdefault("X-Content-Type-Options", "nosniff")
        response.headers.setdefault("X-Frame-Options", "DENY")
        response.headers.setdefault("Referrer-Policy", "no-referrer")
        response.headers.setdefault("Cache-Control", "no-store")
        if request.path != "/health":
            log.info(
                "http.request",
                extra={"status": response.status_code, "duration_ms": duration_ms},
            )
        return response


def _register_blueprints(app: Flask) -> None:
    from .api import BLUEPRINTS

    for blueprint in BLUEPRINTS:
        app.register_blueprint(blueprint, url_prefix=f"{API_PREFIX}{blueprint.url_prefix or ''}")

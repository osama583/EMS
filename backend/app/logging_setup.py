"""Structured logging.

Every record carries the request id, so a client holding an error `request_id`
can be traced through the log. LOG_FORMAT=json emits one JSON object per line
for aggregation; `console` stays readable during development.

Audit trail: audit() records who did what to which resource. Workflow
transitions call it in addition to writing a workflow_history row, so an
operator can reconstruct actions from the log alone.
"""
from __future__ import annotations

import json
import logging
import sys
from typing import Any

from flask import g, has_request_context, request

_RESERVED = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime"}

# Never let these reach a log line, whatever the caller passes.
_REDACT = {"password", "password_hash", "token", "access_token", "refresh_token", "authorization", "secret"}


class ContextFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = getattr(g, "request_id", "-") if has_request_context() else "-"
        record.user_id = getattr(g, "user_id", None) if has_request_context() else None
        if has_request_context():
            record.method = request.method
            record.path = request.path
        return True


def _extras(record: logging.LogRecord) -> dict[str, Any]:
    out = {}
    for key, value in record.__dict__.items():
        if key in _RESERVED or key.startswith("_"):
            continue
        out[key] = "***" if key.lower() in _REDACT else value
    return out


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
            "level": record.levelname,
            "logger": record.name,
            "event": record.getMessage(),
        }
        payload.update(_extras(record))
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = f"{self.formatTime(record, '%H:%M:%S')} {record.levelname:<7} {record.name}: {record.getMessage()}"
        extras = {k: v for k, v in _extras(record).items() if k not in {"request_id", "method", "path", "user_id"}}
        rid = getattr(record, "request_id", "-")
        if rid and rid != "-":
            base += f" [req {rid[:8]}]"
        if extras:
            base += " " + " ".join(f"{k}={v}" for k, v in extras.items())
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return base


def configure_logging(level: str, fmt: str) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if fmt == "json" else ConsoleFormatter())
    handler.addFilter(ContextFilter())

    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(level)

    # Flask/werkzeug log their own per-request line; ours in app/__init__.py is
    # richer, so keep werkzeug quiet unless something goes wrong.
    logging.getLogger("werkzeug").setLevel(logging.WARNING)


def audit(action: str, **fields: Any) -> None:
    """Record an auditable action: who did what, to which resource, and the outcome."""
    logging.getLogger("audit").info(action, extra={"audit": True, **fields})

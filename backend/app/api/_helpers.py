"""Shared request-handling helpers for the API blueprints."""
from __future__ import annotations

from typing import Any

from flask import request

from ..errors import BadRequest

MAX_PAGE_SIZE = 200
DEFAULT_PAGE_SIZE = 50


def body() -> dict[str, Any]:
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise BadRequest("A JSON request body is required.")
    return payload


def required(payload: dict, *keys: str) -> tuple:
    """Pull required keys, rejecting missing or blank values in one message."""
    missing = [k for k in keys if payload.get(k) in (None, "", [])]
    if missing:
        raise BadRequest("Missing required field(s): " + ", ".join(missing) + ".")
    return tuple(payload[k] for k in keys)


def pagination() -> tuple[int, int]:
    """(limit, offset) from ?page and ?pageSize, clamped to sane bounds.

    Capped so a client cannot ask for the whole table in one response.
    """
    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    try:
        size = int(request.args.get("pageSize", DEFAULT_PAGE_SIZE))
    except ValueError:
        size = DEFAULT_PAGE_SIZE
    size = max(1, min(size, MAX_PAGE_SIZE))
    return size, (page - 1) * size


def paged(items: list, total: int) -> dict[str, Any]:
    limit, offset = pagination()
    return {
        "items": items,
        "page": offset // limit + 1,
        "pageSize": limit,
        "total": total,
        "totalPages": max(1, -(-total // limit)),
    }


def flag(name: str) -> bool:
    return str(request.args.get(name, "")).lower() in ("1", "true", "yes")

def date_order(column: str, default_order: str = "desc") -> str:
    """ORDER BY fragment for a sortable DATE column.

    Date columns are the only sortable ones anywhere in this app - the tables
    offer no other - so an endpoint needs a DIRECTION, not a column vocabulary.
    The column is fixed by the caller and never read from the query string; only
    ?order= is, and it is narrowed to one of two literals before it can reach
    the SQL, so nothing a client sends is interpolated into the clause.

    Callers append their own primary-key tiebreak, so a paginated page boundary
    cannot drop or repeat a row when two rows share a timestamp.
    """
    order = "ASC" if (request.args.get("order") or default_order).lower() == "asc" else "DESC"
    return f"{column} {order}"

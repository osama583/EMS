"""Administration of the AI assistant: the access log, and the schema cache.

    GET     /admin/ai-access-log            paged, filterable audit trail
    DELETE  /admin/ai-access-log            clear it (an explicit decision, never automatic)
    GET     /admin/ai-schema                the cached data dictionary's state
    POST    /admin/ai-schema/refresh        force a rebuild

Kept out of api/admin.py deliberately: that module is identity administration (users, roles,
units, page visibility) and is already long. These routes mount on the SAME /admin prefix and
carry the same system-admin requirement, so they are indistinguishable to a caller.

WHY THE ACCESS LOG IS NOT AUTO-PRUNED: it is an access-audit trail, and rows silently ageing out
would defeat the reason for keeping one. Clearing it is a deliberate admin action.

THE SCHEMA REFRESH is requirement 3 of the four ways schema_catalog's cache is invalidated (see
that module's docstring): a migration changes the fingerprint automatically, a schema-shaped SQL
error invalidates it automatically, a restart drops it - and this route exists for the case where
an administrator knows the structure changed and wants it picked up now rather than on the next
failure. It reports the fingerprint before and after, so "nothing changed" is visible rather than
being indistinguishable from a no-op.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..ai import schema_catalog, topic_access
from ..db import query, query_one, transaction
from ..logging_setup import audit
from ..security import require_admin
from ._helpers import date_order

bp = Blueprint("ai_admin", __name__, url_prefix="/admin")

DEFAULT_PAGE_SIZE = 25
# The rows-per-page choices the client offers (PAGE_SIZE_OPTIONS in internal-data-page.models.ts).
ALLOWED_PAGE_SIZES = (5, 10, 15, 25)

# The outcomes a row can carry - the three refusal reasons plus system_failure, which is not a
# refusal at all. Defined once in ai/topic_access.py, where the writes are.
VALID_OUTCOMES = topic_access.ALL_OUTCOMES


@bp.get("/ai-access-log")
@require_admin
def list_ai_access_log():
    """Newest-first, paged. `search` matches the asker's email or the question text; `outcome`
    filters to one category."""
    try:
        page = max(1, int(request.args.get("page", 1)))
    except ValueError:
        page = 1
    try:
        requested_size = int(request.args.get("pageSize", DEFAULT_PAGE_SIZE))
    except ValueError:
        requested_size = DEFAULT_PAGE_SIZE
    page_size = requested_size if requested_size in ALLOWED_PAGE_SIZES else DEFAULT_PAGE_SIZE
    search = (request.args.get("search") or "").strip()
    outcome = (request.args.get("outcome") or "").strip()

    clauses: list[str] = []
    params: dict[str, object] = {}
    if search:
        clauses.append("(user_email ILIKE %(search)s OR question ILIKE %(search)s)")
        params["search"] = f"%{search}%"
    if outcome in VALID_OUTCOMES:
        clauses.append("outcome = %(outcome)s")
        params["outcome"] = outcome
    where = (" WHERE " + " AND ".join(clauses)) if clauses else ""

    total = (query_one(f"SELECT COUNT(*) AS n FROM ai_access_denial{where}", params) or {}).get("n", 0)
    rows = query(
        f"""
        SELECT denial_id AS "denialId", user_id AS "userId", user_email AS "userEmail",
               user_roles AS "userRoles", topic, topic_label AS "topicLabel",
               required_pages AS "requiredPages", question, ai_response AS "aiResponse",
               outcome, reason, conversation_context AS "conversationContext",
               created_at::text AS "createdAt"
          FROM ai_access_denial{where}
      ORDER BY {date_order("created_at")}, denial_id DESC
         LIMIT %(limit)s OFFSET %(offset)s
        """,
        {**params, "limit": page_size, "offset": (page - 1) * page_size},
    )
    return jsonify({"rows": rows, "total": total, "page": page, "pageSize": page_size})


@bp.delete("/ai-access-log")
@require_admin
def clear_ai_access_log():
    """Empties the log. Audited, because deleting an audit trail is itself worth auditing."""
    with transaction() as cur:
        cur.execute("DELETE FROM ai_access_denial")
        removed = cur.rowcount
    audit("ai_access_log.cleared", removed=removed)
    return jsonify({"removed": removed})


@bp.get("/ai-schema")
@require_admin
def ai_schema_state():
    """What the assistant currently believes the database looks like - the fingerprint and the
    tables in scope. Enough for an administrator to tell whether a refresh is needed without
    forcing one."""
    return jsonify(
        {
            "fingerprint": schema_catalog.schema_fingerprint(),
            "tables": sorted(schema_catalog.ALLOWED_TABLES),
        }
    )


@bp.post("/ai-schema/refresh")
@require_admin
def refresh_ai_schema():
    """Drops the cached data dictionary and rebuilds it from the live database.

    Returns both fingerprints so an unchanged one is visible as such - a refresh that legitimately
    finds nothing new looks identical to a broken one otherwise."""
    before = schema_catalog.schema_fingerprint()
    after = schema_catalog.refresh()
    audit("ai_schema.refreshed", before=before, after=after, changed=before != after)
    return jsonify({"previousFingerprint": before, "fingerprint": after, "changed": before != after})

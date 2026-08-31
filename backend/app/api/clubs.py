"""Clubs: directory, membership, join requests, and club administration.

    GET/POST/PATCH/DELETE  /clubs[/{id}]
    GET                    /clubs/{id}/members
    DELETE                 /clubs/{id}/members/{user_id}
    POST                   /clubs/{id}/join-requests          ask to join
    GET                    /clubs/join-requests               mine, or my inbox
    POST                   /clubs/join-requests/{id}/decision approve | reject
    GET/POST/PATCH/DELETE  /clubs/categories[/{id}]
    GET                    /clubs/me/previous                 clubs I used to be in
    GET                    /clubs/{id}/logs                   member | event | request log
    POST                   /clubs/{id}/president-change-requests       President submits
    GET                    /clubs/president-change-requests/inbox      Club Admin: pending
    GET                    /clubs/president-change-requests/mine       President: own history
    GET                    /clubs/president-change-requests/history    Club Admin: all decided
    POST                   /clubs/president-change-requests/{id}/approve | /reject

Two distinct authorities, easy to confuse:
  Club Admin  - a flat role. Creates and deactivates any club, manages categories.
  President   - NOT a role. A data fact: clubs.user_id. One per club, and only
                they decide their own club's join requests. To stop being
                President, they submit a president-change-request instead of
                leaving directly (see remove_member() below) - a Club Admin
                approves/rejects it, same as a join request.

The directory itself is open to any authenticated user. The listing carries
server-computed viewer flags (am I a member, do I have a request pending) rather
than shipping the whole membership table for the browser to cross-reference.
"""
from __future__ import annotations

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound
from ..logging_setup import audit
from ..security import require_auth, require_internal
from ..security.principal import current_principal
from ..services import soft_delete
from ..services.email import dispatch
from ._helpers import body, date_order, flag, paged, pagination, required

bp = Blueprint("clubs", __name__, url_prefix="/clubs")

MIN_CATEGORIES, MAX_CATEGORIES = 1, 3


def _is_president(cur, club_id: int, user_id: int) -> bool:
    return (
        fetch_one(cur, "SELECT 1 FROM clubs WHERE club_id = %s AND user_id = %s", (club_id, user_id))
        is not None
    )


def _log_membership(
    cur,
    club_id: int,
    subject_user_id: int,
    action: str,
    actor_user_id: int | None = None,
    role_label: str = "Member",
) -> None:
    """Append a membership transition to club_membership_log (migration 040).

    club_members is a snapshot and leaving DELETEs the row, so this append-only
    log is the ONLY record that someone was ever a member. Previous Clubs and
    the President's member log both read it, which is why every write path that
    touches club_members calls this in the same transaction - a membership that
    changed without an entry is a membership that, as far as either page is
    concerned, never happened.
    """
    cur.execute(
        """INSERT INTO club_membership_log
               (club_id, subject_user_id, actor_user_id, action, role_label)
           VALUES (%s, %s, %s, %s, %s)""",
        (club_id, subject_user_id, actor_user_id, action, role_label),
    )


def _assert_club_admin() -> None:
    principal = current_principal()
    if not principal.is_admin and not principal.has_role("club-admin"):
        raise Forbidden("Only a Club Admin can do that.")


# --- Directory ------------------------------------------------------------
# The client's ClubRecord: president and createdBy are nested user summaries,
# not flattened columns, and categories are full records rather than names.
_CLUB_SELECT = """
    SELECT c.club_id AS id, c.club_name AS name, COALESCE(c.description, '') AS description,
           c.image_url AS "imageUrl", c.active, c.created_at AS "createdAt",
           p.user_id AS president_id, p.full_name AS president_name, p.email AS president_email,
           b.user_id AS creator_id, b.full_name AS creator_name, b.email AS creator_email,
           (SELECT count(*) FROM club_members m WHERE m.club_id = c.club_id) AS "memberCount",
           (SELECT count(*) FROM club_join_requests j
             WHERE j.club_id = c.club_id AND j.status = 'pending') AS "pendingRequestCount",
           EXISTS (SELECT 1 FROM club_members m
                    WHERE m.club_id = c.club_id AND m.user_id = %(viewer)s) AS "viewerIsMember",
           -- When the VIEWER joined, for the "Member Since" column on My Clubs.
           -- NULL for a club they do not belong to - a correlated scalar rather
           -- than a join, so the row count is unaffected and a non-member simply
           -- reads NULL.
           (SELECT m.date_joined FROM club_members m
             WHERE m.club_id = c.club_id AND m.user_id = %(viewer)s) AS "viewerMemberSince",
           EXISTS (SELECT 1 FROM club_join_requests j
                    WHERE j.club_id = c.club_id AND j.requester_user_id = %(viewer)s
                      AND j.status = 'pending') AS "viewerHasPendingRequest",
           (c.user_id = %(viewer)s) AS "viewerIsPresident",
           -- A club may hold only ONE pending president-change request
           -- (uq_pcr_pending_per_club), so submitting a second is a guaranteed
           -- 409. My Clubs offered the button anyway, with no way to know the
           -- request it already sent was still sitting there - the President
           -- got a conflict error for doing exactly what the UI invited. This
           -- is what lets that button report the pending request instead.
           EXISTS (SELECT 1 FROM club_president_change_requests pcr
                    WHERE pcr.club_id = c.club_id AND pcr.status = 'pending')
               AS "hasPendingPresidentChange"
      FROM clubs c
 LEFT JOIN users p ON p.user_id = c.user_id
 LEFT JOIN users b ON b.user_id = c.created_by_user_id
"""

_CATEGORIES_FOR_CLUBS = """
    SELECT l.club_id, cc.club_category_id AS id, cc.name, cc.active,
           cc.created_at AS "createdAt"
      FROM club_category_links l
      JOIN club_categories cc ON cc.club_category_id = l.club_category_id
     WHERE l.club_id = ANY(%s)
  ORDER BY cc.name
"""


def _user_summary(user_id, name, email, role: str) -> dict | None:
    if user_id is None:
        return None
    return {"id": str(user_id), "displayName": name, "email": email, "role": role}


def _shape_clubs(rows: list[dict]) -> list[dict]:
    """Fold the flat columns into the nested record, and attach categories for
    every club in one query rather than one per club."""
    if not rows:
        return rows
    grouped: dict[int, list[dict]] = {}
    for entry in query(_CATEGORIES_FOR_CLUBS, ([r["id"] for r in rows],)):
        entry["id"] = str(entry["id"])
        grouped.setdefault(entry.pop("club_id"), []).append(entry)

    for row in rows:
        row["categories"] = grouped.get(row["id"], [])
        row["president"] = _user_summary(
            row.pop("president_id"), row.pop("president_name"), row.pop("president_email"),
            "President",
        )
        row["createdBy"] = _user_summary(
            row.pop("creator_id"), row.pop("creator_name"), row.pop("creator_email"),
            "Club Admin",
        )
        row["id"] = str(row["id"])
    return rows


def _club_response(club_id: int, viewer_id: int) -> dict:
    rows = query(_CLUB_SELECT + " WHERE c.club_id = %(club)s AND c.archived_at IS NULL",
                 {"viewer": viewer_id, "club": club_id})
    if not rows:
        raise NotFound("Club not found.")
    return _shape_clubs(rows)[0]


@bp.get("")
@require_auth
def list_clubs():
    """Every club, each annotated for the CALLER.

    The viewer flags are computed here rather than by shipping club_members and
    club_join_requests to the browser to join locally.
    """
    principal = current_principal()
    sql = _CLUB_SELECT + " WHERE c.archived_at IS NULL"
    if flag("activeOnly") or flag("active"):
        sql += " AND c.active"
    rows = query(sql + " ORDER BY c.club_name", {"viewer": principal.user_id})
    return jsonify(_shape_clubs(rows))


_CLUB_SORT_COLUMNS = {
    "name": "c.club_name",
    "president": "p.full_name",
    "members": '"memberCount"',
    "createdAt": "c.created_at",
}


@bp.get("/search")
@require_internal
def search_clubs():
    """Server-side searched/filtered/sorted/paginated club list for the /app/clubs/manage
    management page - search, status, category, sort, LIMIT/OFFSET and the total count all
    happen in SQL rather than shipping the whole table to the browser. Mirrors
    search_categories() below; list_clubs() above stays unpaginated for the club directory
    and My Clubs, which both render every (active) club at once."""
    _assert_club_admin()
    principal = current_principal()

    where = ["c.archived_at IS NULL"]
    params: dict = {"viewer": principal.user_id}

    status = (request.args.get("status") or "all").strip()
    if status == "active":
        where.append("c.active")
    elif status == "inactive":
        where.append("NOT c.active")

    search = (request.args.get("q") or "").strip()
    if search:
        where.append(
            "(c.club_name ILIKE %(q)s OR c.description ILIKE %(q)s OR p.full_name ILIKE %(q)s)"
        )
        params["q"] = f"%{search}%"

    category_id = (request.args.get("categoryId") or "").strip()
    if category_id:
        where.append(
            "EXISTS (SELECT 1 FROM club_category_links l "
            "WHERE l.club_id = c.club_id AND l.club_category_id = %(category)s)"
        )
        try:
            params["category"] = int(category_id)
        except ValueError:
            raise BadRequest("categoryId must be numeric.")

    where_sql = " AND ".join(where)

    sort_key = request.args.get("sort", "name")
    sort_column = _CLUB_SORT_COLUMNS.get(sort_key, "c.club_name")
    order = "ASC" if request.args.get("order", "asc") == "asc" else "DESC"

    with transaction() as cur:
        total = fetch_one(
            cur,
            f"SELECT count(*) AS c FROM clubs c "
            f"LEFT JOIN users p ON p.user_id = c.user_id WHERE {where_sql}",
            params,
        )["c"]
        limit, offset = pagination()
        params["limit"] = limit
        params["offset"] = offset
        rows = fetch_all(
            cur,
            f"{_CLUB_SELECT} WHERE {where_sql} "
            f"ORDER BY {sort_column} {order}, c.club_id {order} LIMIT %(limit)s OFFSET %(offset)s",
            params,
        )
    return jsonify(paged(_shape_clubs(rows), total))


# --- Categories -----------------------------------------------------------
# Their own top-level resource: a category exists independently of any club,
# and the client manages them from their own screen.
categories_bp = Blueprint("club_categories", __name__, url_prefix="/club-categories")

RETENTION_DAYS = soft_delete.RETENTION_DAYS

_CATEGORY_SELECT = """
    SELECT club_category_id AS id, name, active, created_at AS "createdAt", archived_at
      FROM club_categories
"""


def _category_response(category_id: int) -> dict:
    rows = query(_CATEGORY_SELECT + " WHERE club_category_id = %s", (category_id,))
    if not rows:
        raise NotFound("Category not found.")
    row = rows[0]
    row.pop("archived_at", None)
    row["id"] = str(row["id"])
    return row


@categories_bp.get("")
@require_auth
def list_categories():
    """?namesOnly=true projects just id/name - for a "filter by category"
    dropdown (Manage Clubs), which never needs `active`/`createdAt` and so
    should never pay for them over the wire."""
    if flag("namesOnly"):
        return jsonify(
            [
                {"id": str(row["id"]), "name": row["name"]}
                for row in query(
                    "SELECT club_category_id AS id, name FROM club_categories "
                    "WHERE archived_at IS NULL ORDER BY name"
                )
            ]
        )
    sql = _CATEGORY_SELECT + " WHERE archived_at IS NULL"
    if flag("activeOnly") or flag("active"):
        sql += " AND active"
    rows = query(sql + " ORDER BY name")
    for row in rows:
        row.pop("archived_at", None)
        row["id"] = str(row["id"])
    return jsonify(rows)


@categories_bp.get("/search")
@require_internal
def search_categories():
    """Server-side filtered/paginated categories for the /app/club-category management
    page - search, status, LIMIT/OFFSET and the total count all happen in SQL rather than
    shipping the whole table to the browser.

    ?status=active|inactive|all, defaulting to active. `all` exists because the two
    single-status views could not answer "what categories are there", which is the
    question someone opens this page with; before it, seeing the full set meant
    reading one filter and then the other and holding both in your head.

    ?includeInactive=true is the older spelling of ?status=all and still works -
    it was the only way to reach an inactive category, so the client narrowed the
    broader result down again in the browser, which made `total` (and therefore the
    pager) describe a different set from the rows on screen. Stating the status
    server-side is what fixes that; the alias is kept so an in-flight client is not
    broken by the rename."""
    _assert_club_admin()
    where = ["archived_at IS NULL"]
    params: list = []
    search = (request.args.get("q") or "").strip()
    if search:
        where.append("name ILIKE %s")
        params.append(f"%{search}%")

    status = (request.args.get("status") or "").strip().lower()
    if not status:
        status = "all" if flag("includeInactive") else "active"
    if status not in ("active", "inactive", "all"):
        raise BadRequest("status must be one of: active, inactive, all.")
    if status == "active":
        where.append("active")
    elif status == "inactive":
        where.append("NOT active")
    where_sql = " AND ".join(where)
    with transaction() as cur:
        total = fetch_one(
            cur, f"SELECT count(*) AS c FROM club_categories WHERE {where_sql}", params
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"{_CATEGORY_SELECT} WHERE {where_sql} "
            f"ORDER BY {date_order('created_at', 'asc')}, club_category_id ASC LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
    for row in rows:
        row.pop("archived_at", None)
        row["id"] = str(row["id"])
    return jsonify(paged(rows, total))


@categories_bp.get("/deleted")
@require_internal
def list_deleted_categories():
    _assert_club_admin()
    rows = query(
        _CATEGORY_SELECT.replace(
            "archived_at\n",
            'archived_at AS "deletedAt",'
            "(archived_at + make_interval(days => %s)) AS \"permanentDeletionAt\","
            "GREATEST(0, %s - EXTRACT(DAY FROM now() - archived_at)::int) AS \"daysRemaining\"\n",
        )
        + " WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
        (RETENTION_DAYS, RETENTION_DAYS),
    )
    for row in rows:
        row["id"] = str(row["id"])
    return jsonify(rows)


@categories_bp.post("")
@require_internal
def create_category():
    _assert_club_admin()
    payload = body()
    (name,) = required(payload, "name")
    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM club_categories WHERE lower(name) = lower(%s)", (name,)):
            raise Conflict("A category with that name already exists.")
        cur.execute(
            "INSERT INTO club_categories (name, active) VALUES (%s, %s) RETURNING club_category_id",
            (str(name).strip(), bool(payload.get("active", True))),
        )
        category_id = cur.fetchone()["club_category_id"]
        audit("clubs.category.created", category_id=category_id,
              actor_user_id=current_principal().user_id)
    return jsonify(_category_response(category_id)), 201


def _apply_category_update(category_id: int, payload: dict) -> dict:
    fields: dict[str, object] = {}
    if "name" in payload:
        fields["name"] = str(payload["name"]).strip()
    if "active" in payload:
        fields["active"] = bool(payload["active"])
    if not fields:
        raise BadRequest("No updatable fields were supplied.")

    with transaction() as cur:
        if fetch_one(
            cur, "SELECT 1 FROM club_categories WHERE club_category_id = %s", (category_id,)
        ) is None:
            raise NotFound("Category not found.")
        if "name" in fields:
            clash = fetch_one(
                cur,
                "SELECT 1 FROM club_categories WHERE lower(name) = lower(%s) "
                "AND club_category_id <> %s",
                (fields["name"], category_id),
            )
            if clash:
                raise Conflict("A category with that name already exists.")
        assignments = ", ".join(f"{c} = %s" for c in fields)
        cur.execute(
            f"UPDATE club_categories SET {assignments} WHERE club_category_id = %s",
            [*fields.values(), category_id],
        )
        audit("clubs.category.updated", category_id=category_id,
              actor_user_id=current_principal().user_id)
    return _category_response(category_id)


@categories_bp.put("/<int:category_id>")
@require_internal
def update_category(category_id: int):
    _assert_club_admin()
    return jsonify(_apply_category_update(category_id, body()))


@categories_bp.patch("/<int:category_id>/status")
@require_internal
def set_category_status(category_id: int):
    _assert_club_admin()
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")
    return jsonify(_apply_category_update(category_id, {"active": payload["active"]}))


def _category_blockers(cur, category_id: int) -> list[str]:
    in_use = fetch_one(
        cur,
        "SELECT count(*) AS c FROM club_category_links l JOIN clubs c ON c.club_id = l.club_id "
        "WHERE l.club_category_id = %s",
        (category_id,),
    )["c"]
    return [f"{in_use} club(s) still use this category"] if in_use else []


@categories_bp.get("/<int:category_id>/deletion-check")
@require_internal
def category_deletion_check(category_id: int):
    _assert_club_admin()
    with transaction() as cur:
        row = fetch_one(
            cur, "SELECT name FROM club_categories WHERE club_category_id = %s", (category_id,)
        )
        if row is None:
            raise NotFound("Category not found.")
        blockers = _category_blockers(cur, category_id)
    return jsonify(
        {"canDelete": not blockers, "blockingReasons": blockers, "entityLabel": row["name"]}
    )


@categories_bp.delete("/<int:category_id>")
@require_internal
def delete_category(category_id: int):
    """Soft delete. Refused while a club still carries the category - a club
    must keep at least one, so removing it underneath them would leave the
    club in a state its own rules forbid."""
    _assert_club_admin()
    with transaction() as cur:
        if fetch_one(
            cur, "SELECT 1 FROM club_categories WHERE club_category_id = %s", (category_id,)
        ) is None:
            raise NotFound("Category not found.")
        blockers = _category_blockers(cur, category_id)
        if blockers:
            raise Conflict(blockers[0] + ". Repoint those clubs first.")
        cur.execute(
            "UPDATE club_categories SET archived_at = now(), active = FALSE "
            "WHERE club_category_id = %s",
            (category_id,),
        )
        audit("clubs.category.deleted", category_id=category_id,
              actor_user_id=current_principal().user_id)
    return jsonify(_category_response(category_id))


@categories_bp.post("/<int:category_id>/restore")
@require_internal
def restore_category(category_id: int):
    _assert_club_admin()
    with transaction() as cur:
        cur.execute(
            "UPDATE club_categories SET archived_at = NULL, active = TRUE "
            "WHERE club_category_id = %s RETURNING club_category_id",
            (category_id,),
        )
        if cur.fetchone() is None:
            raise NotFound("Category not found.")
        audit("clubs.category.restored", category_id=category_id,
              actor_user_id=current_principal().user_id)
    return jsonify(_category_response(category_id))


@bp.get("/my-status/<int:user_id>")
@require_auth
def my_status(user_id: int):
    """Whether this user is a Club Admin, and which clubs they preside over.

    The client uses it to decide which management surfaces to show. A caller may
    only ask about themselves - otherwise it reports someone else's authority.
    """
    principal = current_principal()
    if user_id != principal.user_id and not principal.is_admin:
        raise Forbidden("You can only read your own club status.")
    rows = query(
        "SELECT club_id FROM clubs WHERE user_id = %s AND archived_at IS NULL "
        "ORDER BY club_id",
        (user_id,),
    )
    is_club_admin = principal.is_admin or principal.has_role("club-admin")
    return jsonify(
        {
            "isClubAdmin": bool(is_club_admin),
            "presidentOfClubIds": [str(r["club_id"]) for r in rows],
        }
    )


@bp.get("/mine/presiding")
@require_auth
def my_presiding_clubs():
    """The clubs the caller is President of, as {id, name} - the option list for the
    proposal form's "Club Only" audience picker.

    my_status() above returns bare ids, which is enough for a permission check but not
    for a dropdown; rather than have the client fetch every club just to resolve two
    names, this returns the pair directly. Always scoped to the caller (no user_id
    argument), so it cannot be used to enumerate someone else's presidencies.
    """
    principal = current_principal()
    rows = query(
        "SELECT club_id, club_name FROM clubs WHERE user_id = %s AND active ORDER BY club_name",
        (principal.user_id,),
    )
    return jsonify([{"id": str(r["club_id"]), "name": r["club_name"]} for r in rows])


@bp.get("/<int:club_id>")
@require_auth
def get_club(club_id: int):
    return jsonify(_club_response(club_id, current_principal().user_id))


@bp.post("")
@require_internal
def create_club():
    _assert_club_admin()
    principal = current_principal()
    payload = body()
    name, president_id = required(payload, "name", "presidentUserId")
    # `categoryIds` is what the client sends; `categories` is the older name.
    categories = payload.get("categoryIds", payload.get("categories")) or []

    with transaction() as cur:
        president = fetch_one(
            cur,
            "SELECT user_id FROM users WHERE user_id = %s AND is_active AND archived_at IS NULL",
            (president_id,),
        )
        if president is None:
            raise NotFound("The nominated President does not exist.")
        if fetch_one(cur, "SELECT 1 FROM clubs WHERE lower(club_name) = lower(%s)", (name,)):
            raise Conflict("A club with that name already exists.")
        cur.execute(
            """INSERT INTO clubs (user_id, club_name, description, image_url, created_by_user_id, active)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING club_id""",
            (
                president_id,
                str(name).strip(),
                payload.get("description"),
                payload.get("imageUrl"),
                principal.user_id,
                bool(payload.get("active", True)),
            ),
        )
        club_id = cur.fetchone()["club_id"]
        _set_club_categories(cur, club_id, categories)
        # The President is a member of their own club from the outset.
        cur.execute(
            "INSERT INTO club_members (club_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (club_id, president_id),
        )
        _log_membership(cur, club_id, president_id, "president_assigned",
                        actor_user_id=principal.user_id, role_label="President")
        audit("clubs.created", club_id=club_id, actor_user_id=principal.user_id)
    return jsonify(_club_response(club_id, principal.user_id)), 201


def _set_club_categories(cur, club_id: int, category_ids) -> None:
    ids = [int(c) for c in (category_ids or [])]
    if not MIN_CATEGORIES <= len(ids) <= MAX_CATEGORIES:
        raise BadRequest(f"A club needs between {MIN_CATEGORIES} and {MAX_CATEGORIES} categories.")
    for category_id in ids:
        exists = fetch_one(
            cur,
            "SELECT 1 FROM club_categories WHERE club_category_id = %s AND archived_at IS NULL",
            (category_id,),
        )
        if not exists:
            raise BadRequest(f"No such category: {category_id}.")
    cur.execute("DELETE FROM club_category_links WHERE club_id = %s", (club_id,))
    for category_id in dict.fromkeys(ids):
        cur.execute(
            "INSERT INTO club_category_links (club_id, club_category_id) VALUES (%s, %s)",
            (club_id, category_id),
        )


def _apply_club_update(club_id: int, payload: dict) -> dict:
    """Club Admin edits anything; a President their own club's blurb and categories."""
    principal = current_principal()
    with transaction() as cur:
        current = fetch_one(cur, "SELECT user_id FROM clubs WHERE club_id = %s", (club_id,))
        if current is None:
            raise NotFound("Club not found.")
        # Read before the UPDATE below overwrites it.
        outgoing_president = current["user_id"]
        is_admin = principal.is_admin or principal.has_role("club-admin")
        if not is_admin and not _is_president(cur, club_id, principal.user_id):
            raise Forbidden("Only a Club Admin or this club's President can edit it.")

        fields: dict[str, object] = {}
        if "description" in payload:
            fields["description"] = payload["description"]
        if "imageUrl" in payload:
            fields["image_url"] = payload["imageUrl"]
        # Renaming, deactivating and changing President are Club Admin powers:
        # a President editing their own club must not be able to rename it out
        # from under the directory or install a successor.
        if is_admin:
            if "name" in payload:
                fields["club_name"] = str(payload["name"]).strip()
            if "active" in payload:
                fields["active"] = bool(payload["active"])
            if "presidentUserId" in payload and payload["presidentUserId"]:
                president_id = int(payload["presidentUserId"])
                holder = fetch_one(
                    cur,
                    "SELECT 1 FROM users WHERE user_id = %s AND is_active "
                    "AND archived_at IS NULL",
                    (president_id,),
                )
                if not holder:
                    raise BadRequest("That user cannot be a President.")
                fields["user_id"] = president_id
        elif any(k in payload for k in ("name", "active", "presidentUserId")):
            raise Forbidden("Only a Club Admin can rename, deactivate or reassign a club.")

        if fields:
            assignments = ", ".join(f"{c} = %s" for c in fields)
            cur.execute(
                f"UPDATE clubs SET {assignments} WHERE club_id = %s", [*fields.values(), club_id]
            )

        # `categoryIds` is what the client sends; `categories` is the older name.
        categories = payload.get("categoryIds", payload.get("categories"))
        if categories is not None:
            # A President may retag their OWN club. Unlike renaming or installing a
            # successor, a category is how the club describes itself to Discover
            # Clubs - it says nothing about the club's standing, and the 1-3 count
            # in _set_club_categories still bounds it. The authority check at the
            # top of this function has already established Club Admin or this
            # club's President, which is exactly who may do this.
            _set_club_categories(cur, club_id, categories)
        elif not fields:
            raise BadRequest("No updatable fields were supplied.")

        # A new President joins their own club, so the roster never contradicts
        # clubs.user_id.
        if "user_id" in fields:
            cur.execute(
                "INSERT INTO club_members (club_id, user_id) VALUES (%s, %s) "
                "ON CONFLICT DO NOTHING",
                (club_id, fields["user_id"]),
            )
            # Two entries, because two things happened: someone stopped presiding
            # and someone else started. A single "president changed" row would
            # leave the outgoing President with no departure in their own history,
            # which is exactly what Previous Clubs reads.
            if outgoing_president and outgoing_president != fields["user_id"]:
                _log_membership(cur, club_id, outgoing_president, "president_stepped_down",
                                actor_user_id=principal.user_id, role_label="President")
            _log_membership(cur, club_id, fields["user_id"], "president_assigned",
                            actor_user_id=principal.user_id, role_label="President")
        audit("clubs.updated", club_id=club_id, actor_user_id=principal.user_id)
    return _club_response(club_id, principal.user_id)


@bp.put("/<int:club_id>")
@require_internal
def replace_club(club_id: int):
    return jsonify(_apply_club_update(club_id, body()))


@bp.patch("/<int:club_id>")
@require_internal
def update_club(club_id: int):
    return jsonify(_apply_club_update(club_id, body()))


@bp.patch("/<int:club_id>/status")
@require_internal
def set_club_status(club_id: int):
    _assert_club_admin()
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")
    return jsonify(_apply_club_update(club_id, {"active": payload["active"]}))


@bp.patch("/<int:club_id>/categories")
@require_internal
def set_club_categories(club_id: int):
    """Club Admin, or this club's own President - _apply_club_update decides.

    My Clubs offers "Edit categories" to a President, so gating this on Club
    Admin made that button a guaranteed 403 for the only people it was shown to.
    """
    payload = body()
    categories = payload.get("categoryIds", payload.get("categories"))
    if categories is None:
        raise BadRequest("A 'categoryIds' array is required.")
    return jsonify(_apply_club_update(club_id, {"categoryIds": categories}))


@bp.get("/<int:club_id>/deletion-check")
@require_internal
def club_deletion_check(club_id: int):
    """What deleting this club would take with it. Shown before the click.

    Runs the shared gate (soft_delete's "club" rule), so a club anyone has
    joined or applied to reports why it cannot go rather than the delete being
    refused after the confirm dialog already said yes. Deactivating it is the
    answer for a club that has been used - it leaves discovery without taking
    fifty people's application history with it.
    """
    _assert_club_admin()
    with transaction() as cur:
        preview = soft_delete.preview(cur, "club", club_id)
    if not preview:
        raise NotFound("Club not found.")
    return jsonify(preview)


@bp.delete("/<int:club_id>")
@require_internal
def delete_club(club_id: int):
    """Soft delete, refused while anything depends on the club.

    This used to hard-delete the row and hand-cascade its category links, join
    requests and members away, so one mis-click destroyed the roster and the
    whole join history with nothing to restore from. Migration 022 added
    archived_at for exactly this; the gate below is the same one every other
    admin entity goes through.

    club_membership_log is deliberately NOT a blocker even though it references
    the club: migration 040 backfilled a row for every current membership, so
    counting it would refuse every club in the system. It stays an owned child
    instead, cleared by the sweep when the club is finally purged.
    """
    _assert_club_admin()
    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM clubs WHERE club_id = %s AND archived_at IS NULL",
                     (club_id,)) is None:
            raise NotFound("Club not found.")
        blockers = soft_delete.soft_delete(cur, "club", club_id)
        if blockers:
            raise Conflict(
                blockers[0] + ". Deactivate the club instead - that hides it from Discover "
                "Clubs without erasing what its members did."
            )
        audit("clubs.deleted", club_id=club_id, actor_user_id=current_principal().user_id)
    return "", 204


# The three retention columns the Deleted tab renders, spliced into _CLUB_SELECT's
# projection. Written as its own fragment rather than a second full SELECT so the
# bin and the live list can never disagree about what a club record looks like.
_CLUB_DELETION_COLUMNS = """,
           c.archived_at AS "deletedAt",
           (c.archived_at + make_interval(days => %(retention)s)) AS "permanentDeletionAt",
           GREATEST(0, %(retention)s - EXTRACT(DAY FROM now() - c.archived_at)::int)
               AS "daysRemaining\""""


@bp.get("/deleted")
@require_internal
def list_deleted_clubs():
    """The bin: clubs awaiting a restore or the sweep, with the days left on
    each. Same shape as the deleted-categories list above."""
    _assert_club_admin()
    rows = query(
        _CLUB_SELECT.replace("\n      FROM clubs c", _CLUB_DELETION_COLUMNS + "\n      FROM clubs c")
        + " WHERE c.archived_at IS NOT NULL ORDER BY c.archived_at DESC",
        {"viewer": current_principal().user_id, "retention": RETENTION_DAYS},
    )
    return jsonify(_shape_clubs(rows))


@bp.post("/<int:club_id>/restore")
@require_internal
def restore_club(club_id: int):
    """Bring a club back out of the bin - deactivated, deliberately.

    `active` is left FALSE so a club returning from the bin never silently
    reappears in Discover Clubs; someone re-enables it explicitly, after
    checking it should be. Matches soft_delete.restore()'s rule for every other
    entity.
    """
    _assert_club_admin()
    with transaction() as cur:
        if not soft_delete.restore(cur, "club", club_id):
            raise NotFound("No deleted club with that id.")
        audit("clubs.restored", club_id=club_id, actor_user_id=current_principal().user_id)
    return jsonify(_club_response(club_id, current_principal().user_id))


# --- Membership -----------------------------------------------------------
@bp.get("/<int:club_id>/members")
@require_auth
def list_members(club_id: int):
    """The roster. Each row nests the user, matching ClubMemberRecord, and the
    President is labelled as such rather than appearing as a plain member."""
    rows = query(
        """SELECT u.user_id AS id, u.full_name AS "displayName", u.email,
                  m.date_joined AS "dateJoined", (c.user_id = u.user_id) AS is_president
             FROM club_members m
             JOIN users u ON u.user_id = m.user_id
             JOIN clubs c ON c.club_id = m.club_id
            WHERE m.club_id = %s ORDER BY u.full_name""",
        (club_id,),
    )
    return jsonify(
        [
            {
                "user": {
                    "id": str(row["id"]),
                    "displayName": row["displayName"],
                    "email": row["email"],
                    "role": "President" if row["is_president"] else "Member",
                },
                "dateJoined": row["dateJoined"],
            }
            for row in rows
        ]
    )


@bp.delete("/<int:club_id>/members/<int:user_id>")
@require_internal
def remove_member(club_id: int, user_id: int):
    """The President removes a member; anyone may remove themselves."""
    principal = current_principal()
    with transaction() as cur:
        is_self = user_id == principal.user_id
        by_president = not is_self and _is_president(cur, club_id, principal.user_id)
        if not is_self and not by_president:
            if not (principal.is_admin or principal.has_role("club-admin")):
                raise Forbidden("Only this club's President can remove a member.")
        if _is_president(cur, club_id, user_id):
            raise Conflict("The President cannot be removed. Assign a new President first.")
        cur.execute(
            "DELETE FROM club_members WHERE club_id = %s AND user_id = %s RETURNING user_id",
            (club_id, user_id),
        )
        if cur.fetchone() is None:
            raise NotFound("That person is not a member of this club.")
        # The distinction the log exists to keep: walking out is not being shown out.
        _log_membership(cur, club_id, user_id, "left" if is_self else "removed",
                        actor_user_id=principal.user_id)
        # Removal is the one club transition the member did not ask for, so it is
        # the one they would otherwise discover only by noticing the club had
        # vanished from My Clubs. Someone leaving of their own accord already
        # knows and is deliberately not mailed.
        if not is_self:
            dispatch.club_member_removed(cur, club_id, user_id, by_president=by_president)
    return "", 204


# --- Join requests --------------------------------------------------------
@bp.post("/<int:club_id>/join-requests")
@require_internal
def request_to_join(club_id: int):
    principal = current_principal()
    payload = body()
    (reason,) = required(payload, "reason")

    with transaction() as cur:
        club = fetch_one(cur, "SELECT active FROM clubs WHERE club_id = %s", (club_id,))
        if club is None:
            raise NotFound("Club not found.")
        if not club["active"]:
            raise Conflict("This club is not currently accepting members.")
        member = fetch_one(
            cur, "SELECT 1 FROM club_members WHERE club_id = %s AND user_id = %s",
            (club_id, principal.user_id),
        )
        if member:
            raise Conflict("You are already a member of this club.")
        # The partial unique index enforces this too; the check gives a clearer message.
        pending = fetch_one(
            cur,
            "SELECT 1 FROM club_join_requests WHERE club_id = %s AND requester_user_id = %s "
            "AND status = 'pending'",
            (club_id, principal.user_id),
        )
        if pending:
            raise Conflict("You already have a request pending for this club.")

        cur.execute(
            """INSERT INTO club_join_requests (club_id, requester_user_id, reason, status)
               VALUES (%s, %s, %s, 'pending') RETURNING club_join_request_id""",
            (club_id, principal.user_id, reason),
        )
        request_id = cur.fetchone()["club_join_request_id"]
        # The President is the only person who can decide this, so without an
        # email it waits in an inbox they have no reason to open.
        dispatch.club_join_requested(
            cur,
            club_id,
            requester_name=principal.full_name,
            requester_email=principal.email,
            reason=reason,
        )
    return jsonify({"id": request_id, "status": "pending"}), 201


_JOIN_REQUEST_SELECT = """
    SELECT j.club_join_request_id AS id, j.club_id AS "clubId", c.club_name AS "clubName",
           c.image_url AS "clubImageUrl",
           u.user_id AS requester_id, u.full_name AS requester_name, u.email AS requester_email,
           j.reason, j.status, COALESCE(j.comment, '') AS comment,
           j.created_at AS "createdAt", j.resolved_at AS "resolvedAt"
      FROM club_join_requests j
      JOIN clubs c ON c.club_id = j.club_id
      JOIN users u ON u.user_id = j.requester_user_id
"""


def _shape_join_requests(rows: list[dict]) -> list[dict]:
    for row in rows:
        row["requester"] = _user_summary(
            row.pop("requester_id"), row.pop("requester_name"), row.pop("requester_email"),
            "Member",
        )
        row["id"] = str(row["id"])
        row["clubId"] = str(row["clubId"])
    return rows


def _join_request_response(join_request_id: int) -> dict:
    rows = query(_JOIN_REQUEST_SELECT + " WHERE j.club_join_request_id = %s", (join_request_id,))
    if not rows:
        raise NotFound("Join request not found.")
    return _shape_join_requests(rows)[0]


@bp.get("/join-requests/inbox")
@require_internal
def join_requests_inbox():
    """Pending requests for the clubs the caller presides over.

    Scoped by clubs.user_id rather than by a query parameter: the inbox is
    whose it is, so a caller naming someone else's id must not receive theirs.

    Searched/filtered/paginated in SQL, same convention as
    events.py's pending_approvals() - ?q= searches requester name/email/
    reason, ?club= narrows to one club name (the Inbox's club dropdown),
    ?page/?pageSize cap what one response can hand back so a President of
    several large clubs can't pull the whole queue in one request by mistake.
    """
    principal = current_principal()
    where = ["c.user_id = %s", "j.status = 'pending'"]
    params: list = [principal.user_id]

    # Sorted in SQL, not in the browser: the queue is paginated, so ordering the rows the client
    # happens to be holding would sort one page of an arbitrary slice rather than the queue.
    sort_key = request.args.get("sort", "requested")
    sort_column = _JOIN_REQUEST_SORT_COLUMNS.get(sort_key, _JOIN_REQUEST_SORT_COLUMNS["requested"])
    order = "ASC" if request.args.get("order", "asc") == "asc" else "DESC"

    club_filter = (request.args.get("club") or "").strip()
    if club_filter:
        where.append("c.club_name = %s")
        params.append(club_filter)

    search = (request.args.get("q") or "").strip()
    if search:
        where.append("(u.full_name ILIKE %s OR u.email ILIKE %s OR j.reason ILIKE %s)")
        params.extend([f"%{search}%"] * 3)

    where_sql = " AND ".join(where)
    with transaction() as cur:
        total = fetch_one(
            cur,
            f"""SELECT count(*) AS c
                  FROM club_join_requests j
                  JOIN clubs c ON c.club_id = j.club_id
                  JOIN users u ON u.user_id = j.requester_user_id
                 WHERE {where_sql}""",
            params,
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"{_JOIN_REQUEST_SELECT} WHERE {where_sql} "
            f"ORDER BY {sort_column} {order}, j.club_join_request_id {order} LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
    return jsonify(paged(_shape_join_requests(rows), total))


@bp.get("/join-requests/inbox/clubs")
@require_internal
def join_requests_inbox_club_options():
    """Distinct club names with at least one pending join request, for the
    Inbox's club filter dropdown - its own small, unpaginated query so the
    dropdown lists every matching club regardless of which page is shown."""
    principal = current_principal()
    rows = query(
        """SELECT DISTINCT c.club_name AS "clubName"
             FROM club_join_requests j
             JOIN clubs c ON c.club_id = j.club_id
            WHERE c.user_id = %s AND j.status = 'pending'
         ORDER BY c.club_name""",
        (principal.user_id,),
    )
    return jsonify([row["clubName"] for row in rows])


@bp.get("/join-requests/decided")
@require_internal
def join_requests_decided():
    """Requests the caller has already RESOLVED as President - the other half
    of join_requests_inbox() (which is pending-only). Feeds the History tab's
    "decided by me" direction."""
    principal = current_principal()
    rows = query(
        _JOIN_REQUEST_SELECT + " WHERE c.user_id = %s AND j.status <> 'pending' "
        f"ORDER BY {date_order('j.resolved_at')}, j.club_join_request_id DESC",
        (principal.user_id,),
    )
    return jsonify(_shape_join_requests(rows))


@bp.get("/join-requests/mine")
@require_auth
def join_requests_mine():
    principal = current_principal()
    rows = query(
        _JOIN_REQUEST_SELECT + " WHERE j.requester_user_id = %s "
        f"ORDER BY {date_order('j.created_at')}, j.club_join_request_id DESC",
        (principal.user_id,),
    )
    return jsonify(_shape_join_requests(rows))


@bp.get("/join-requests")
@require_internal
def list_join_requests():
    """?scope=mine (default) or ?scope=inbox. Kept for callers predating the
    dedicated /inbox and /mine paths."""
    if request.args.get("scope") == "inbox":
        return join_requests_inbox()
    return join_requests_mine()


JOIN_DECISIONS = ("approve", "reject")
MIN_REJECTION_COMMENT = 20


def _decide_join_request(join_request_id: int, decision: str, comment: str) -> dict:
    """Only the President of the club in question may decide.

    Approval adds the membership row in the same transaction as the status
    change, so an approved request can never leave someone un-joined.
    """
    principal = current_principal()
    if decision == "reject" and len(comment) < MIN_REJECTION_COMMENT:
        raise BadRequest(
            f"A rejection needs an explanation of at least {MIN_REJECTION_COMMENT} characters."
        )

    with transaction() as cur:
        join_request = fetch_one(
            cur, "SELECT * FROM club_join_requests WHERE club_join_request_id = %s",
            (join_request_id,),
        )
        if join_request is None:
            raise NotFound("Join request not found.")
        if not _is_president(cur, join_request["club_id"], principal.user_id):
            raise Forbidden("Only this club's President can decide join requests.")
        if join_request["status"] != "pending":
            raise Conflict("This request has already been decided.")

        cur.execute(
            """UPDATE club_join_requests
                  SET status = %s, comment = %s, resolved_at = now(), resolved_by_user_id = %s
                WHERE club_join_request_id = %s""",
            (
                "approved" if decision == "approve" else "rejected",
                comment or None,
                principal.user_id,
                join_request_id,
            ),
        )
        if decision == "approve":
            cur.execute(
                "INSERT INTO club_members (club_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (join_request["club_id"], join_request["requester_user_id"]),
            )
            _log_membership(cur, join_request["club_id"], join_request["requester_user_id"],
                            "joined", actor_user_id=principal.user_id)
        audit("clubs.join_request.decided", club_id=join_request["club_id"],
              decision=decision, actor_user_id=principal.user_id)
        dispatch.club_join_decided(
            cur, join_request_id, approved=decision == "approve", comment=comment
        )
    return _join_request_response(join_request_id)


@bp.post("/join-requests/<int:join_request_id>/approve")
@require_internal
def approve_join_request(join_request_id: int):
    return jsonify(_decide_join_request(join_request_id, "approve", ""))


@bp.post("/join-requests/<int:join_request_id>/reject")
@require_internal
def reject_join_request(join_request_id: int):
    payload = body()
    comment = str(payload.get("comment") or "").strip()
    return jsonify(_decide_join_request(join_request_id, "reject", comment))


@bp.post("/join-requests/<int:join_request_id>/decision")
@require_internal
def decide_join_request(join_request_id: int):
    payload = body()
    (decision,) = required(payload, "decision")
    if decision not in JOIN_DECISIONS:
        raise BadRequest("Decision must be approve or reject.")
    comment = str(payload.get("comment") or "").strip()
    return jsonify(_decide_join_request(join_request_id, str(decision), comment))


@bp.get("/eligible-presidents")
@require_internal
def eligible_presidents():
    """Students only - the only role that may preside over a club.

    Two legitimate callers: a Club Admin picking/reassigning a President when
    creating or editing a club, and a sitting President naming a replacement
    for a president-change-request. Anyone else is refused.

    Projects only id/displayName/email - every caller only ever builds a
    dropdown option out of those three (see club-management.ts's
    presidentOptions and president-change-request-modal.ts's own mapping);
    there is no per-caller "role" here worth a column (it was always the same
    hardcoded 'Member' string), so it is not sent."""
    principal = current_principal()
    if not principal.is_admin and not principal.has_role("club-admin"):
        is_a_president = query("SELECT 1 FROM clubs WHERE user_id = %s", (principal.user_id,))
        if not is_a_president:
            raise Forbidden("Only a Club Admin or a club President can view eligible Presidents.")
    rows = query(
        """SELECT DISTINCT u.user_id AS id, u.full_name AS "displayName", u.email
             FROM users u JOIN user_unit_roles uur ON uur.user_id = u.user_id
            WHERE uur.role_code = 'student'
              AND u.is_active AND u.archived_at IS NULL
         ORDER BY u.full_name"""
    )
    for row in rows:
        row["id"] = str(row["id"])
    return jsonify(rows)


# --- President Change Requests ---------------------------------------------
# A President cannot leave their own club or be removed (remove_member() below always blocks it) - the
# only way out is naming a replacement here for a Club Admin to approve.

_PCR_SELECT = """
    SELECT r.club_president_change_request_id AS id, r.club_id AS "clubId", c.club_name AS "clubName",
           cp.user_id AS current_president_id, cp.full_name AS current_president_name, cp.email AS current_president_email,
           np.user_id AS requested_president_id, np.full_name AS requested_president_name, np.email AS requested_president_email,
           r.status, COALESCE(r.comment, '') AS comment,
           r.created_at AS "createdAt", r.resolved_at AS "resolvedAt",
           rb.user_id AS resolved_by_id, rb.full_name AS resolved_by_name, rb.email AS resolved_by_email
      FROM club_president_change_requests r
      JOIN clubs c ON c.club_id = r.club_id
      JOIN users cp ON cp.user_id = r.current_president_user_id
      JOIN users np ON np.user_id = r.requested_president_user_id
 LEFT JOIN users rb ON rb.user_id = r.resolved_by_user_id
"""

# Sortable columns on the join-request queues.
_JOIN_REQUEST_SORT_COLUMNS = {
    "requested": "j.created_at",
    "club": "c.club_name",
    "requester": "u.full_name",
    "status": "j.status",
}


_PCR_SORT_COLUMNS = {
    "createdAt": "r.created_at",
    "resolvedAt": "r.resolved_at",
    "club": "c.club_name",
    "status": "r.status",
}


def _shape_pcr(rows: list[dict]) -> list[dict]:
    for row in rows:
        row["currentPresident"] = _user_summary(
            row.pop("current_president_id"), row.pop("current_president_name"), row.pop("current_president_email"),
            "President",
        )
        row["requestedPresident"] = _user_summary(
            row.pop("requested_president_id"), row.pop("requested_president_name"), row.pop("requested_president_email"),
            "Member",
        )
        row["resolvedBy"] = _user_summary(
            row.pop("resolved_by_id"), row.pop("resolved_by_name"), row.pop("resolved_by_email"), "Club Admin",
        )
        row["id"] = str(row["id"])
        row["clubId"] = str(row["clubId"])
    return rows


def _pcr_response(request_id: int) -> dict:
    rows = query(_PCR_SELECT + " WHERE r.club_president_change_request_id = %s", (request_id,))
    if not rows:
        raise NotFound("President change request not found.")
    return _shape_pcr(rows)[0]


@bp.post("/<int:club_id>/president-change-requests")
@require_internal
def request_president_change(club_id: int):
    """Only the club's own President may submit this, naming an eligible
    (student) replacement. One pending request per club at a time -
    uq_pcr_pending_per_club enforces it; the check here gives a clearer
    message."""
    principal = current_principal()
    payload = body()
    (requested_president_user_id,) = required(payload, "requestedPresidentUserId")

    with transaction() as cur:
        club = fetch_one(cur, "SELECT user_id FROM clubs WHERE club_id = %s", (club_id,))
        if club is None:
            raise NotFound("Club not found.")
        if club["user_id"] != principal.user_id:
            raise Forbidden("Only this club's President can request a President change.")

        try:
            new_president_id = int(requested_president_user_id)
        except (TypeError, ValueError):
            raise BadRequest("requestedPresidentUserId must be numeric.")
        if new_president_id == principal.user_id:
            raise BadRequest("Choose someone other than yourself as the new President.")
        eligible = fetch_one(
            cur,
            """SELECT 1 FROM users u JOIN user_unit_roles uur ON uur.user_id = u.user_id
                WHERE u.user_id = %s AND uur.role_code = 'student'
                  AND u.is_active AND u.archived_at IS NULL""",
            (new_president_id,),
        )
        if not eligible:
            raise BadRequest("The requested President must be an active student.")

        pending = fetch_one(
            cur,
            "SELECT 1 FROM club_president_change_requests WHERE club_id = %s AND status = 'pending'",
            (club_id,),
        )
        if pending:
            raise Conflict("A President change request is already pending for this club.")

        cur.execute(
            """INSERT INTO club_president_change_requests
                   (club_id, current_president_user_id, requested_president_user_id, status)
               VALUES (%s, %s, %s, 'pending')
               RETURNING club_president_change_request_id""",
            (club_id, principal.user_id, new_president_id),
        )
        request_id = cur.fetchone()["club_president_change_request_id"]
        audit("clubs.president_change_request.submitted", club_id=club_id, actor_user_id=principal.user_id)
    return jsonify(_pcr_response(request_id)), 201


def _pcr_paged(where: list[str], params: list, default_sort: str = "createdAt", default_order: str = "desc") -> dict:
    where_sql = " AND ".join(where)
    sort_key = request.args.get("sort", default_sort)
    sort_column = _PCR_SORT_COLUMNS.get(sort_key, _PCR_SORT_COLUMNS[default_sort])
    order = "ASC" if request.args.get("order", default_order) == "asc" else "DESC"

    search = (request.args.get("q") or "").strip()
    if search:
        where_sql += " AND (c.club_name ILIKE %s OR cp.full_name ILIKE %s OR np.full_name ILIKE %s)"
        like = f"%{search}%"
        params = [*params, like, like, like]

    with transaction() as cur:
        total = fetch_one(
            cur,
            f"""SELECT count(*) AS c FROM club_president_change_requests r
                  JOIN clubs c ON c.club_id = r.club_id
                  JOIN users cp ON cp.user_id = r.current_president_user_id
                  JOIN users np ON np.user_id = r.requested_president_user_id
                 WHERE {where_sql}""",
            params,
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"{_PCR_SELECT} WHERE {where_sql} ORDER BY {sort_column} {order}, r.club_president_change_request_id {order} "
            f"LIMIT %s OFFSET %s",
            [*params, limit, offset],
        )
    return paged(_shape_pcr(rows), total)


@bp.get("/president-change-requests/inbox")
@require_internal
def president_change_requests_inbox():
    """Pending President change requests, for a Club Admin (or System Admin)
    to decide - this is a flat authority, not scoped to particular clubs."""
    _assert_club_admin()
    return jsonify(_pcr_paged(["r.status = 'pending'"], []))


@bp.get("/president-change-requests/mine")
@require_internal
def president_change_requests_mine():
    """A President's own submitted requests, any status - their inbox view
    while pending, and their history view once decided."""
    principal = current_principal()
    return jsonify(_pcr_paged(["r.current_president_user_id = %s"], [principal.user_id]))


@bp.get("/president-change-requests/history")
@require_internal
def president_change_requests_history():
    """Every decided (approved/rejected) request, for the History tab -
    Club Admin/System Admin only."""
    _assert_club_admin()
    return jsonify(_pcr_paged(["r.status <> 'pending'"], [], default_sort="resolvedAt"))


MIN_PCR_REJECTION_COMMENT = 20


def _decide_president_change(request_id: int, decision: str, comment: str) -> dict:
    _assert_club_admin()
    if decision == "reject" and len(comment) < MIN_PCR_REJECTION_COMMENT:
        raise BadRequest(
            f"A rejection needs an explanation of at least {MIN_PCR_REJECTION_COMMENT} characters."
        )
    principal = current_principal()

    with transaction() as cur:
        pcr = fetch_one(
            cur, "SELECT * FROM club_president_change_requests WHERE club_president_change_request_id = %s",
            (request_id,),
        )
        if pcr is None:
            raise NotFound("President change request not found.")
        if pcr["status"] != "pending":
            raise Conflict("This request has already been decided.")

        cur.execute(
            """UPDATE club_president_change_requests
                  SET status = %s, comment = %s, resolved_at = now(), resolved_by_user_id = %s
                WHERE club_president_change_request_id = %s""",
            (
                "approved" if decision == "approve" else "rejected",
                comment or None,
                principal.user_id,
                request_id,
            ),
        )
        if decision == "approve":
            cur.execute(
                "UPDATE clubs SET user_id = %s WHERE club_id = %s",
                (pcr["requested_president_user_id"], pcr["club_id"]),
            )
            # The new President is now presiding, not merely a member - drop any
            # stale club_members row so they don't also show up as "a member".
            cur.execute(
                "DELETE FROM club_members WHERE club_id = %s AND user_id = %s",
                (pcr["club_id"], pcr["requested_president_user_id"]),
            )
            # The outgoing President keeps no membership row either (they never had
            # one separate from presiding), so without this entry a handover would
            # erase them from the club entirely, with nothing to show they had ever
            # led it.
            _log_membership(cur, pcr["club_id"], pcr["current_president_user_id"],
                            "president_stepped_down", actor_user_id=principal.user_id,
                            role_label="President")
            _log_membership(cur, pcr["club_id"], pcr["requested_president_user_id"],
                            "president_assigned", actor_user_id=principal.user_id,
                            role_label="President")
        audit("clubs.president_change_request.decided", club_id=pcr["club_id"],
              decision=decision, actor_user_id=principal.user_id)
    return _pcr_response(request_id)


@bp.post("/president-change-requests/<int:request_id>/approve")
@require_internal
def approve_president_change(request_id: int):
    return jsonify(_decide_president_change(request_id, "approve", ""))


@bp.post("/president-change-requests/<int:request_id>/reject")
@require_internal
def reject_president_change(request_id: int):
    payload = body()
    comment = str(payload.get("comment") or "").strip()
    return jsonify(_decide_president_change(request_id, "reject", comment))


# --- Previous Clubs -------------------------------------------------------
# How a membership ended, which is the Status filter on /app/clubs/my-clubs/previous.
# Keyed by the query-string value the client sends; the SQL is fixed here and the
# key is looked up rather than interpolated, so nothing from the request reaches
# the statement.
_PREVIOUS_CLUB_STATUSES = {
    "left": ("left",),
    "removed": ("removed",),
    "stepped-down": ("president_stepped_down",),
}
_PREVIOUS_CLUB_ACTIONS = ("left", "removed", "president_stepped_down")

# The most recent departure per (club, viewer), and the role they held at the time.
# DISTINCT ON collapses a club someone joined and left more than once to the last
# time they left it - the page is "clubs I used to be in", not a per-episode
# timeline, and a club appearing three times would read as three clubs.
#
# The NOT EXISTS is what makes it PREVIOUS: rejoining a club, or being installed
# as its President again, removes it from this list even though the old departure
# entry is still on file.
_PREVIOUS_CLUBS_SQL = """
    SELECT DISTINCT ON (l.club_id)
           l.club_id::text AS "clubId",
           c.club_name AS "clubName",
           c.image_url AS "clubImageUrl",
           l.action,
           l.role_label AS "roleLabel",
           l.occurred_at AS "occurredAt",
           actor.full_name AS "actorName",
           (SELECT min(j.occurred_at) FROM club_membership_log j
             WHERE j.club_id = l.club_id AND j.subject_user_id = l.subject_user_id
               AND j.action IN ('joined', 'president_assigned')) AS "joinedAt"
      FROM club_membership_log l
      JOIN clubs c ON c.club_id = l.club_id
 LEFT JOIN users actor ON actor.user_id = l.actor_user_id
     WHERE l.subject_user_id = %(viewer)s
       AND l.action = ANY(%(actions)s)
       AND c.archived_at IS NULL
       AND NOT EXISTS (
             SELECT 1 FROM club_members m
              WHERE m.club_id = l.club_id AND m.user_id = %(viewer)s
           )
       AND c.user_id IS DISTINCT FROM %(viewer)s
  ORDER BY l.club_id, l.occurred_at DESC
"""


@bp.get("/me/previous")
@require_auth
def my_previous_clubs():
    """Clubs the caller used to belong to - /app/clubs/my-clubs/previous.

    Search (?q= club name), status (?status=left|removed|stepped-down) and
    page/pageSize are all resolved in SQL, so the browser only receives the one
    page it is about to render. Reads club_membership_log (migration 040), which
    is the only record that a membership ever existed once club_members' row is
    gone - so this list starts at that migration and grows from there.
    """
    principal = current_principal()
    params: dict = {"viewer": principal.user_id, "actions": list(_PREVIOUS_CLUB_ACTIONS)}
    where = ["1 = 1"]

    status = (request.args.get("status") or "all").strip()
    if status in _PREVIOUS_CLUB_STATUSES:
        params["actions"] = list(_PREVIOUS_CLUB_STATUSES[status])

    search = (request.args.get("q") or "").strip()
    if search:
        where.append('"clubName" ILIKE %(q)s')
        params["q"] = f"%{search}%"

    where_sql = " AND ".join(where)
    with transaction() as cur:
        total = fetch_one(
            cur, f"SELECT count(*) AS c FROM ({_PREVIOUS_CLUBS_SQL}) p WHERE {where_sql}", params
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"""SELECT * FROM ({_PREVIOUS_CLUBS_SQL}) p WHERE {where_sql}
                ORDER BY {date_order('"occurredAt"')}, "clubId"
                LIMIT %(limit)s OFFSET %(offset)s""",
            {**params, "limit": limit, "offset": offset},
        )
    return jsonify(paged(rows, total))


# --- Club logs ------------------------------------------------------------
# Three tabs, one row shape, one endpoint. Every tab returns the same columns so
# the client renders all three through a single table view: when, who it is
# about, what happened, and a line of context.
#
# Only the Members tab reads club_membership_log. The other two are derived live
# from tables that already hold the history - request_clubs/request for the
# events addressed to this club, club_join_requests/club_president_change_requests
# for the applications it has received. Copying those into the log would create a
# second version of a fact the database already has, and it would only ever cover
# what happened after migration 040; derived, they are complete from day one.
_LOG_MEMBERS_SQL = """
    SELECT l.occurred_at AS "occurredAt",
           subject.full_name AS "subjectName",
           subject.email AS "subjectEmail",
           l.action,
           l.role_label AS "roleLabel",
           actor.full_name AS "actorName",
           NULL::text AS "referenceCode",
           NULL::text AS "referenceTitle"
      FROM club_membership_log l
      JOIN users subject ON subject.user_id = l.subject_user_id
 LEFT JOIN users actor ON actor.user_id = l.actor_user_id
     WHERE l.club_id = %(club)s
"""

# Every proposal addressed to this club, whatever stage it reached - a draft that
# was never submitted included, since "someone started one and abandoned it" is
# exactly the kind of thing a President opens a log to find out. Dated by
# submission where there is one, else by creation.
_LOG_EVENTS_SQL = """
    SELECT coalesce(r.submitted_at, r.created_at) AS "occurredAt",
           applicant.full_name AS "subjectName",
           applicant.email AS "subjectEmail",
           'event_' || r.status AS action,
           NULL::text AS "roleLabel",
           NULL::text AS "actorName",
           r.request_code AS "referenceCode",
           r.event_title AS "referenceTitle"
      FROM request_clubs rc
      JOIN request r ON r.request_id = rc.request_id
      JOIN users applicant ON applicant.user_id = r.applicant_user_id
     WHERE rc.club_id = %(club)s
"""

# Applications the club received, both kinds, each appearing once at the point it
# was decided (or as still pending). A rejected join request never becomes a
# membership entry, so this tab is the only place it is visible at all.
_LOG_REQUESTS_SQL = """
    SELECT coalesce(j.resolved_at, j.created_at) AS "occurredAt",
           requester.full_name AS "subjectName",
           requester.email AS "subjectEmail",
           'join_' || j.status AS action,
           NULL::text AS "roleLabel",
           decider.full_name AS "actorName",
           NULL::text AS "referenceCode",
           NULL::text AS "referenceTitle"
      FROM club_join_requests j
      JOIN users requester ON requester.user_id = j.requester_user_id
 LEFT JOIN users decider ON decider.user_id = j.resolved_by_user_id
     WHERE j.club_id = %(club)s

    UNION ALL

    SELECT coalesce(p.resolved_at, p.created_at) AS "occurredAt",
           nominee.full_name AS "subjectName",
           nominee.email AS "subjectEmail",
           'president_change_' || p.status AS action,
           'President' AS "roleLabel",
           decider.full_name AS "actorName",
           NULL::text AS "referenceCode",
           NULL::text AS "referenceTitle"
      FROM club_president_change_requests p
      JOIN users nominee ON nominee.user_id = p.requested_president_user_id
 LEFT JOIN users decider ON decider.user_id = p.resolved_by_user_id
     WHERE p.club_id = %(club)s
"""

CLUB_LOG_CATEGORIES = {
    "member": _LOG_MEMBERS_SQL,
    "event": _LOG_EVENTS_SQL,
    "request": _LOG_REQUESTS_SQL,
}


@bp.get("/<int:club_id>/logs")
@require_internal
def club_logs(club_id: int):
    """This club's activity log - ?category=member|event|request, one tab each.

    Scoped to the CLUB, not to whoever is presiding: a new President reads the
    same entries their predecessor did, including the handover that put them
    there. That is the whole point of keeping it in a table rather than deriving
    it from what the current President happens to be able to see.
    """
    principal = current_principal()
    category = (request.args.get("category") or "member").strip()
    if category not in CLUB_LOG_CATEGORIES:
        raise BadRequest("category must be one of: member, event, request.")

    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM clubs WHERE club_id = %s", (club_id,)) is None:
            raise NotFound("Club not found.")
        # The President reads their own club's log; a Club Admin reads any. A plain
        # member does not - the log names who was removed and by whom, which is the
        # President's business and not the roster's.
        if not (principal.is_admin or principal.has_role("club-admin")):
            if not _is_president(cur, club_id, principal.user_id):
                raise Forbidden("Only this club's President can view its logs.")

        base = CLUB_LOG_CATEGORIES[category]
        params: dict = {"club": club_id}
        where = ["1 = 1"]

        search = (request.args.get("q") or "").strip()
        if search:
            where.append(
                '("subjectName" ILIKE %(q)s OR "subjectEmail" ILIKE %(q)s '
                'OR coalesce("referenceTitle", \'\') ILIKE %(q)s)'
            )
            params["q"] = f"%{search}%"

        action = (request.args.get("action") or "all").strip()
        if action and action != "all":
            where.append("action = %(action)s")
            params["action"] = action

        where_sql = " AND ".join(where)
        total = fetch_one(
            cur, f"SELECT count(*) AS c FROM ({base}) l WHERE {where_sql}", params
        )["c"]
        limit, offset = pagination()
        rows = fetch_all(
            cur,
            f"""SELECT * FROM ({base}) l WHERE {where_sql}
                ORDER BY {date_order('"occurredAt"')}, "subjectName"
                LIMIT %(limit)s OFFSET %(offset)s""",
            {**params, "limit": limit, "offset": offset},
        )
    return jsonify(paged(rows, total))

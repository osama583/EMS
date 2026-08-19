"""Clubs: directory, membership, join requests, and club administration.

    GET/POST/PATCH/DELETE  /clubs[/{id}]
    GET                    /clubs/{id}/members
    DELETE                 /clubs/{id}/members/{user_id}
    POST                   /clubs/{id}/join-requests          ask to join
    GET                    /clubs/join-requests               mine, or my inbox
    POST                   /clubs/join-requests/{id}/decision approve | reject
    GET/POST/PATCH/DELETE  /clubs/categories[/{id}]

Two distinct authorities, easy to confuse:
  Club Admin  - a flat role. Creates and deactivates any club, manages categories.
  President   - NOT a role. A data fact: clubs.user_id. One per club, and only
                they decide their own club's join requests.

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
from ._helpers import body, flag, required

bp = Blueprint("clubs", __name__, url_prefix="/clubs")

MIN_CATEGORIES, MAX_CATEGORIES = 1, 3


def _is_president(cur, club_id: int, user_id: int) -> bool:
    return (
        fetch_one(cur, "SELECT 1 FROM clubs WHERE club_id = %s AND user_id = %s", (club_id, user_id))
        is not None
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
           EXISTS (SELECT 1 FROM club_join_requests j
                    WHERE j.club_id = c.club_id AND j.requester_user_id = %(viewer)s
                      AND j.status = 'pending') AS "viewerHasPendingRequest",
           (c.user_id = %(viewer)s) AS "viewerIsPresident"
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
    rows = query(_CLUB_SELECT + " WHERE c.club_id = %(club)s",
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
    sql = _CLUB_SELECT
    if flag("activeOnly") or flag("active"):
        sql += " WHERE c.active"
    rows = query(sql + " ORDER BY c.club_name", {"viewer": principal.user_id})
    return jsonify(_shape_clubs(rows))


# --- Categories -----------------------------------------------------------
# Their own top-level resource: a category exists independently of any club,
# and the client manages them from their own screen.
categories_bp = Blueprint("club_categories", __name__, url_prefix="/club-categories")

RETENTION_DAYS = 7

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
    sql = _CATEGORY_SELECT + " WHERE archived_at IS NULL"
    if flag("activeOnly") or flag("active"):
        sql += " AND active"
    rows = query(sql + " ORDER BY name")
    for row in rows:
        row.pop("archived_at", None)
        row["id"] = str(row["id"])
    return jsonify(rows)


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
    rows = query("SELECT club_id FROM clubs WHERE user_id = %s ORDER BY club_id", (user_id,))
    is_club_admin = principal.is_admin or principal.has_role("club-admin")
    return jsonify(
        {
            "isClubAdmin": bool(is_club_admin),
            "presidentOfClubIds": [str(r["club_id"]) for r in rows],
        }
    )


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
    """Club Admin edits anything; a President may edit their own club's blurb."""
    principal = current_principal()
    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM clubs WHERE club_id = %s", (club_id,)) is None:
            raise NotFound("Club not found.")
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
            if not is_admin:
                raise Forbidden("Only a Club Admin can change a club's categories.")
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
    _assert_club_admin()
    payload = body()
    categories = payload.get("categoryIds", payload.get("categories"))
    if categories is None:
        raise BadRequest("A 'categoryIds' array is required.")
    return jsonify(_apply_club_update(club_id, {"categoryIds": categories}))


@bp.delete("/<int:club_id>")
@require_internal
def delete_club(club_id: int):
    _assert_club_admin()
    with transaction() as cur:
        cur.execute("DELETE FROM club_category_links WHERE club_id = %s", (club_id,))
        cur.execute("DELETE FROM club_join_requests WHERE club_id = %s", (club_id,))
        cur.execute("DELETE FROM club_members WHERE club_id = %s", (club_id,))
        cur.execute("DELETE FROM clubs WHERE club_id = %s RETURNING club_id", (club_id,))
        if cur.fetchone() is None:
            raise NotFound("Club not found.")
        audit("clubs.deleted", club_id=club_id, actor_user_id=current_principal().user_id)
    return "", 204


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
        if not is_self and not _is_president(cur, club_id, principal.user_id):
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
    return jsonify({"id": request_id, "status": "pending"}), 201


_JOIN_REQUEST_SELECT = """
    SELECT j.club_join_request_id AS id, j.club_id AS "clubId", c.club_name AS "clubName",
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
    """
    principal = current_principal()
    rows = query(
        _JOIN_REQUEST_SELECT + " WHERE c.user_id = %s AND j.status = 'pending' "
        "ORDER BY j.created_at",
        (principal.user_id,),
    )
    return jsonify(_shape_join_requests(rows))


@bp.get("/join-requests/mine")
@require_auth
def join_requests_mine():
    principal = current_principal()
    rows = query(
        _JOIN_REQUEST_SELECT + " WHERE j.requester_user_id = %s ORDER BY j.created_at DESC",
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
        audit("clubs.join_request.decided", club_id=join_request["club_id"],
              decision=decision, actor_user_id=principal.user_id)
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
    """Students and lecturers - the only roles that may preside over a club."""
    _assert_club_admin()
    rows = query(
        """SELECT DISTINCT u.user_id AS id, u.full_name AS "displayName", u.email
             FROM users u JOIN user_unit_roles uur ON uur.user_id = u.user_id
            WHERE uur.role_code IN ('student', 'lecturer')
              AND u.is_active AND u.archived_at IS NULL
         ORDER BY u.full_name"""
    )
    for row in rows:
        row["id"] = str(row["id"])
        row["role"] = "Member"
    return jsonify(rows)

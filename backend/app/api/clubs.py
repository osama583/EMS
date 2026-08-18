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
@bp.get("")
@require_auth
def list_clubs():
    """Every club, each annotated for the CALLER.

    The viewer flags are computed here rather than by shipping club_members and
    club_join_requests to the browser to join locally.
    """
    principal = current_principal()
    sql = """
        SELECT c.club_id AS id, c.club_name AS name, c.description, c.image_url AS "imageUrl",
               c.active, c.created_at AS "createdAt",
               p.user_id AS "presidentId", p.full_name AS "presidentName",
               (SELECT count(*) FROM club_members m WHERE m.club_id = c.club_id) AS "memberCount",
               EXISTS (SELECT 1 FROM club_members m
                        WHERE m.club_id = c.club_id AND m.user_id = %(viewer)s) AS "viewerIsMember",
               EXISTS (SELECT 1 FROM club_join_requests j
                        WHERE j.club_id = c.club_id AND j.requester_user_id = %(viewer)s
                          AND j.status = 'pending') AS "viewerHasPendingRequest",
               (c.user_id = %(viewer)s) AS "viewerIsPresident"
          FROM clubs c
     LEFT JOIN users p ON p.user_id = c.user_id
    """
    if flag("activeOnly"):
        sql += " WHERE c.active"
    rows = query(sql + " ORDER BY c.club_name", {"viewer": principal.user_id})
    for row in rows:
        row["categories"] = [
            r["name"]
            for r in query(
                """SELECT cc.name FROM club_category_links l
                     JOIN club_categories cc ON cc.club_category_id = l.club_category_id
                    WHERE l.club_id = %s ORDER BY cc.name""",
                (row["id"],),
            )
        ]
    return jsonify(rows)


@bp.get("/categories")
@require_auth
def list_categories():
    sql = "SELECT club_category_id AS id, name, active FROM club_categories WHERE archived_at IS NULL"
    if flag("activeOnly"):
        sql += " AND active"
    return jsonify(query(sql + " ORDER BY name"))


@bp.post("/categories")
@require_internal
def create_category():
    _assert_club_admin()
    payload = body()
    (name,) = required(payload, "name")
    with transaction() as cur:
        if fetch_one(cur, "SELECT 1 FROM club_categories WHERE lower(name) = lower(%s)", (name,)):
            raise Conflict("A category with that name already exists.")
        cur.execute(
            "INSERT INTO club_categories (name, active) VALUES (%s, TRUE) RETURNING club_category_id",
            (name,),
        )
        category_id = cur.fetchone()["club_category_id"]
    return jsonify({"id": category_id, "name": name}), 201


@bp.delete("/categories/<int:category_id>")
@require_internal
def delete_category(category_id: int):
    _assert_club_admin()
    with transaction() as cur:
        in_use = fetch_one(
            cur, "SELECT count(*) AS c FROM club_category_links WHERE club_category_id = %s",
            (category_id,),
        )["c"]
        if in_use:
            raise Conflict(f"{in_use} club(s) still use this category.")
        cur.execute(
            "UPDATE club_categories SET archived_at = now(), active = FALSE "
            "WHERE club_category_id = %s RETURNING club_category_id",
            (category_id,),
        )
        if cur.fetchone() is None:
            raise NotFound("Category not found.")
    return "", 204


@bp.get("/<int:club_id>")
@require_auth
def get_club(club_id: int):
    principal = current_principal()
    with transaction() as cur:
        row = fetch_one(
            cur,
            """SELECT c.club_id AS id, c.club_name AS name, c.description,
                      c.image_url AS "imageUrl", c.active, c.created_at AS "createdAt",
                      p.user_id AS "presidentId", p.full_name AS "presidentName",
                      p.email AS "presidentEmail"
                 FROM clubs c LEFT JOIN users p ON p.user_id = c.user_id
                WHERE c.club_id = %s""",
            (club_id,),
        )
        if row is None:
            raise NotFound("Club not found.")
        row["categories"] = [
            r["name"]
            for r in fetch_all(
                cur,
                """SELECT cc.name FROM club_category_links l
                     JOIN club_categories cc ON cc.club_category_id = l.club_category_id
                    WHERE l.club_id = %s""",
                (club_id,),
            )
        ]
        row["viewerIsPresident"] = row["presidentId"] == principal.user_id
        row["viewerIsMember"] = (
            fetch_one(
                cur, "SELECT 1 FROM club_members WHERE club_id = %s AND user_id = %s",
                (club_id, principal.user_id),
            )
            is not None
        )
    return jsonify(row)


@bp.post("")
@require_internal
def create_club():
    _assert_club_admin()
    principal = current_principal()
    payload = body()
    name, president_id = required(payload, "name", "presidentUserId")
    categories = payload.get("categories") or []
    if not MIN_CATEGORIES <= len(categories) <= MAX_CATEGORIES:
        raise BadRequest(f"A club needs between {MIN_CATEGORIES} and {MAX_CATEGORIES} categories.")

    with transaction() as cur:
        president = fetch_one(
            cur, "SELECT user_id FROM users WHERE user_id = %s AND archived_at IS NULL",
            (president_id,),
        )
        if president is None:
            raise NotFound("The nominated President does not exist.")
        cur.execute(
            """INSERT INTO clubs (user_id, club_name, description, image_url, created_by_user_id, active)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING club_id""",
            (
                president_id,
                name,
                payload.get("description"),
                payload.get("imageUrl"),
                principal.user_id,
                bool(payload.get("active", True)),
            ),
        )
        club_id = cur.fetchone()["club_id"]
        for category_id in categories:
            cur.execute(
                "INSERT INTO club_category_links (club_id, club_category_id) VALUES (%s, %s)",
                (club_id, category_id),
            )
        # The President is a member of their own club from the outset.
        cur.execute(
            "INSERT INTO club_members (club_id, user_id) VALUES (%s, %s) ON CONFLICT DO NOTHING",
            (club_id, president_id),
        )
        audit("clubs.created", club_id=club_id, actor_user_id=principal.user_id)
    return jsonify({"id": club_id, "name": name}), 201


@bp.patch("/<int:club_id>")
@require_internal
def update_club(club_id: int):
    """Club Admin edits anything; a President may edit their own club's blurb."""
    principal = current_principal()
    payload = body()
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
        # Renaming, deactivating and changing President are Club Admin powers.
        if is_admin:
            if "name" in payload:
                fields["club_name"] = payload["name"]
            if "active" in payload:
                fields["active"] = bool(payload["active"])
            if "presidentUserId" in payload:
                fields["user_id"] = payload["presidentUserId"]
        if fields:
            assignments = ", ".join(f"{c} = %s" for c in fields)
            cur.execute(
                f"UPDATE clubs SET {assignments} WHERE club_id = %s", [*fields.values(), club_id]
            )

        if "categories" in payload:
            if not is_admin:
                raise Forbidden("Only a Club Admin can change a club's categories.")
            categories = payload["categories"]
            if not MIN_CATEGORIES <= len(categories) <= MAX_CATEGORIES:
                raise BadRequest(
                    f"A club needs between {MIN_CATEGORIES} and {MAX_CATEGORIES} categories."
                )
            cur.execute("DELETE FROM club_category_links WHERE club_id = %s", (club_id,))
            for category_id in categories:
                cur.execute(
                    "INSERT INTO club_category_links (club_id, club_category_id) VALUES (%s, %s)",
                    (club_id, category_id),
                )
    return jsonify({"id": club_id})


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
    return jsonify(
        query(
            """SELECT u.user_id AS id, u.full_name AS name, u.email,
                      m.date_joined AS "dateJoined"
                 FROM club_members m JOIN users u ON u.user_id = m.user_id
                WHERE m.club_id = %s ORDER BY u.full_name""",
            (club_id,),
        )
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


@bp.get("/join-requests")
@require_internal
def list_join_requests():
    """?scope=mine (default) or ?scope=inbox for the clubs I preside over."""
    principal = current_principal()
    scope = request.args.get("scope", "mine")
    if scope == "inbox":
        sql = """
            SELECT j.club_join_request_id AS id, j.club_id AS "clubId", c.club_name AS "clubName",
                   u.user_id AS "requesterId", u.full_name AS "requesterName", u.email,
                   j.reason, j.status, j.created_at AS "createdAt"
              FROM club_join_requests j
              JOIN clubs c ON c.club_id = j.club_id
              JOIN users u ON u.user_id = j.requester_user_id
             WHERE c.user_id = %s AND j.status = 'pending'
          ORDER BY j.created_at
        """
    else:
        sql = """
            SELECT j.club_join_request_id AS id, j.club_id AS "clubId", c.club_name AS "clubName",
                   j.reason, j.status, j.comment, j.created_at AS "createdAt",
                   j.resolved_at AS "resolvedAt"
              FROM club_join_requests j
              JOIN clubs c ON c.club_id = j.club_id
             WHERE j.requester_user_id = %s
          ORDER BY j.created_at DESC
        """
    return jsonify(query(sql, (principal.user_id,)))


JOIN_DECISIONS = ("approve", "reject")


@bp.post("/join-requests/<int:join_request_id>/decision")
@require_internal
def decide_join_request(join_request_id: int):
    """Only the President of the club in question may decide.

    Approval adds the membership row in the same transaction as the status
    change, so an approved request can never leave someone un-joined.
    """
    principal = current_principal()
    payload = body()
    (decision,) = required(payload, "decision")
    if decision not in JOIN_DECISIONS:
        raise BadRequest("Decision must be approve or reject.")
    comment = str(payload.get("comment") or "").strip()
    if decision == "reject" and len(comment) < 20:
        raise BadRequest("A rejection needs an explanation of at least 20 characters.")

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
    return jsonify({"id": join_request_id, "status": decision})


@bp.get("/eligible-presidents")
@require_internal
def eligible_presidents():
    """Students and lecturers - the only roles that may preside over a club."""
    _assert_club_admin()
    return jsonify(
        query(
            """SELECT DISTINCT u.user_id AS id, u.full_name AS name, u.email
                 FROM users u JOIN user_unit_roles uur ON uur.user_id = u.user_id
                WHERE uur.role_code IN ('student', 'lecturer')
                  AND u.is_active AND u.archived_at IS NULL
             ORDER BY u.full_name"""
        )
    )

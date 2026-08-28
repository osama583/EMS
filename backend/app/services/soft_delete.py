"""The deletion gate: one dependency rule, one retention window, one purge sweep.

Every deletable record in the system follows the same three-step lifecycle, and
this module is the only place that decides which step applies:

    1. Dependency check   Count the incoming references to the row. Anything
                          still pointing at it blocks the delete outright - the
                          record is preserved untouched, and the caller gets the
                          reasons back to show the user.
    2. Soft delete        No dependents, so stamp ``archived_at`` (and clear the
                          entity's active flag). The row stays readable, stays
                          restorable, and disappears from every live listing.
    3. Hard purge         RETENTION_DAYS after the stamp, the sweep removes the
                          row for good - re-running the dependency check first,
                          because something may have come to reference it while
                          it sat in the bin.

The rule is deliberately strict: a record with dependents is never deleted, not
even softly. Deactivating it (the entity's own ``active``/``is_active`` flag)
stays available and is the correct answer for anything already in use - it stops
new usage without rewriting history that other rows still point at.

What "dependent" means here is HAS THIS RECORD EVER BEEN USED, not "is something
about it outstanding right now". Delete exists to undo a mistake: someone
created the wrong thing and wants it gone before it means anything to anyone
else. The moment it does mean something - a person joined, an application was
filed, a role was granted - it stops being a mistake to erase and becomes a
record other people are part of. So a settled dependency counts every bit as
much as a pending one: a club that rejected fifty applicants was unmistakably in
use, and deleting it would take fifty people's application history with it.
Anything past that point is deactivated, never deleted.

Registering an entity here is what makes it deletable. The DELETION_RULES table
below carries, per entity: its table and primary key, the column holding its
active flag, a label for messages, and the dependency queries that gate it. The
API blueprints call check_dependencies()/soft_delete()/purge_expired() rather
than writing their own count-then-archive logic, so a new dependency only has to
be declared once to be enforced by the endpoint, the preflight check, and the
sweep alike.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Iterator

from ..db import fetch_one, transaction

log = logging.getLogger(__name__)

# How long a soft-deleted row stays restorable before the sweep removes it.
# Shared by the API's "days remaining" projections and purge_expired() so the
# window a user is promised is by construction the window they actually get.
RETENTION_DAYS = 7


@dataclass(frozen=True)
class Dependency:
    """One incoming reference that blocks deletion while it returns rows.

    ``sql`` must be a COUNT query with exactly one ``%s`` placeholder for the
    parent key, and ``reason`` a message template taking that count - phrased
    for the person clicking Delete, naming what exists rather than the table it
    lives in ("3 member(s) are still in this club", not "club_members: 3").
    """

    sql: str
    reason: str

    def count(self, cur, key: Any) -> int:
        return fetch_one(cur, self.sql, (key,))["c"]


@dataclass(frozen=True)
class DeletionRule:
    """How one entity is checked, archived, restored and eventually purged."""

    table: str
    pk: str
    label: str
    # Column naming the row for messages ("club_name", "full_name", ...).
    name_column: str
    dependencies: tuple[Dependency, ...] = ()
    # The entity's own deactivate flag, cleared alongside archived_at so an
    # archived row can never read as live. None for tables that have none.
    active_column: str | None = None
    # Child rows that exist only to serve this parent and carry no independent
    # meaning (link tables, resolved requests). They never block the delete;
    # the purge removes them just before the parent, in the order given, so
    # foreign keys stay satisfied without relying on ON DELETE CASCADE.
    owned_children: tuple[tuple[str, str], ...] = ()


def _dep(sql: str, reason: str) -> Dependency:
    return Dependency(sql=sql, reason=reason)


def used_by(table: str, column: str, reason: str, *, where: str = "") -> Dependency:
    """"Has anything in ``table`` ever pointed at this row?" - the usual check.

    Deliberately counts every matching row regardless of status: a rejected
    application or a completed task is proof the record was used just as much as
    a pending one. Pass ``where`` only for rows that are genuinely not evidence
    of use (a draft nobody has submitted), never to filter out settled history.
    """
    sql = f"SELECT count(*) AS c FROM {table} WHERE {column} = %s"
    if where:
        sql += f" AND ({where})"
    return Dependency(sql=sql, reason=reason)


# --- The registry ---------------------------------------------------------
# Adding an entity here is what makes it deletable through the shared gate.
DELETION_RULES: dict[str, DeletionRule] = {
    "club": DeletionRule(
        table="clubs",
        pk="club_id",
        label="club",
        name_column="club_name",
        active_column="active",
        dependencies=(
            # Anyone but the president having joined means the club was used.
            _dep(
                "SELECT count(*) AS c FROM club_members m JOIN clubs c ON c.club_id = m.club_id "
                "WHERE m.club_id = %s AND m.user_id <> c.user_id",
                "{n} member(s) have joined this club",
            ),
            # Every application ever received, decided or not. A processed
            # application is the clearest evidence the club was in real use, and
            # it is history that belongs to the applicant as much as to the club
            # - deleting the club must never be what erases it.
            _dep(
                "SELECT count(*) AS c FROM club_join_requests WHERE club_id = %s",
                "{n} join request(s) have been received",
            ),
            _dep(
                "SELECT count(*) AS c FROM club_president_change_requests WHERE club_id = %s",
                "{n} president change request(s) have been submitted",
            ),
        ),
        # Only the two rows created by the act of creating the club itself: the
        # president's own membership, and the categories picked on the form.
        # Nothing here is evidence of use, so nothing here blocks the delete -
        # but the club is only ever purged once the checks above pass, so these
        # are removed from an untouched club and never from a used one.
        owned_children=(
            ("club_category_links", "club_id"),
            ("club_members", "club_id"),
        ),
    ),
    # --- Accounts ---------------------------------------------------------
    # An account that has done anything in the workflow is never deleted: the
    # proposals, approvals and assignments it left behind name it, and removing
    # it would blank a name out of somebody else's record. Only an account that
    # never acted - created by mistake, wrong address, duplicate - can go.
    "user": DeletionRule(
        table="users",
        pk="user_id",
        label="user",
        name_column="full_name",
        active_column="is_active",
        dependencies=(
            used_by("clubs", "user_id", "{n} club(s) have this user as president"),
            used_by("clubs", "created_by_user_id", "{n} club(s) were created by this user"),
            used_by("club_members", "user_id", "{n} club membership(s) belong to this user"),
            used_by("request", "applicant_user_id", "{n} proposal(s) were submitted by this user"),
            used_by("workflow_history", "actor_user_id", "{n} workflow action(s) were taken by this user"),
            used_by("task_assignment", "staff_user_id", "{n} task(s) are assigned to this user"),
            used_by("request_row_assignment", "staff_user_id", "{n} task row(s) are assigned to this user"),
            used_by("event_registration", "user_id", "{n} event registration(s) belong to this user"),
            used_by("club_join_requests", "requester_user_id", "{n} club application(s) were made by this user"),
            used_by("user_unit_roles", "user_id", "{n} role assignment(s) have been granted to this user"),
        ),
        # The profile rows created alongside the account itself.
        owned_children=(
            ("password_reset_token", "user_id"),
            ("external_user_profile", "user_id"),
            ("student", "user_id"),
            ("staff", "user_id"),
        ),
    ),
    # --- Organisation -----------------------------------------------------
    "unit": DeletionRule(
        table="unit",
        pk="code",
        label="unit",
        name_column="description",
        active_column="is_active",
        dependencies=(
            used_by("user_unit_roles", "unit_code", "{n} role assignment(s) reference this unit"),
            used_by("request_task", "assigned_unit_code", "{n} department task(s) have been routed here"),
            used_by("fmb_options", "unit_code", "{n} menu item(s) belong to this unit"),
            used_by("request_fmb_selection", "unit_code", "{n} catering selection(s) reference this unit"),
            used_by("nav_page_grant_units", "unit_code", "{n} page permission(s) reference this unit"),
            used_by("cafeteria_staff_audit_log", "cafeteria_code", "{n} staff record(s) reference this cafeteria"),
        ),
        owned_children=(("role_unit", "unit_code"),),
    ),
    "role": DeletionRule(
        table="role",
        pk="role_code",
        label="role",
        name_column="role_name",
        active_column="is_active",
        dependencies=(
            used_by("user_unit_roles", "role_code", "{n} user(s) have held this role"),
            used_by("nav_page_grant_roles", "role_code", "{n} page permission(s) reference this role"),
        ),
        owned_children=(("role_unit", "role_code"),),
    ),
    "nav_page": DeletionRule(
        table="nav_page",
        pk="page_code",
        label="page",
        name_column="label",
        active_column="is_active",
        dependencies=(
            used_by("nav_page", "parent_page_code", "{n} page(s) sit underneath this one"),
            used_by("nav_page_grants", "page_code", "{n} permission grant(s) reference this page"),
        ),
    ),
    # --- Club categories --------------------------------------------------
    "club_category": DeletionRule(
        table="club_categories",
        pk="club_category_id",
        label="category",
        name_column="name",
        active_column="active",
        dependencies=(
            used_by("club_category_links", "club_category_id", "{n} club(s) use this category"),
        ),
    ),
}


# --- Catalogues and options ----------------------------------------------
# Both are the same shape - an admin-managed lookup list that proposals point
# at - so their rules are generated rather than written out one by one, which
# also means a new catalogue cannot be added without a usage check.
#
# The FK is what matters here. Some of this code carried a comment claiming
# submitted proposals store an option's LABEL rather than its id, so deleting
# one could never affect history; the schema says otherwise (request_fmb,
# request_logistics, request_transportation and the rest all hold a real
# option_id), and those references are counted accordingly.
DELETION_RULES["event_category"] = DeletionRule(
    table="event_category", pk="event_category_id", label="event category", name_column="name",
    active_column="active",
    dependencies=(
        used_by("request_categories", "category_id", "{n} proposal(s) use this category"),
    ),
)
DELETION_RULES["event_format"] = DeletionRule(
    table="event_format", pk="event_format_id", label="event format", name_column="name",
    active_column="active",
    dependencies=(
        used_by("request", "event_format_id", "{n} proposal(s) use this format"),
    ),
)

# Request-option catalogues: {entity: (table, pk, [(child table, child column)])}.
_OPTION_RULES: dict[str, tuple[str, str, tuple[tuple[str, str], ...]]] = {
    "logistics": ("logistics_options", "logistics_option_id",
                  (("request_logistics", "option_id"),)),
    "transportation": ("transportation_options", "transportation_option_id",
                       (("request_transportation", "option_id"),)),
    "photoVideo": ("media_options", "media_option_id",
                   (("request_photography_videography", "option_id"),)),
    "soundLight": ("sound_light_options", "sound_light_option_id",
                   (("request_sound_light", "option_id"),)),
    "waterNormal": ("water_normal_options", "water_normal_option_id",
                    (("request_mineral_water", "option_id"),)),
    "campusTourStart": ("campus_tour_start_options", "campus_tour_start_option_id",
                        (("request_campus_tour", "start_point_option_id"),)),
    "campusTourType": ("campus_tour_type_options", "campus_tour_type_option_id",
                       (("request_campus_tour", "tour_type_option_id"),)),
    "fundingMain": ("funding_main_options", "funding_main_option_id",
                    (("request_funding_purchase", "main_option_id"),)),
    "fundingSub": ("funding_sub_options", "funding_sub_option_id",
                   (("request_funding_purchase", "sub_option_id"),)),
    "fmb": ("fmb_options", "fmb_option_id",
            (("request_fmb", "option_id"), ("request_fmb_selection", "fmb_option_id"))),
    # servingUnit and dietaryInformation are referenced only by other OPTIONS
    # (a menu item's serving unit, its dietary tags), never by a proposal
    # directly. options.py's _dependents already walks those option-to-option
    # references from the CATALOGUES registry, so declaring them here too would
    # report the same blocker twice.
    "servingUnit": ("serving_unit_options", "serving_unit_option_id", ()),
    "dietaryInformation": ("dietary_information_options", "dietary_information_option_id",
                           (("fmb_option_dietary_information", "dietary_information_option_id"),)),
}

_OPTION_REASONS = {
    "fmb_option_dietary_information": "{n} menu item(s) are tagged with this",
}

for _entity, (_table, _pk, _children) in _OPTION_RULES.items():
    DELETION_RULES[f"option:{_entity}"] = DeletionRule(
        table=_table,
        pk=_pk,
        label="option",
        name_column="label",
        active_column="active",
        dependencies=tuple(
            used_by(
                _child_table,
                _child_col,
                _OPTION_REASONS.get(_child_table, "{n} proposal(s) use this option"),
            )
            for _child_table, _child_col in _children
        ),
    )


def rule_for(entity: str) -> DeletionRule:
    try:
        return DELETION_RULES[entity]
    except KeyError:  # pragma: no cover - programming error, not user input
        raise ValueError(f"No deletion rule registered for {entity!r}") from None


# --- Rule 1: the dependency check ----------------------------------------
def check_dependencies(cur, entity: str, key: Any) -> list[str]:
    """Reasons this record cannot be deleted. Empty list means it is free.

    Runs against a live cursor so callers can gate inside the same transaction
    that performs the delete - the check and the write never straddle a window
    in which a new dependent could appear.
    """
    rule = rule_for(entity)
    blockers: list[str] = []
    for dependency in rule.dependencies:
        count = dependency.count(cur, key)
        if count:
            blockers.append(dependency.reason.format(n=count))
    return blockers


def preview(cur, entity: str, key: Any) -> dict[str, Any]:
    """The preflight response shown before a destructive click.

    Shape matches every existing deletion-check endpoint (canDelete /
    blockingReasons / entityLabel) so the shared confirm dialog renders it
    without special-casing.
    """
    rule = rule_for(entity)
    row = fetch_one(
        cur,
        f"SELECT {rule.name_column} AS label FROM {rule.table} WHERE {rule.pk} = %s",
        (key,),
    )
    if row is None:
        return {}
    blockers = check_dependencies(cur, entity, key)
    return {
        "canDelete": not blockers,
        "blockingReasons": blockers,
        "entityLabel": row["label"],
    }


# --- Rule 2: soft delete --------------------------------------------------
def soft_delete(cur, entity: str, key: Any) -> list[str]:
    """Archive the row if nothing depends on it. Returns the blockers instead.

    A non-empty return means nothing was written - the record is preserved
    exactly as it was, and the caller should surface the reasons rather than
    reporting a delete that did not happen.
    """
    rule = rule_for(entity)
    blockers = check_dependencies(cur, entity, key)
    if blockers:
        return blockers
    sets = ["archived_at = now()"]
    if rule.active_column:
        sets.append(f"{rule.active_column} = FALSE")
    cur.execute(
        f"UPDATE {rule.table} SET {', '.join(sets)} "
        f"WHERE {rule.pk} = %s AND archived_at IS NULL",
        (key,),
    )
    return []


def restore(cur, entity: str, key: Any) -> bool:
    """Bring an archived row back. Restores it deactivated, deliberately.

    The active flag is left FALSE so a club or account returning from the bin
    never silently becomes live again - someone re-enables it explicitly, after
    checking it should be.
    """
    rule = rule_for(entity)
    cur.execute(
        f"UPDATE {rule.table} SET archived_at = NULL "
        f"WHERE {rule.pk} = %s AND archived_at IS NOT NULL RETURNING {rule.pk}",
        (key,),
    )
    return cur.fetchone() is not None


# --- Rule 3: the permanent purge -----------------------------------------
def hard_delete(cur, entity: str, key: Any) -> list[str]:
    """Remove the row and its owned children for good, dependencies permitting.

    Re-checks dependencies rather than trusting the archive-time result: a row
    can sit in the bin for a week, and something may have come to reference it
    in the meantime.
    """
    rule = rule_for(entity)
    blockers = check_dependencies(cur, entity, key)
    if blockers:
        return blockers
    for table, column in rule.owned_children:
        cur.execute(f"DELETE FROM {table} WHERE {column} = %s", (key,))
    cur.execute(f"DELETE FROM {rule.table} WHERE {rule.pk} = %s", (key,))
    return []


def _expired(cur, rule: DeletionRule) -> list[Any]:
    cur.execute(
        f"SELECT {rule.pk} AS key FROM {rule.table} "
        f"WHERE archived_at IS NOT NULL "
        f"  AND archived_at < now() - make_interval(days => %s) "
        f"ORDER BY archived_at",
        (RETENTION_DAYS,),
    )
    return [row["key"] for row in cur.fetchall()]


def purge_expired(entities: Iterator[str] | None = None) -> dict[str, dict[str, int]]:
    """Permanently remove every record archived longer than RETENTION_DAYS.

    Each record is purged in its own transaction, so one blocked or failing row
    cannot abort the rest of the sweep. Rows that have picked up a dependency
    since being archived are skipped and left in the bin - they are reported as
    ``blocked`` rather than silently retained, because a row that can never be
    purged is a signal that something still needs it.
    """
    names = list(entities) if entities is not None else list(DELETION_RULES)
    summary: dict[str, dict[str, int]] = {}
    for entity in names:
        rule = rule_for(entity)
        with transaction() as cur:
            keys = _expired(cur, rule)
        purged = blocked = failed = 0
        for key in keys:
            try:
                with transaction() as cur:
                    blockers = hard_delete(cur, entity, key)
                if blockers:
                    blocked += 1
                    log.info(
                        "purge.skipped",
                        extra={"entity": entity, "key": key, "reason": blockers[0]},
                    )
                else:
                    purged += 1
                    log.info("purge.deleted", extra={"entity": entity, "key": key})
            except Exception:  # one bad row must not end the sweep
                failed += 1
                log.exception("purge.failed", extra={"entity": entity, "key": key})
        summary[entity] = {
            "eligible": len(keys),
            "purged": purged,
            "blocked": blocked,
            "failed": failed,
        }
    return summary

"""Permanently removes records soft-deleted longer than the retention window.

Run once a day. Everything it deletes has been sitting in the bin for at least
RETENTION_DAYS (7), so a same-day mistake is always recoverable and this job
never removes anything a user could still be expecting to restore.

    python -m scripts.purge_deleted             # purge every registered entity
    python -m scripts.purge_deleted --dry-run   # report what would go, delete nothing
    python -m scripts.purge_deleted --entity club

Dependencies are re-checked per row immediately before deletion, not trusted
from when the row was archived - a week is long enough for something to have
come to reference it. Rows that have picked one up are left in the bin and
reported as blocked rather than being force-deleted.

Each row is committed in its own transaction, so a failure part-way through
leaves every already-purged row purged and the rest still eligible for the next
run. Exit status is 0 when the sweep completes (blocked rows are a normal
outcome, not a failure) and 1 only if a row actually errored.

Scheduling:
    Windows Task Scheduler, daily:
        schtasks /create /tn "EMS purge deleted" /sc daily /st 03:00 ^
                 /tr "\"<path>\\python.exe\" -m scripts.purge_deleted" ^
                 /sd 01/01/2026
    cron, daily at 03:00:
        0 3 * * * cd /path/to/backend && python -m scripts.purge_deleted >> var/purge.log 2>&1
"""
from __future__ import annotations

import argparse
import pathlib
import sys

# Runnable directly (scripts/purge_deleted.py) as well as via -m, matching
# check_db.py, so the schedule entry does not depend on the caller's cwd.
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

import logging  # noqa: E402

from app.config import config  # noqa: E402
from app.db import init_pool, query, transaction  # noqa: E402
from app.logging_setup import configure_logging  # noqa: E402
from app.services.soft_delete import (  # noqa: E402
    ASSIGNMENT_ENTITY as _ASSIGNMENT_ENTITY,
    DELETION_RULES,
    RETENTION_DAYS,
    expired_assignments,
    purge_expired,
    purge_expired_assignments,
    rule_for,
)

log = logging.getLogger("scripts.purge_deleted")

# Cafeteria staff/manager postings (user_unit_roles) are soft-deletable
# (migration 023) but not registered in DELETION_RULES: the "has this ever
# been used" check is scoped to a specific unit_code (an order claimed AT
# THIS OUTLET), which app/services/soft_delete.py's generic used_by() helper
# does not express - so cafeterias.py keeps its own bespoke _assignment_blockers()
# instead. Swept here by the same name, alongside every registered entity.


def _pending(entity: str) -> list[dict]:
    """Rows past the window, for the dry run to report without touching them."""
    rule = rule_for(entity)
    return query(
        f"SELECT {rule.pk} AS key, {rule.name_column} AS label, archived_at "
        f"  FROM {rule.table} "
        f" WHERE archived_at IS NOT NULL "
        f"   AND archived_at < now() - make_interval(days => %s) "
        f" ORDER BY archived_at",
        (RETENTION_DAYS,),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="report what would be purged without deleting anything",
    )
    parser.add_argument(
        "--entity",
        action="append",
        choices=sorted(DELETION_RULES) + [_ASSIGNMENT_ENTITY],
        help="limit the sweep to one entity (repeatable); default is all",
    )
    args = parser.parse_args()

    configure_logging(config.log_level, config.log_format)
    try:
        config.validate()
    except RuntimeError as exc:
        print(f"CONFIG FAIL: {exc}")
        return 1
    init_pool()

    requested = args.entity or (sorted(DELETION_RULES) + [_ASSIGNMENT_ENTITY])
    entities = [e for e in requested if e != _ASSIGNMENT_ENTITY]
    include_assignments = _ASSIGNMENT_ENTITY in requested

    if args.dry_run:
        total = 0
        for entity in entities:
            rows = _pending(entity)
            total += len(rows)
            print(f"{entity}: {len(rows)} row(s) past the {RETENTION_DAYS}-day window")
            for row in rows:
                print(f"    #{row['key']} {row['label']}  archived {row['archived_at']:%Y-%m-%d}")
        if include_assignments:
            with transaction() as _cur:
                counts = {'eligible': len(expired_assignments(_cur))}
            total += counts["eligible"]
            print(f"{_ASSIGNMENT_ENTITY}: {counts['eligible']} row(s) past the {RETENTION_DAYS}-day window")
        print(f"\nDry run - nothing deleted. {total} row(s) would be considered.")
        return 0

    summary = purge_expired(iter(entities))
    if include_assignments:
        summary[_ASSIGNMENT_ENTITY] = purge_expired_assignments()

    failed = 0
    for entity, counts in summary.items():
        failed += counts["failed"]
        print(
            f"{entity}: {counts['purged']} purged, {counts['blocked']} blocked, "
            f"{counts['failed']} failed (of {counts['eligible']} eligible)"
        )
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())

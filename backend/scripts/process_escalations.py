"""Chase late approvals, retire what the event date has outrun.

    python -m scripts.process_escalations            # run
    python -m scripts.process_escalations --dry-run  # show, change nothing

Run once a day (cron / Windows Task Scheduler). This is the workflow's
time-driven half: everything in services/email/dispatch.py fires because a
person clicked something, while this fires because a date got closer and
nobody did.

    warning   event within APPROVAL_WARNING_DAYS, still undecided
              -> chase the approver every APPROVAL_WARNING_EMAIL_DAYS
    urgent    event within APPROVAL_URGENT_DAYS
              -> chase every APPROVAL_URGENT_EMAIL_DAYS, applicant copied
    overdue   the event date passed with no decision
              -> status becomes overdue_<stage>, applicant gets an apology
                 with F&B copied, and the proposal moves to History
    tasks     a department task past its own deadline is flagged is_overdue;
              once its event has finished it stops being actionable

ORDER WITHIN A RUN is warnings -> urgent -> overdue, so a proposal is never
told "decide today" and marked overdue by the same run.

SAFE TO RUN REPEATEDLY. Every chase is recorded in proposal_escalation_sent
with the stage it was sent for, and the cadence check reads that timestamp, so
a second run the same day sends nothing. A missed day is caught up on the next
run rather than lost.

--dry-run reads the same queries and reports what WOULD happen without sending,
marking or recording anything - the safe way to check a threshold change before
it reaches real mailboxes.
"""
from __future__ import annotations

import argparse
import datetime as dt
import logging
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.config import config  # noqa: E402
from app.db import init_pool, transaction  # noqa: E402
from app.logging_setup import configure_logging  # noqa: E402
from app.services.workflow import escalation  # noqa: E402
from app.services.workflow.constants import (  # noqa: E402
    approval_urgent_days,
    approval_urgent_email_days,
    approval_warning_days,
    approval_warning_email_days,
    task_grace_minutes,
)

log = logging.getLogger("scripts.escalations")


def _preview(cur) -> None:
    """Show what is in each band right now, without changing anything."""
    proposals = escalation.pending_proposals(cur)
    bands: dict[str, list] = {"urgent": [], "warning": [], "overdue": []}
    for proposal in proposals:
        if proposal["tier"] in bands:
            bands[proposal["tier"]].append(proposal)

    for label in ("overdue", "urgent", "warning"):
        rows = bands[label]
        print(f"\n{label.upper()}: {len(rows)}")
        for row in rows[:20]:
            days = row["days_until_event"]
            when = f"{days} days" if days >= 0 else f"{-days} days ago"
            print(f"   {row['request_code']:<12} {row['status']:<20} event {when}")
        if len(rows) > 20:
            print(f"   ... and {len(rows) - 20} more")

    tasks = escalation.overdue_open_tasks(cur)
    today = dt.date.today()
    still_open = [t for t in tasks if escalation.task_is_actionable(t["last_event_date"], today)]
    print(f"\nLATE TASKS: {len(tasks)} ({len(still_open)} still actionable)")
    for task in tasks[:20]:
        actionable = "can still be done" if task in still_open else "event finished"
        print(f"   {task['request_code']:<12} {task['department']:<26} {actionable}")
    if len(tasks) > 20:
        print(f"   ... and {len(tasks) - 20} more")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show what would happen, without sending, marking or recording anything",
    )
    args = parser.parse_args()

    configure_logging(config.log_level, config.log_format)
    config.validate()
    init_pool()

    with transaction() as cur:
        print(
            f"Escalations for {dt.date.today():%d %b %Y}\n"
            f"  warning at {approval_warning_days(cur)} days, "
            f"email every {approval_warning_email_days(cur)} day(s)\n"
            f"  urgent  at {approval_urgent_days(cur)} days, "
            f"email every {approval_urgent_email_days(cur)} day(s)\n"
            f"  task grace {task_grace_minutes(cur)} minute(s)"
        )

        if args.dry_run:
            # Read-only branch: _preview only SELECTs, so committing an empty
            # transaction is correct and nothing can leak out of a preview.
            _preview(cur)
            print("\nDRY RUN - nothing was sent, marked or recorded.")
            return

        counts = escalation.run(cur)

    print(
        "\nDone:"
        f"\n  warning emails      {counts['warning']}"
        f"\n  urgent emails       {counts['urgent']}"
        f"\n  proposals overdue   {counts['overdue']}"
        f"\n  tasks flagged late  {counts['tasks_flagged']}"
        f"\n  tasks closed        {counts['tasks_closed']}"
    )


if __name__ == "__main__":
    main()

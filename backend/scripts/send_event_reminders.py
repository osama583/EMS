"""Send the event reminders that are due today.

    python -m scripts.send_event_reminders            # send
    python -m scripts.send_event_reminders --dry-run  # show, send nothing

Run this once a day from cron - see "Scheduled jobs" in the backend README for
the crontab entry and the four things that make it work. It is the time-driven
half of the notification system: everything in services/email/dispatch.py fires
from a person clicking something, while these three fire because a date got
close or a counter moved, so nothing in a request cycle can ever trigger them.

  saved_capacity       a SAVED event is now >= SAVED_CAPACITY_PERCENT full and
                       the reader has not registered
  saved_starting       a SAVED event is within EVENT_REMINDER_LEAD_DAYS and the
                       reader still has not registered
  registered_starting  an event the reader IS registered for is within
                       EVENT_REMINDER_LEAD_DAYS

SAFE TO RUN REPEATEDLY. Every send is recorded in event_reminder_sent and every
query excludes what is already recorded, so a second run the same day sends
nothing. That also makes the schedule forgiving: a missed day is caught up on
the next run rather than lost, and a crash mid-run resumes cleanly.

--dry-run reads the same queries and prints what WOULD go out without sending or
recording anything, which is the safe way to check a threshold change before it
reaches real mailboxes.
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
from app.services.email import reminders  # noqa: E402

log = logging.getLogger("scripts.reminders")


def _preview(cur) -> int:
    """Print what is due without sending. Returns the total."""
    groups = [
        ("SAVED EVENT FILLING UP", reminders.due_capacity_reminders(cur)),
        ("SAVED EVENT STARTING SOON", reminders.due_saved_starting_reminders(cur)),
        ("REGISTERED EVENT STARTING SOON", reminders.due_registered_starting_reminders(cur)),
    ]
    total = 0
    for label, rows in groups:
        print(f"\n{label}: {len(rows)}")
        for row in rows[:20]:
            detail = ""
            if row.get("max_pax"):
                taken, cap = int(row["taken"] or 0), int(row["max_pax"])
                if cap:
                    detail = f"  [{taken}/{cap} = {round(taken * 100 / cap)}%]"
            print(f"   {row['email']:<40} {str(row['event_title'])[:42]}{detail}")
        if len(rows) > 20:
            print(f"   ... and {len(rows) - 20} more")
        total += len(rows)
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="show what would be sent, without sending or recording anything",
    )
    args = parser.parse_args()

    configure_logging(config.log_level, config.log_format)
    config.validate()
    init_pool()

    today = dt.date.today()
    with transaction() as cur:
        percent = reminders.capacity_percent(cur)
        days = reminders.lead_days(cur)
        print(
            f"Reminders for {today:%d %b %Y} "
            f"(capacity threshold {percent}%, lead time {days} day(s))"
        )

        if args.dry_run:
            # Read-only branch: _preview only SELECTs, so committing an empty
            # transaction is correct and nothing can leak out of a preview.
            total = _preview(cur)
            print(f"\nDRY RUN - {total} email(s) would be sent. Nothing was sent or recorded.")
            return

        sent = reminders.send_due_reminders(cur, today)

    print(
        "\nSent:"
        f"\n  saved event filling up        {sent[reminders.CAPACITY]}"
        f"\n  saved event starting soon     {sent[reminders.SAVED_STARTING]}"
        f"\n  registered event starting soon {sent[reminders.REGISTERED_STARTING]}"
        f"\n  total                          {sum(sent.values())}"
    )


if __name__ == "__main__":
    main()

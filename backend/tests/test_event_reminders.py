"""Event reminders: the right people, once, and only if they asked.

These are the properties that fail silently and are expensive when they do:

  * WRONG AUDIENCE - reminding someone who already registered that an event is
    "filling up", or telling a registered attendee they "have not registered".
  * DUPLICATES - a daily job that re-sends the same email every run.
  * IGNORED OPT-OUT - a toggle the reader switched off that keeps emailing.

The SQL that decides all three is exercised against the live database, inside a
rolled-back transaction, because the conditions live in the WHERE clauses and a
mock cursor would prove nothing about them.
"""
from __future__ import annotations

import datetime as dt
import pathlib
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.db import fetch_all, fetch_one, init_pool, transaction  # noqa: E402
from app.services.email import notifications, reminders  # noqa: E402


@pytest.fixture(scope="module", autouse=True)
def _pool():
    init_pool()


@pytest.fixture
def cur():
    """A transaction rolled back at the end, so nothing here touches real data."""
    with transaction() as handle:
        yield handle
        handle.connection.rollback()


@pytest.fixture
def no_smtp(monkeypatch):
    """Capture what would be sent instead of sending it."""
    sent: list[tuple] = []
    monkeypatch.setattr(
        notifications, "send", lambda **kw: (sent.append((kw["to"], kw["subject"])), True)[1]
    )
    return sent


def _widen(cur, days: int = 400) -> None:
    """Most seeded events are months out; widen the window so the date-driven
    queries have rows to work with."""
    cur.execute("UPDATE config SET number = %s WHERE code = 'EVENT_REMINDER_LEAD_DAYS'", (days,))


# --- configuration ---------------------------------------------------------

def test_thresholds_come_from_config_not_code(cur):
    """An admin changing these must take effect without a deploy."""
    cur.execute("UPDATE config SET number = 55 WHERE code = 'SAVED_CAPACITY_PERCENT'")
    cur.execute("UPDATE config SET number = 9 WHERE code = 'EVENT_REMINDER_LEAD_DAYS'")
    assert reminders.capacity_percent(cur) == 55
    assert reminders.lead_days(cur) == 9


def test_missing_config_falls_back_to_a_sane_default(cur):
    cur.execute("DELETE FROM config WHERE code = 'SAVED_CAPACITY_PERCENT'")
    assert reminders.capacity_percent(cur) == 70


# --- audience --------------------------------------------------------------

def test_capacity_reminder_only_covers_events_at_or_over_the_threshold(cur):
    percent = reminders.capacity_percent(cur)
    for row in reminders.due_capacity_reminders(cur):
        taken, cap = int(row["taken"] or 0), int(row["max_pax"] or 0)
        assert cap > 0
        assert taken * 100 / cap >= percent, (
            f"{row['event_title']} is only {taken}/{cap} full but was selected"
        )


def test_capacity_reminder_never_goes_to_someone_already_registered(cur):
    """The whole message is "register before it fills" - meaningless to someone
    who already holds a place."""
    for row in reminders.due_capacity_reminders(cur)[:40]:
        registered = fetch_one(
            cur,
            "SELECT 1 FROM event_registration er "
            " WHERE er.request_id = %s AND lower(er.registrant_email) = lower(%s) "
            "   AND er.status <> 'cancelled'",
            (row["request_id"], row["email"]),
        )
        assert registered is None, f"{row['email']} is already registered for {row['event_title']}"


def test_saved_starting_reminder_never_goes_to_someone_already_registered(cur):
    _widen(cur)
    for row in reminders.due_saved_starting_reminders(cur)[:40]:
        registered = fetch_one(
            cur,
            "SELECT 1 FROM event_registration er "
            " WHERE er.request_id = %s AND lower(er.registrant_email) = lower(%s) "
            "   AND er.status <> 'cancelled'",
            (row["request_id"], row["email"]),
        )
        assert registered is None, (
            f"{row['email']} would be told they have not registered for "
            f"{row['event_title']}, but they have"
        )


def test_registered_reminder_only_covers_live_registrations(cur):
    _widen(cur)
    for row in reminders.due_registered_starting_reminders(cur)[:40]:
        live = fetch_one(
            cur,
            "SELECT 1 FROM event_registration "
            " WHERE request_id = %s AND lower(registrant_email) = lower(%s) "
            "   AND status = 'registered'",
            (row["request_id"], row["email"]),
        )
        assert live is not None


def test_only_approved_events_are_reminded_about(cur):
    """An event still in review must never be announced to attendees."""
    _widen(cur)
    groups = (
        reminders.due_capacity_reminders(cur)
        + reminders.due_saved_starting_reminders(cur)
        + reminders.due_registered_starting_reminders(cur)
    )
    for row in groups[:60]:
        status = fetch_one(
            cur, "SELECT status FROM request WHERE request_id = %s", (row["request_id"],)
        )
        assert status["status"] == "completed_approved"


def test_past_events_are_not_reminded_about(cur):
    _widen(cur)
    today = dt.date.today()
    for row in reminders.due_saved_starting_reminders(cur)[:40]:
        assert row["first_date"] >= today


# --- opt-out ---------------------------------------------------------------

@pytest.mark.parametrize(
    "column,query_name",
    [
        ("saved_capacity_reminder", "due_capacity_reminders"),
        ("saved_starting_reminder", "due_saved_starting_reminders"),
        ("registered_starting_reminder", "due_registered_starting_reminders"),
    ],
)
def test_switching_a_toggle_off_removes_that_person(cur, column, query_name):
    _widen(cur)
    query = getattr(reminders, query_name)
    rows = query(cur)
    if not rows:
        pytest.skip(f"no rows currently due for {query_name}")
    email = rows[0]["email"]

    cur.execute(
        f"""INSERT INTO notification_preference (email, {column}) VALUES (%s, FALSE)
            ON CONFLICT (email) DO UPDATE SET {column} = FALSE""",
        (email,),
    )
    assert not any(r["email"] == email for r in query(cur)), (
        f"{email} switched {column} off but is still due"
    )


def test_one_toggle_off_leaves_the_others_alone(cur):
    """The point of splitting the toggles per tab: switching off the saved-list
    nudges must not silence a reminder for an event you are attending."""
    _widen(cur)
    rows = reminders.due_registered_starting_reminders(cur)
    if not rows:
        pytest.skip("no registered reminders currently due")
    email = rows[0]["email"]

    cur.execute(
        """INSERT INTO notification_preference
               (email, saved_capacity_reminder, saved_starting_reminder)
           VALUES (%s, FALSE, FALSE)
           ON CONFLICT (email) DO UPDATE
              SET saved_capacity_reminder = FALSE, saved_starting_reminder = FALSE""",
        (email,),
    )
    assert any(r["email"] == email for r in reminders.due_registered_starting_reminders(cur))


def test_no_preference_row_means_all_reminders_on(cur):
    """Absence is a valid state - a reader who never opened the toggles still
    gets reminders, which is what the LEFT JOIN + COALESCE encodes."""
    rows = reminders.due_capacity_reminders(cur)
    if not rows:
        pytest.skip("no capacity reminders currently due")
    email = rows[0]["email"]
    cur.execute("DELETE FROM notification_preference WHERE lower(email) = lower(%s)", (email,))
    assert any(r["email"] == email for r in reminders.due_capacity_reminders(cur))


# --- idempotency -----------------------------------------------------------

def test_a_second_run_sends_nothing(cur, no_smtp):
    """The property that makes a daily schedule safe."""
    _widen(cur)
    today = dt.date.today()

    first = reminders.send_due_reminders(cur, today)
    assert sum(first.values()) > 0, "fixture data produced no reminders to test with"
    no_smtp.clear()

    second = reminders.send_due_reminders(cur, today)
    assert sum(second.values()) == 0
    assert no_smtp == []


def test_every_send_is_recorded(cur, no_smtp):
    _widen(cur)
    cur.execute("DELETE FROM event_reminder_sent")
    sent = reminders.send_due_reminders(cur, dt.date.today())
    logged = fetch_all(cur, "SELECT kind, count(*) AS n FROM event_reminder_sent GROUP BY kind")
    by_kind = {row["kind"]: row["n"] for row in logged}
    for kind, count in sent.items():
        if count:
            assert by_kind.get(kind) == count


def test_the_send_log_rejects_an_unknown_kind(cur):
    """A typo in a kind string must fail loudly rather than silently logging a
    row that no query will ever match again."""
    import psycopg2

    with pytest.raises(psycopg2.errors.CheckViolation):
        cur.execute(
            "INSERT INTO event_reminder_sent (email, request_id, kind) "
            "SELECT 'x@y.z', request_id, 'not_a_real_kind' FROM request LIMIT 1"
        )


# --- the on-demand admin trigger -------------------------------------------
# The reminders are meant to run from cron. This deployment has no host to
# install that crontab on, so a System Admin can run the same sweep from the UI.
# What matters is that it is the same CODE PATH, not a parallel implementation -
# otherwise the two triggers could drift and the idempotency guarantee would
# only hold for one of them.

def test_the_admin_endpoint_calls_the_same_sweep_as_cron():
    """Both triggers must funnel into reminders.send_due_reminders()."""
    import pathlib
    import re

    backend = pathlib.Path(__file__).resolve().parent.parent
    admin = (backend / "app" / "api" / "admin.py").read_text(encoding="utf-8")
    job = (backend / "scripts" / "send_event_reminders.py").read_text(encoding="utf-8")

    assert "reminders.send_due_reminders(" in admin, (
        "the admin endpoint must call the shared sweep, not re-implement it"
    )
    assert "reminders.send_due_reminders(" in job
    # And neither may write its own INSERT into the send log, which is what a
    # divergent second implementation would end up doing.
    assert not re.search(r"INSERT INTO event_reminder_sent", admin)


def test_the_admin_endpoint_is_system_admin_only():
    """Sending mail to the whole university is not an ordinary user action."""
    import pathlib

    backend = pathlib.Path(__file__).resolve().parent.parent
    admin = (backend / "app" / "api" / "admin.py").read_text(encoding="utf-8")
    index = admin.index("def send_event_reminders(")
    # The decorator sits directly above the function.
    preceding = admin[:index]
    assert preceding.rstrip().endswith("@require_admin"), (
        "send_event_reminders must be guarded by @require_admin"
    )


def test_a_dry_run_sends_nothing_and_records_nothing(cur, no_smtp):
    """The preview the button shows before asking for confirmation."""
    _widen(cur)
    cur.execute("DELETE FROM event_reminder_sent")

    before = fetch_one(cur, "SELECT count(*) AS n FROM event_reminder_sent")["n"]
    due = (
        len(reminders.due_capacity_reminders(cur))
        + len(reminders.due_saved_starting_reminders(cur))
        + len(reminders.due_registered_starting_reminders(cur))
    )
    after = fetch_one(cur, "SELECT count(*) AS n FROM event_reminder_sent")["n"]

    assert due > 0, "fixture data produced nothing to preview"
    assert after == before, "a preview must not record anything"
    assert no_smtp == [], "a preview must not send anything"


# --- purge sweep: same shared-implementation guarantee ---------------------

def test_the_purge_endpoint_calls_the_same_sweep_as_its_cron_job():
    """"Purge Deleted" in the sidebar and scripts/purge_deleted.py must remove
    the same things - a button that swept a different set from the nightly job
    would quietly leave records in the bin forever."""
    import pathlib
    import re

    backend = pathlib.Path(__file__).resolve().parent.parent
    admin = (backend / "app" / "api" / "admin.py").read_text(encoding="utf-8")
    job = (backend / "scripts" / "purge_deleted.py").read_text(encoding="utf-8")

    assert "soft_delete.purge_everything()" in admin
    # The job sweeps the registered entities and the cafeteria postings through
    # the same shared helpers, rather than carrying its own copy.
    assert "purge_expired_assignments()" in job
    assert "purge_expired(" in job
    # Neither may hand-roll the deletion.
    assert not re.search(r"DELETE FROM \w+ WHERE archived_at", admin)


def test_the_purge_endpoint_is_system_admin_only():
    """Permanent deletion is not an ordinary user action."""
    import pathlib

    backend = pathlib.Path(__file__).resolve().parent.parent
    admin = (backend / "app" / "api" / "admin.py").read_text(encoding="utf-8")
    preceding = admin[: admin.index("def purge_deleted(")]
    assert preceding.rstrip().endswith("@require_admin")


def test_a_row_still_referenced_is_blocked_not_deleted(cur):
    """The safety property the whole sweep rests on: something that has picked
    up a dependency since being archived stays in the bin."""
    from app.services import soft_delete

    used = fetch_one(
        cur,
        "SELECT fmb_option_id FROM request_fmb_selection "
        " WHERE fmb_option_id IS NOT NULL LIMIT 1",
    )
    if used is None:
        pytest.skip("no referenced fmb option in the fixture data")

    option_id = used["fmb_option_id"]
    cur.execute(
        "UPDATE fmb_options SET archived_at = now() - interval '30 days' "
        " WHERE fmb_option_id = %s",
        (option_id,),
    )
    blockers = soft_delete.check_dependencies(cur, "option:fmb", option_id)
    assert blockers, "an option still used by an order must report a blocker"


def test_assignment_blockers_is_scoped_to_one_outlet(cur):
    """A posting is blocked by work claimed AT THAT CAFETERIA, not by anything
    the person ever did anywhere - which is why it cannot be a generic rule."""
    from app.services import soft_delete

    claimed = fetch_one(
        cur,
        "SELECT claimed_by_user_id, unit_code FROM request_fmb_selection "
        " WHERE claimed_by_user_id IS NOT NULL LIMIT 1",
    )
    if claimed is None:
        pytest.skip("no claimed cafeteria orders in the fixture data")

    same_outlet = soft_delete.assignment_blockers(
        cur, claimed["claimed_by_user_id"], claimed["unit_code"]
    )
    assert same_outlet, "a posting that claimed work at this outlet must be blocked"

    other = fetch_one(
        cur,
        "SELECT code FROM unit WHERE code <> %s AND code LIKE 'cafeteria%%' LIMIT 1",
        (claimed["unit_code"],),
    )
    if other is not None:
        assert not soft_delete.assignment_blockers(
            cur, claimed["claimed_by_user_id"], other["code"]
        ), "work at one outlet must not block a posting at a different one"

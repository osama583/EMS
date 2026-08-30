"""Every notification is reachable from a real trigger, and none of them can
break the action that fired it.

Two properties, both of which fail silently in production if broken:

  1. WIRING. A notification function nobody calls is a user who is never told
     something they needed to act on. This suite asserts, statically, that
     each one is reachable from a real API/workflow caller - so deleting a
     call site fails a test rather than quietly dropping an email.

  2. ISOLATION. Email is best-effort. A dead SMTP server, a department with no
     head, a deleted user - none of these may turn a successful approval into
     a 500. `dispatch._safe()` is what guarantees that, and it is tested here
     against the failure modes that actually happen.

No database and no SMTP server: the wiring half is pure source analysis, and
the isolation half drives `_safe` directly.
"""
from __future__ import annotations

import pathlib
import re
import sys
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.services.email import dispatch, notifications  # noqa: E402

BACKEND = pathlib.Path(__file__).resolve().parent.parent
APP = BACKEND / "app"
EMAIL_PKG = APP / "services" / "email"
# Scheduled jobs are real triggers too: the three reminder emails have no caller
# inside app/ at all, they are driven by scripts/send_event_reminders.py.
SCRIPTS = BACKEND / "scripts"

# Built once: the two flows that legitimately have no trigger yet. Each names
# the backend capability that has to exist first, so this list is a to-do
# rather than a permanent exemption.
KNOWN_UNWIRED = {
    "guest_registration_otp": "no OTP column / verification endpoint exists",
    "email_changed_notice": "no admin-driven email-change endpoint exists",
}


def _source(path: pathlib.Path) -> str:
    return path.read_text(encoding="utf-8")


def _notification_names() -> list[str]:
    return re.findall(r"^def (\w+)\(", _source(EMAIL_PKG / "notifications.py"), re.M)


def _dispatch_map() -> dict[str, set[str]]:
    """dispatch function -> the notifications it can send.

    Matches `notifications.X` WITHOUT requiring a following "(": dispatch
    passes them to _safe() as values, not calls.
    """
    src = _source(EMAIL_PKG / "dispatch.py")
    out: dict[str, set[str]] = {}
    for match in re.finditer(r"^def (\w+)\(.*?(?=^def |\Z)", src, re.M | re.S):
        out[match.group(1)] = set(re.findall(r"notifications\.(\w+)", match.group(0)))
    return out


def _caller_source() -> str:
    """Everything outside the email package - the real triggers.

    Includes scripts/, because a scheduled job is as real a trigger as an API
    request: the three reminder emails have no caller inside app/ at all.
    """
    files = [
        path
        for path in (*APP.rglob("*.py"), *SCRIPTS.rglob("*.py"))
        if "__pycache__" not in path.parts and "email" not in path.parts
    ]
    return "\n".join(_source(path) for path in files)


def _reachable() -> set[str]:
    """Every notification reachable from a real trigger.

    Three routes in, because the system has three kinds of trigger:
      * direct        - auth/account flows, where the plaintext password only
                        exists inside that one request
      * via dispatch  - workflow/registration/club actions
      * via reminders - the time- and capacity-driven job
                        (scripts/send_event_reminders.py)
    """
    blob = _caller_source()
    reached = set(re.findall(r"notifications\.(\w+)", blob))

    dispatch_map = _dispatch_map()
    for name in set(re.findall(r"dispatch\.(\w+)", blob)):
        reached |= dispatch_map.get(name, set())

    # reminders.py is itself inside the email package, so it is not in the
    # caller blob - but the job that calls it IS a real trigger, so anything it
    # sends counts as wired.
    reminders_src = _source(EMAIL_PKG / "reminders.py")
    if re.search(r"reminders\.\w+", blob):
        reached |= set(re.findall(r"notifications\.(\w+)", reminders_src))
    return reached


@pytest.mark.parametrize("name", _notification_names())
def test_every_notification_has_a_real_trigger(name):
    """Fails the moment a notification loses its last call site."""
    if name in KNOWN_UNWIRED:
        pytest.skip(f"{name}: {KNOWN_UNWIRED[name]}")
    assert name in _reachable(), (
        f"{name}() is never called from outside the email package - "
        "either wire it to the action that should send it, or add it to "
        "KNOWN_UNWIRED with the reason."
    )


def test_known_unwired_entries_still_exist():
    """Stops KNOWN_UNWIRED rotting into a list of deleted functions."""
    names = set(_notification_names())
    for name in KNOWN_UNWIRED:
        assert name in names, f"KNOWN_UNWIRED names {name}, which no longer exists"


def test_known_unwired_are_genuinely_unwired():
    """The converse: if one of these gets wired up, this test says so, so the
    exemption gets removed rather than hiding a now-live trigger."""
    reached = _reachable()
    for name in KNOWN_UNWIRED:
        assert name not in reached, (
            f"{name} is now wired up - remove it from KNOWN_UNWIRED."
        )


# --- isolation ------------------------------------------------------------

def test_safe_swallows_a_raising_notification():
    """The whole point: a broken email must not propagate into the caller's
    transaction."""
    def boom():
        raise RuntimeError("SMTP exploded")

    dispatch._safe("test", boom)  # must not raise


def test_safe_swallows_missing_data_errors():
    """The realistic failure: a department with no head, so the recipient
    lookup returns None and the notification call raises a TypeError/KeyError."""
    def missing_recipient():
        recipient = None
        return recipient["email"]

    dispatch._safe("test", missing_recipient)  # must not raise


def test_safe_passes_arguments_through():
    seen = {}

    def record(**kwargs):
        seen.update(kwargs)

    dispatch._safe("test", record, event_title="Robotics", to="a@b.c")
    assert seen == {"event_title": "Robotics", "to": "a@b.c"}


def test_dispatch_functions_tolerate_a_missing_request(monkeypatch):
    """Every dispatch entry point loads the request row first and returns
    quietly when it is gone (deleted mid-flight), rather than raising."""
    monkeypatch.setattr(dispatch, "_request", lambda cur, request_id: None)
    # None of these may raise, and none may attempt to send.
    dispatch.proposal_entered_stage(None, 1)
    dispatch.proposal_rejected(None, 1, "reason")
    dispatch.proposal_sent_back(None, 1, "comment")
    dispatch.proposal_fully_approved(None, 1)
    dispatch.department_tasks_created(None, 1)
    dispatch.registration_created(
        None, 1, registrant_name="A", registrant_email="a@b.c", pending=False
    )
    dispatch.registration_decided(
        None, 1, registrant_name="A", registrant_email="a@b.c", approved=True
    )


def test_registration_dispatch_ignores_a_blank_email():
    """A registrant with no email address must not reach the send path - and
    must not even cost a database round trip, which is why the blank-email
    guard runs before the request row is loaded. `cur=None` proves it: any
    query attempted here would raise on None."""
    dispatch.registration_created(
        None, 1, registrant_name="A", registrant_email="", pending=False
    )
    dispatch.registration_decided(
        None, 1, registrant_name="A", registrant_email="", approved=True
    )


def test_notifications_never_raise_without_smtp(monkeypatch):
    """client.send() returns False rather than raising when SMTP is absent,
    so a notification called directly is still safe."""
    monkeypatch.setattr(notifications, "send", lambda **kwargs: False)
    assert notifications.registration_confirmed(
        registrant_email="a@b.c",
        registrant_name="A",
        event_title="Robotics",
        schedule="1 Jan",
        venue="Hall",
        organiser="Org",
    ) is False


# --- the header logo ------------------------------------------------------
# It shipped pointing at an unfilled hosted-domain placeholder, so every email
# rendered a broken-image icon. These lock in the fix: the image travels inside
# the message, so it needs no public host and survives remote-image blocking.

def test_logo_asset_ships_with_the_backend():
    """The asset lives in the email package, not in the Angular app - the
    backend must be able to send mail without the frontend being deployed."""
    from app.services.email import client

    assert client._LOGO_PATH.exists(), (
        f"missing email logo asset at {client._LOGO_PATH}"
    )


def test_logo_is_embedded_not_linked():
    from app.services.email import client

    part = client._logo_part()
    assert part is not None
    # RFC 2392: the header is bracketed, the cid: URL in the HTML is not.
    assert part["Content-ID"] == f"<{client._LOGO_CID}>"
    assert part.get_payload(decode=True)[:8] == b"\x89PNG\r\n\x1a\n"


def test_template_references_the_logo_by_cid():
    """The template's cid and the client's constant must stay in step - if
    either is renamed alone, the image breaks again."""
    from app.services.email import client

    shell = (EMAIL_PKG / "templates" / "_shell.html").read_text(encoding="utf-8")
    assert f'src="cid:{client._LOGO_CID}"' in shell


def test_no_unresolvable_placeholder_urls_remain():
    """The original bug, stated directly: a template must not reference a host
    that does not exist."""
    for path in (EMAIL_PKG / "templates").glob("*.html"):
        # Only real URL attributes - an explanatory HTML comment may legitimately
        # mention a hostname while referencing nothing.
        urls = re.findall(r'(?:src|href)="([^"]*)"', _source(path))
        for url in urls:
            assert "YOUR-DOMAIN" not in url, f"{path.name}: unfilled placeholder host in {url}"
            assert "localhost" not in url, f"{path.name}: {url} is unreachable from an inbox"


def test_sent_message_carries_the_logo(monkeypatch):
    """End to end at the MIME level: multipart/related, the HTML references the
    cid, and the image part is actually present."""
    import email as email_lib
    import smtplib

    from app.services.email import client, render

    captured = {}

    class FakeSMTP:
        def __init__(self, *a, **k):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            pass

        def login(self, *a):
            pass

        def sendmail(self, sender, to, raw):
            captured["raw"] = raw

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    # config is a frozen dataclass, so it is replaced wholesale rather than
    # mutated field by field.
    monkeypatch.setattr(
        client,
        "config",
        SimpleNamespace(
            smtp_host="smtp.example.com",
            smtp_port=587,
            smtp_username="",
            smtp_password="",
            email_from="APU <no-reply@example.com>",
            email_cc=[],
        ),
    )

    html = render.render(
        subject="T", preheader="p", body_paragraphs=[render.paragraph("Hi.")]
    )
    assert client.send(to="a@b.c", subject="T", html=html) is True

    message = email_lib.message_from_string(captured["raw"])
    assert message.get_content_type() == "multipart/related"

    html_parts, image_parts = [], []
    for part in message.walk():
        if part.get_content_type() == "text/html":
            html_parts.append(part.get_payload(decode=True).decode("utf-8"))
        elif part.get_content_type() == "image/png":
            image_parts.append(part)

    assert html_parts and f'src="cid:{client._LOGO_CID}"' in html_parts[0]
    assert len(image_parts) == 1
    assert image_parts[0]["Content-ID"] == f"<{client._LOGO_CID}>"


def test_a_missing_logo_still_sends(monkeypatch):
    """A missing asset must degrade to the alt text, never block the email."""
    from pathlib import Path

    from app.services.email import client

    monkeypatch.setattr(client, "_LOGO_PATH", Path("does-not-exist.png"))
    assert client._logo_part() is None

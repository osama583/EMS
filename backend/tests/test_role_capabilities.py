"""_ROLE_CAPABILITIES must never claim a capability a role does not actually have.

This file exists because the hand-written role->capability list drifted from the real
nav_page_grants table and the assistant stated things that were simply false:
  - Staff was told it could "submit an event proposal"; staff holds no proposal-form grant.
  - Club Admin and Cafeteria Admin were both told they could "browse and register for events";
    neither holds explore-events.
  - Cafeteria Manager was told it "cannot submit an event proposal" while that account reaches
    my-requests/inbox/ongoing/history and discusses proposals throughout.

Those lines were unverifiable by construction (page_code=None meant "always show"). Every line now
carries a real page_code, and these tests assert the text and the grant table agree - so the next
person to add a capability cannot invent one, and a grant change that invalidates a line fails here
instead of reaching a user.

Runs against the real seeded database, like tests/test_workflow_e2e.py.
"""
from __future__ import annotations

import pytest

from app.ai.knowledge_base import _ROLE_CAPABILITIES, _ROLE_LABEL, self_capability_document
from app.db import query
from app.services import identity


def _representative_unit(role_code: str) -> str | None:
    """A unit this role can legally be paired with, or None for a flat role. A unit-scoped role
    checked with unit_code=None would fail every unit_role grant and wrongly look capability-less."""
    rows = query("SELECT unit_code FROM role_unit WHERE role_code = %s ORDER BY unit_code LIMIT 1", (role_code,))
    return rows[0]["unit_code"] if rows else None


@pytest.mark.parametrize("role_code", sorted(_ROLE_CAPABILITIES))
def test_every_capability_names_a_real_page(role_code: str):
    """A typo'd or deleted page_code silently drops the line (has_page_access fails closed), so the
    capability just disappears from answers with no error - caught here instead."""
    live_pages = {row["page_code"] for row in query("SELECT page_code FROM nav_page")}
    for capability, page_code in _ROLE_CAPABILITIES[role_code]:
        assert page_code, f"{role_code}: '{capability}' has no backing page_code"
        assert page_code in live_pages, f"{role_code}: '{capability}' names unknown page '{page_code}'"


@pytest.mark.parametrize("role_code", sorted(_ROLE_CAPABILITIES))
def test_role_actually_holds_every_page_it_claims(role_code: str):
    """The real check: does this role reach the page each of its capability lines is written
    against? A line the role cannot reach is a false claim - exactly the class of bug this file was
    written for."""
    assignments = ((role_code, _representative_unit(role_code)),)
    for capability, page_code in _ROLE_CAPABILITIES[role_code]:
        assert identity.has_page_access(assignments, page_code), (
            f"{_ROLE_LABEL[role_code]} claims '{capability}' but has no access to '{page_code}'. "
            f"Either the role lost that grant (remove the line) or the line names the wrong page."
        )


def test_no_role_claims_a_capability_it_cannot_reach():
    """End-to-end: the rendered document for each role must contain only reachable capabilities."""
    for role_code in sorted(_ROLE_CAPABILITIES):
        assignments = ((role_code, _representative_unit(role_code)),)
        document = self_capability_document(assignments)
        for capability, page_code in _ROLE_CAPABILITIES[role_code]:
            if not identity.has_page_access(assignments, page_code):
                assert capability not in document, (
                    f"{role_code}: '{capability}' appears in the answer despite no page access"
                )


def test_capabilities_are_dropped_when_the_page_is_revoked(monkeypatch):
    """Revoking a page in Page Visibility must remove its capability from the very next answer -
    the reason every line is page-backed rather than static text."""
    assignments = (("student", _representative_unit("student")),)
    before = self_capability_document(assignments)
    assert "submit an event proposal" in before

    real = identity.has_page_access
    monkeypatch.setattr(
        identity,
        "has_page_access",
        lambda a, page_code: False if page_code == "proposal-form" else real(a, page_code),
    )
    after = self_capability_document(assignments)
    assert "submit an event proposal" not in after
    # Unrelated capabilities survive - the revocation is scoped, not a blanket wipe.
    assert "browse and register for published events" in after


def test_no_negative_claims():
    """"cannot X" lines went stale the moment an admin granted X, and were the source of the wrong
    "you cannot submit an event proposal" answer. A missing capability is already implied by its
    absence, so negative phrasing is banned outright."""
    for role_code, capabilities in _ROLE_CAPABILITIES.items():
        for capability, _ in capabilities:
            lowered = capability.lower()
            assert "cannot" not in lowered and "can not" not in lowered, (
                f"{role_code}: '{capability}' states a negative; list only what the role CAN do"
            )

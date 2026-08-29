"""Which dashboard a caller gets, and what is on it.

A profile is **data, not code**: a dict naming widget ids that the Angular
component walks. Adding a Cafeteria Admin dashboard later is a new `PROFILES`
entry plus any new widgets, with no change to the component, the route, or the
response contract.

Resolution fails closed (rule R1). An actor holding none of the four dashboard
roles raises `NoDashboardProfile`, which the blueprint turns into the existing
`/app/no-access` payload rather than a blank page.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Callable

from ...db import fetch_all, fetch_one
from ...security.principal import Principal


class NoDashboardProfile(Exception):
    """The caller holds no role this design gives a dashboard to."""


@dataclass(frozen=True)
class ResolvedProfile:
    key: str
    role_code: str
    unit_code: str | None
    unit_label: str | None
    title: str
    eyebrow: str

    @property
    def id(self) -> str:
        """Stable identity for the switcher and the cache key. A head of two
        units has two entries and they must not collide."""
        return f"{self.key}:{self.unit_code}" if self.unit_code else self.key


# Ordered by authority tier. The first match is the
# default profile; the rest become entries in the header's profile switcher.
DASHBOARD_TIERS: tuple[tuple[str, Callable[[Principal], Any], ...], ...] = (
    ("cfo", lambda p: p.has_role("cfo")),
    ("head-of-department", lambda p: p.units_for_role("head-of-department")),
    ("cafeteria-manager", lambda p: p.units_for_role("cafeteria-manager")),
)

# A service HOD's profile resolves further, by unit, into one of six department
# dashboards. This is where the six diverge: not by authority - they have
# identical authority - but by resource model.
DEPARTMENT_PROFILE = {
    "a_v_services": "hod_av",
    "food_beverage_services": "hod_fmb",
    "logistics_and_facilities": "hod_logistics",
    "photography_services": "hod_photography",
    "student_services": "hod_student_services",
    "transport_services": "hod_transport",
}

# A service department a System Admin creates later has no known detail table and no capacity column,
# so it degrades to the flow/SLA/quality/people families rather than erroring.
GENERIC_DEPARTMENT_PROFILE = "hod_generic"

PROFILE_TITLES = {
    "hod_av": ("A/V Services", "Crew & rig operations"),
    "hod_fmb": ("F&B", "Cost, gate and outlet fan-out"),
    "hod_logistics": ("Logistics and Facilities", "Inventory & venue operations"),
    "hod_photography": ("Photography Services", "Shoot & delivery pipeline"),
    "hod_student_services": ("Student Services", "Guide demand & tour planning"),
    "hod_transport": ("Transport Services", "Fleet & driver operations"),
    "hod_generic": ("Department", "Service lane operations"),
    "cfo": ("Institutional finance", "Commitment, coverage & collection"),
    "cafeteria_manager": ("Cafeteria operations", "The shift"),
}


def _unit_labels(cur, codes: list[str]) -> dict[str, str]:
    if not codes:
        return {}
    rows = fetch_all(cur, "SELECT code, description FROM unit WHERE code = ANY(%s)", (codes,))
    return {row["code"]: row["description"] for row in rows}


def _profile_key(role_code: str, unit_code: str | None) -> str:
    if role_code == "cfo":
        return "cfo"
    if role_code == "cafeteria-manager":
        return "cafeteria_manager"
    return DEPARTMENT_PROFILE.get(unit_code or "", GENERIC_DEPARTMENT_PROFILE)


def resolve_dashboard_profiles(cur, principal: Principal, requested: str | None = None) -> list[ResolvedProfile]:
    """Every profile this actor may see. First is the default.

    A cafeteria manager holding two outlets gets **one** profile with an outlet
    switcher, not two profiles - their scope is the union of their outlets and
    the dashboard shows them grouped, never averaged. A head of two units gets
    two entries, because those are genuinely different lanes with different
    capacity models.
    """
    entries: list[tuple[str, str | None]] = []
    for role_code, matcher in DASHBOARD_TIERS:
        matched = matcher(principal)
        if not matched:
            continue
        if matched is True:
            entries.append((role_code, None))
            continue
        if role_code == "cafeteria-manager":
            # Sorted so the combined profile's identity is stable across
            # sessions even as outlets are added.
            entries.append((role_code, None))
            continue
        for unit in sorted(matched):
            entries.append((role_code, unit))

    if not entries:
        raise NoDashboardProfile()

    labels = _unit_labels(cur, [unit for _, unit in entries if unit])
    profiles = []
    for role_code, unit_code in entries:
        key = _profile_key(role_code, unit_code)
        title, eyebrow = PROFILE_TITLES.get(key, PROFILE_TITLES["hod_generic"])
        profiles.append(
            ResolvedProfile(
                key=key,
                role_code=role_code,
                unit_code=unit_code,
                unit_label=labels.get(unit_code or "") if unit_code else None,
                title=labels.get(unit_code or "", title) if unit_code else title,
                eyebrow=eyebrow,
            )
        )

    if requested:
        # A requested profile the caller does not hold is ignored, not rejected:
        # the parameter can only ever reorder a list they already own.
        profiles = [p for p in profiles if p.id == requested or p.key == requested] + [
            p for p in profiles if not (p.id == requested or p.key == requested)
        ]
    return profiles


# --- The layouts ----------------------------------------------------------
# Bands 1, 3, 4 and 5 share a skeleton across all ten roles. Band 2 - the signature panel - is the
# widest, tallest element on the page and is different for every one of them.

PROFILES: dict[str, dict[str, Any]] = {
    # ---------------------------------------------------------------- A/V -- No stock at all:
    # sound_light_options carries a technical_description and nothing else.
    "hod_av": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # -------------------------------------------------------- Logistics -- The one department whose
    # constraint is a day total rather than an hour: an item issued in the morning is not back by the
    # afternoon.
    "hod_logistics": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # -------------------------------------------------------- Transport -- Two ceilings, vehicles and
    # drivers.
    "hod_transport": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # ------------------------------------------------ Student Services --
    # The only department whose capacity requirement is computed rather than
    # observed: a day that looks like three tours can be eleven guides.
    "hod_student_services": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # ------------------------------------------------------ Photography -- The only department that
    # accumulates work *after* the event.
    "hod_photography": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # ------------------------------------------------------------- F&B -- A gatekeeper, a department
    # lane, and a supply orchestrator at once.
    "hod_fmb": {
        # Four bands, no hero.
        "counts": "fmb_request_counts",
        "hero": None,
        "kpis": [
            "fmb_total_cost",
            "fmb_cafeteria_cost",
            "fmb_cost_per_pax",
            "fmb_change_rate",
        ],
        "signature": "fmb_gate_outcomes",
        "panels": [
            "fmb_order_distribution",
            "fmb_water_usage",
        ],
        "alerts": None,
        "quickActions": [],
        "mobileKpis": ["fmb_total_cost", "fmb_cafeteria_cost", "fmb_change_rate"],
    },
    "hod_generic": {
        # No detail table is known for this unit (see maybe_spec()), so neither
        # dept_jobs_at_risk/dept_risk_list (needs a department spec to find a deadline column) nor
        # dept_catalogue_health (needs an option table) can run here - this profile keeps the
        # flow/quality fallback shape.
        "counts": "dept_request_counts",
        "hero": "gen_clearance_rate",
        "kpis": ["gen_open_backlog", "gen_first_pass_yield"],
        "signature": "gen_backlog_age",
        "panels": ["dept_staff_balance"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work"],
        "mobileKpis": ["gen_open_backlog", "gen_first_pass_yield"],
    },
    "cfo": {
        # Reduced to the money question and the gate behind it.
        "counts": "cfo_request_counts",
        "hero": None,
        "kpis": [
            "cfo_total_spend",
            # Directly under the total it is part of, so the relationship reads
            # as "of which" rather than as a second, competing figure.
            "cfo_cafeteria_cost",
            "cfo_cost_per_pax",
            "cfo_total_pax",
        ],
        "signature": None,
        # The funding pair leads: two halves of one question, and spanFor()
        # gives the first two panels half the row each, so the sub-item chart
        # lands beside the main chart that filters it.
        "panels": [
            "cfo_funding_main_usage",
            "cfo_funding_sub_usage",
            "cfo_gate_decisions",
        ],
        "alerts": None,
        "quickActions": [],
        "mobileKpis": ["cfo_total_spend", "cfo_cafeteria_cost", "cfo_cost_per_pax"],
    },
    "cafeteria_manager": {
        # Orders at Risk / Risk List does not apply here (see cafeteria.py's module docstring:
        # assignment happens right before prep starts, not on approval, so the "unstarted work due
        # soon" shape the HOD Risk List looks for is never a real signal for this role).
        "counts": "caf_request_counts",
        "hero": None,
        "kpis": ["caf_on_time", "caf_pushback_rate"],
        "signature": "caf_service_board",
        "panels": ["caf_staff_workload", "caf_menu_performance"],
        # No alerts rail.
        "alerts": None,
        "quickActions": [],
        "mobileKpis": ["caf_on_time", "caf_pushback_rate"],
    },
}


def layout_for(profile_key: str) -> dict[str, Any]:
    """The widget layout for a profile, falling back to the generic department shape."""
    return dict(PROFILES.get(profile_key) or PROFILES[GENERIC_DEPARTMENT_PROFILE])

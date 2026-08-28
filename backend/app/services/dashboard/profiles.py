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


# Ordered by authority tier (docs/dashboards/01 § 1). The first match is the
# default profile; the rest become entries in the header's profile switcher.
DASHBOARD_TIERS: tuple[tuple[str, Callable[[Principal], Any], ...], ...] = (
    ("cfo", lambda p: p.has_role("cfo")),
    ("head-of-school", lambda p: p.units_for_role("head-of-school")),
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

# A service department a System Admin creates later has no known detail table
# and no capacity column, so it degrades to the flow/SLA/quality/people families
# rather than erroring. Documented here so "what happens to a new unit" has an
# answer that is not "find out in production".
GENERIC_DEPARTMENT_PROFILE = "hod_generic"

PROFILE_TITLES = {
    "hod_av": ("A/V Services", "Crew & rig operations"),
    "hod_fmb": ("F&B", "Cost, gate and outlet fan-out"),
    "hod_logistics": ("Logistics and Facilities", "Inventory & venue operations"),
    "hod_photography": ("Photography Services", "Shoot & delivery pipeline"),
    "hod_student_services": ("Student Services", "Guide demand & tour planning"),
    "hod_transport": ("Transport Services", "Fleet & driver operations"),
    "hod_generic": ("Department", "Service lane operations"),
    "hos_school": ("School portfolio", "Proposal flow & outcomes"),
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
    if role_code == "head-of-school":
        return "hos_school"
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


# --- The school profile-score rule ----------------------------------------


def school_signature(cur, unit_code: str) -> str:
    """Pick a school's signature panel from its own data, not a hardcoded pair.

    Two scores over the trailing term:
      service-intensity    mean requirements per proposal, weighted toward the
                           three heaviest service lanes
      commercial-intensity share of proposals carrying a cost or a funding line,
                           weighted by external guest mix

    Whichever is higher chooses the dashboard. Evaluated at request time so it
    tracks the data: a third school added later gets a signature panel
    deterministically instead of by hand, and a school whose behaviour changes
    gets the dashboard that now fits it.
    """
    row = fetch_one(
        cur,
        """
        SELECT
            coalesce(avg(req.cnt), 0) AS mean_requirements,
            coalesce(avg(CASE WHEN req.heavy > 0 THEN 1 ELSE 0 END), 0) AS heavy_share,
            coalesce(avg(CASE WHEN r.cost_amount > 0 OR fund.n > 0 THEN 1 ELSE 0 END), 0) AS commercial_share,
            coalesce(avg(CASE WHEN guests.external > 0 THEN 1 ELSE 0 END), 0) AS external_share,
            count(*) AS proposals
          FROM request r
          JOIN user_unit_roles uur
            ON uur.user_id = r.applicant_user_id AND uur.unit_code = %(unit)s AND uur.is_active
          LEFT JOIN LATERAL (
                SELECT count(*) AS cnt,
                       count(*) FILTER (WHERE er.requirement_name IN ('soundLight', 'photoVideo', 'logistics')) AS heavy
                  FROM application_requirements ar
                  JOIN event_requirements er ON er.requirement_id = ar.requirement_id
                 WHERE ar.request_id = r.request_id
          ) req ON TRUE
          LEFT JOIN LATERAL (
                SELECT count(*) AS n FROM request_funding_purchase p WHERE p.request_id = r.request_id
          ) fund ON TRUE
          LEFT JOIN LATERAL (
                SELECT count(*) AS external FROM general_guest g
                 WHERE g.request_id = r.request_id
                   AND g.guest_type IN ('External Guests', 'Industry Partners', 'Alumni')
          ) guests ON TRUE
         WHERE r.submitted_at IS NOT NULL
           AND r.submitted_at >= now() - interval '120 days'
        """,
        {"unit": unit_code},
    )
    if not row or not int(row["proposals"] or 0):
        # No data yet. Default to the service view: on a system with no history,
        # the operational read is the more useful of the two, and it does not
        # depend on prices that have not been entered.
        return "service"
    service = float(row["mean_requirements"] or 0) / 8.0 + float(row["heavy_share"] or 0)
    commercial = float(row["commercial_share"] or 0) + float(row["external_share"] or 0) * 0.5
    return "commercial" if commercial > service else "service"


# --- The layouts ----------------------------------------------------------
# Bands 1, 3, 4 and 5 share a skeleton across all ten roles. Band 2 - the
# signature panel - is the widest, tallest element on the page and is different
# for every one of them. That is what makes these ten dashboards rather than one
# dashboard with ten titles.

PROFILES: dict[str, dict[str, Any]] = {
    # ---------------------------------------------------------------- A/V --
    # No stock at all: sound_light_options carries a technical_description and
    # nothing else. The only scarce resource is technician-hours against
    # overlapping event windows, so the signature panel is a collision timeline
    # rather than an inventory chart.
    "hod_av": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail. The Risk List and "At risk this
        # week" both restated the hero - the same rows, counted on the tile and
        # then listed twice below it - so the page now says it once. Both fields
        # are optional, the way "counts" already was.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # -------------------------------------------------------- Logistics --
    # The one department whose constraint is a day total rather than an hour:
    # an item issued in the morning is not back by the afternoon. Hence a
    # heatmap where A/V gets a timeline.
    "hod_logistics": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail. The Risk List and "At risk this
        # week" both restated the hero - the same rows, counted on the tile and
        # then listed twice below it - so the page now says it once. Both fields
        # are optional, the way "counts" already was.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # -------------------------------------------------------- Transport --
    # Two ceilings, vehicles and drivers. A single ratio is a lie here: reading
    # "1.5" without knowing whether it means no bus or no driver sends the head
    # to the wrong meeting, so the hero names which one binds.
    "hod_transport": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail. The Risk List and "At risk this
        # week" both restated the hero - the same rows, counted on the tile and
        # then listed twice below it - so the page now says it once. Both fields
        # are optional, the way "counts" already was.
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
        # No signature panel and no alerts rail. The Risk List and "At risk this
        # week" both restated the hero - the same rows, counted on the tile and
        # then listed twice below it - so the page now says it once. Both fields
        # are optional, the way "counts" already was.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # ------------------------------------------------------ Photography --
    # The only department that accumulates work *after* the event. Forward
    # panels show a shot as done; the deliverable has not shipped. Hence a
    # funnel, and a four-segment lane bar where everyone else has three.
    "hod_photography": {
        "counts": "dept_request_counts",
        "hero": "dept_jobs_at_risk",
        "kpis": ["dept_on_time_completion", "dept_pushback_rate"],
        # No signature panel and no alerts rail. The Risk List and "At risk this
        # week" both restated the hero - the same rows, counted on the tile and
        # then listed twice below it - so the page now says it once. Both fields
        # are optional, the way "counts" already was.
        "signature": None,
        "panels": ["dept_staff_balance", "dept_catalogue_health"],
        "alerts": None,
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["dept_on_time_completion", "dept_pushback_rate"],
    },
    # ------------------------------------------------------------- F&B --
    # A gatekeeper, a department lane, and a supply orchestrator at once. The
    # signature panel is the routing decision: which outlet should take the next
    # order, judged on measured behaviour rather than capacity on paper.
    "hod_fmb": {
        # Rebuilt to the shape F&B actually asked for. Every row reuses a
        # component the Cafeteria Manager profile already ships:
        #   counts  - the Inbox/Ongoing/Completed strip, with CANCELLED where
        #             that page has LATE (see fmb_request_counts on why).
        #   kpis    - the four money-and-rework tiles.
        #   panels  - the gate, then where the orders went, then water.
        # fmb_committed_cost and fmb_pushback_rate are gone: the new Total cost
        # and Cafeteria request change rate tiles are the same two metrics under
        # clearer labels, and keeping both would have been the duplicate logic
        # this rebuild was meant to avoid.
        "counts": "fmb_request_counts",
        "hero": "fmb_on_time_delivery",
        "kpis": [
            "fmb_total_cost",
            "fmb_cafeteria_cost",
            "fmb_cost_per_pax",
            "fmb_change_rate",
        ],
        "signature": "fmb_gate_outcomes",
        "panels": [
            # The two the spec asks for lead the row; the analysis panels that
            # were already here follow underneath, unchanged.
            "fmb_order_distribution",
            "fmb_water_usage",
            "fmb_cost_by_outlet",
            "fmb_fanout_board",
            "fmb_outlet_balance",
            "fmb_dietary_coverage",
            "fmb_order_lifecycle",
        ],
        "alerts": "fmb_at_risk",
        "quickActions": [],
        "mobileKpis": ["fmb_total_cost", "fmb_cafeteria_cost", "fmb_change_rate"],
    },
    "hod_generic": {
        # No detail table is known for this unit (see maybe_spec()), so neither
        # dept_jobs_at_risk/dept_risk_list (needs a department spec to find a
        # deadline column) nor dept_catalogue_health (needs an option table)
        # can run here - this profile keeps the flow/quality fallback shape.
        "counts": "dept_request_counts",
        "hero": "gen_clearance_rate",
        "kpis": ["gen_open_backlog", "gen_first_pass_yield"],
        "signature": "gen_backlog_age",
        "panels": ["dept_staff_balance"],
        "alerts": "gen_stalled",
        "quickActions": ["review_inbox", "assign_work"],
        "mobileKpis": ["gen_open_backlog", "gen_first_pass_yield"],
    },
    # ----------------------------------------------------------- School --
    # One profile, two shapes. The signature panel and three of the KPIs are
    # chosen by school_signature() from the school's own trailing-term data,
    # which is why a school that becomes commercial gets the commercial view
    # without anyone editing this file.
    "hos_school": {
        "hero": {"service": "hos_end_to_end", "commercial": "hos_cost_per_pax"},
        "kpis": {
            "service": [
                "hos_gate_latency",
                "hos_outcome_mix",
                "hos_service_footprint",
                "hos_stall_rate",
                "hos_forward_pipeline",
            ],
            "commercial": [
                "hos_cost_recovery",
                "hos_collection_rate",
                "hos_gate_latency",
                "hos_commercial_intensity",
                "hos_external_engagement",
            ],
        },
        "signature": {"service": "hos_dependency_map", "commercial": "hos_recovery_funnel"},
        "panels": {
            "service": [
                "hos_requirement_mix",
                "hos_stage_waterfall",
                "hos_applicant_activity",
                "hos_event_outcome",
                "hos_rework_profile",
                "hos_forward_commitment",
            ],
            "commercial": [
                "hos_cost_by_category",
                "hos_guest_mix",
                "hos_cost_per_pax_trend",
                "hos_stage_waterfall",
                "hos_applicant_activity",
                "hos_forward_financial",
            ],
        },
        "alerts": "hos_at_risk",
        "quickActions": ["review_gate", "school_history"],
        "mobileKpis": {
            "service": ["hos_gate_latency", "hos_stall_rate", "hos_end_to_end_kpi"],
            "commercial": ["hos_gate_latency", "hos_collection_rate", "hos_cost_per_pax_kpi"],
        },
    },
    # -------------------------------------------------------------- CFO --
    # Nearly blind outside their own gate under _VISIBLE_SQL: clause 5 fires
    # only at cfo_review, and cfo_review is only reached above HIGH_PAX_THRESHOLD.
    # Every panel here is an R7 aggregate, and the signature panel exists to
    # quantify exactly what the gate does not see.
    "cfo": {
        # Row 1 is the status strip, row 2 the three financial headline figures,
        # row 3 the two funding charts that read as a pair. The rest of the CFO
        # instrument follows underneath, unchanged.
        "counts": "cfo_request_counts",
        "hero": "cfo_forward_spend",
        "kpis": [
            "cfo_total_spend",
            # Directly under the total it is part of, so the relationship reads
            # as "of which" rather than as a second, competing figure.
            "cfo_cafeteria_cost",
            "cfo_cost_per_pax",
            "cfo_total_pax",
            "cfo_gate_coverage",
            "cfo_collection",
            "cfo_gate_queue",
            "cfo_price_coverage",
        ],
        "signature": "cfo_gate_matrix",
        # The funding pair leads: they are the two halves of one question and
        # spanFor() gives the first two panels half the row each, so they land
        # side by side with the sub-item chart to the right of the main one it
        # is filtered by.
        "panels": [
            "cfo_funding_main_usage",
            "cfo_funding_sub_usage",
            "cfo_spend_by_category",
            "cfo_runway",
            "cfo_cost_per_pax_schools",
            "cfo_revenue_funnel",
            "cfo_gate_decisions",
        ],
        "alerts": "cfo_at_risk",
        "quickActions": ["review_gate", "menu_oversight", "funding_catalogue"],
        # Row 2, in its desktop order. cfo_forward_spend_kpi used to sit here
        # restating the hero as a tile, which the hero card already does on
        # every screen size - it is gone rather than duplicated.
        "mobileKpis": ["cfo_total_spend", "cfo_cost_per_pax", "cfo_total_pax"],
    },
    # ------------------------------------------------- Cafeteria Manager --
    # A shift tool, not an analysis tool. The most-used of the ten and the only
    # one whose hero is a live count rather than a rate.
    "cafeteria_manager": {
        # Orders at Risk / Risk List does not apply here (see caf_orders_at_risk
        # and cafeteria.py's module docstring: assignment happens right before
        # prep starts, not on approval, so the "unstarted work due soon" shape
        # the HOD Risk List looks for is never a real signal for this role) -
        # caf_orders_at_risk stays this profile's own hero.
        "counts": "caf_request_counts",
        "hero": "caf_orders_at_risk",
        "kpis": ["caf_on_time", "caf_pushback_rate"],
        "signature": "caf_service_board",
        "panels": ["caf_staff_workload", "caf_menu_performance"],
        # No alerts rail. Everything caf_at_risk used to raise is already on
        # this page a band higher - the hero is the live at-risk count, and the
        # Late tile on the counts strip is the same queue - so the rail only
        # restated it further down.
        "alerts": None,
        "quickActions": [],
        "mobileKpis": ["caf_on_time", "caf_pushback_rate"],
    },
}


def layout_for(profile_key: str, variant: str | None = None) -> dict[str, Any]:
    """Flatten a profile entry, resolving the school's two-shape fields.

    Only `hos_school` carries variant-keyed values; every other profile's fields
    pass through unchanged, so a widget author never has to know which kind of
    entry they are reading.
    """
    layout = PROFILES.get(profile_key) or PROFILES[GENERIC_DEPARTMENT_PROFILE]
    resolved: dict[str, Any] = {}
    for field, value in layout.items():
        if isinstance(value, dict) and variant and variant in value:
            resolved[field] = value[variant]
        elif isinstance(value, dict) and set(value) == {"service", "commercial"}:
            resolved[field] = value["service"]
        else:
            resolved[field] = value
    return resolved

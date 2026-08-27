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
    "hod_fmb": ("Food & Beverage Services", "Order fan-out & delivery"),
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
        "hero": "av_crew_coverage",
        "kpis": [
            "av_rig_collisions",
            "dept_decision_latency",
            "dept_unassigned_work",
            "dept_send_back_rate",
            "dept_prep_runway",
        ],
        "signature": "av_collision_timeline",
        "panels": [
            "dept_lane_time",
            "av_hour_demand",
            "dept_staff_balance",
            "dept_catalogue_health",
            "dept_rework_profile",
        ],
        "alerts": "dept_at_risk",
        "insights": ["AI-02", "AI-03", "AI-05", "AI-08", "AI-11", "AI-14", "AI-19", "AI-22", "AI-27", "AI-31"],
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["av_rig_collisions", "dept_unassigned_work", "dept_decision_latency"],
    },
    # -------------------------------------------------------- Logistics --
    # The one department whose constraint is a day total rather than an hour:
    # an item issued in the morning is not back by the afternoon. Hence a
    # heatmap where A/V gets a timeline.
    "hod_logistics": {
        "hero": "log_peak_commitment",
        "kpis": [
            "log_items_over_capacity",
            "log_venue_conflicts",
            "dept_decision_latency",
            "dept_unassigned_work",
            "dept_off_catalogue",
        ],
        "signature": "log_inventory_heatmap",
        "panels": [
            "log_stock_runway",
            "dept_lane_time",
            "log_venue_turnaround",
            "dept_staff_balance",
            "dept_catalogue_health",
            "dept_forward_demand",
        ],
        "alerts": "dept_at_risk",
        "insights": ["AI-01", "AI-02", "AI-05", "AI-08", "AI-10", "AI-13", "AI-14", "AI-22", "AI-27", "AI-31"],
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["log_items_over_capacity", "log_venue_conflicts", "dept_unassigned_work"],
    },
    # -------------------------------------------------------- Transport --
    # Two ceilings, vehicles and drivers. A single ratio is a lie here: reading
    # "1.5" without knowing whether it means no bus or no driver sends the head
    # to the wrong meeting, so the hero names which one binds.
    "hod_transport": {
        "hero": "trn_binding_constraint",
        "kpis": [
            "trn_seat_fill",
            "trn_driver_bound_days",
            "trn_consolidation",
            "dept_decision_latency",
            "dept_unassigned_work",
        ],
        "signature": "trn_roster_board",
        "panels": [
            "trn_seat_fill_distribution",
            "trn_route_concentration",
            "trn_fleet_utilisation",
            "dept_staff_balance",
            "dept_lane_time",
            "trn_forward_demand",
        ],
        "alerts": "dept_at_risk",
        "insights": ["AI-02", "AI-05", "AI-07", "AI-11", "AI-13", "AI-19", "AI-22", "AI-27", "AI-30", "AI-31"],
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["trn_driver_bound_days", "dept_unassigned_work", "trn_seat_fill"],
    },
    # ------------------------------------------------ Student Services --
    # The only department whose capacity requirement is computed rather than
    # observed: a day that looks like three tours can be eleven guides.
    "hod_student_services": {
        "hero": "sts_guide_coverage",
        "kpis": [
            "sts_tours_needing_split",
            "sts_start_point_congestion",
            "dept_decision_latency",
            "dept_unassigned_work",
            "sts_uncapped_start_points",
        ],
        "signature": "sts_guide_demand",
        "panels": [
            "sts_start_point_heatmap",
            "sts_group_sizes",
            "sts_tour_type_mix",
            "dept_staff_balance",
            "dept_lane_time",
            "sts_forward_demand",
        ],
        "alerts": "dept_at_risk",
        "insights": ["AI-02", "AI-05", "AI-08", "AI-11", "AI-22", "AI-25", "AI-27", "AI-28", "AI-29", "AI-31"],
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["sts_tours_needing_split", "sts_start_point_congestion", "dept_unassigned_work"],
    },
    # ------------------------------------------------------ Photography --
    # The only department that accumulates work *after* the event. Forward
    # panels show a shot as done; the deliverable has not shipped. Hence a
    # funnel, and a four-segment lane bar where everyone else has three.
    "hod_photography": {
        "hero": "pho_delivery_backlog",
        "kpis": [
            "pho_coverage_gap",
            "pho_turnaround",
            "pho_double_booked",
            "dept_decision_latency",
            "pho_roster_resilience",
        ],
        "signature": "pho_pipeline",
        "panels": [
            "pho_shoot_calendar",
            "pho_turnaround_distribution",
            "pho_photographer_load",
            "dept_catalogue_health",
            "pho_lane_time",
            "dept_forward_demand",
        ],
        "alerts": "dept_at_risk",
        "insights": ["AI-05", "AI-11", "AI-14", "AI-16", "AI-18", "AI-19", "AI-21", "AI-22", "AI-24", "AI-31"],
        "quickActions": ["review_inbox", "assign_work", "catalogue"],
        "mobileKpis": ["pho_coverage_gap", "pho_delivery_backlog_kpi", "pho_double_booked"],
    },
    # ------------------------------------------------------------- F&B --
    # A gatekeeper, a department lane, and a supply orchestrator at once. The
    # signature panel is the routing decision: which outlet should take the next
    # order, judged on measured behaviour rather than capacity on paper.
    "hod_fmb": {
        "hero": "fmb_on_time_delivery",
        "kpis": [
            "fmb_orders_at_risk",
            "fmb_gate_queue",
            "fmb_pushback_rate",
            "fmb_committed_cost",
            "fmb_water_runway",
        ],
        "signature": "fmb_fanout_board",
        "panels": [
            "fmb_gate_outcomes",
            "fmb_outlet_balance",
            "fmb_cost_by_outlet",
            "fmb_water_meter",
            "fmb_dietary_coverage",
            "fmb_order_lifecycle",
        ],
        "alerts": "fmb_at_risk",
        "insights": ["AI-04", "AI-06", "AI-09", "AI-12", "AI-15", "AI-17", "AI-20", "AI-23", "AI-26", "AI-31"],
        "quickActions": ["review_inbox", "review_gate", "menu_oversight"],
        "mobileKpis": ["fmb_orders_at_risk", "fmb_gate_queue", "fmb_pushback_rate"],
    },
    # -------------------------------------------------------- Generic --
    # A service unit created after this design shipped. Flow, SLA, quality and
    # people only: no detail table is known for it, so nothing that depends on
    # one is offered.
    "hod_generic": {
        "hero": "gen_clearance_rate",
        "kpis": ["dept_decision_latency", "gen_open_backlog", "dept_send_back_rate", "gen_first_pass_yield"],
        "signature": "gen_backlog_age",
        "panels": ["dept_lane_time", "gen_throughput", "dept_staff_balance", "dept_rework_profile"],
        "alerts": "gen_stalled",
        "insights": ["AI-05", "AI-27", "AI-31"],
        "quickActions": ["review_inbox", "assign_work"],
        "mobileKpis": ["gen_open_backlog", "dept_decision_latency", "dept_send_back_rate"],
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
        "insights": {
            "service": ["AI-05", "AI-11", "AI-16", "AI-20", "AI-26", "AI-31", "AI-32", "AI-33", "AI-34"],
            "commercial": ["AI-04", "AI-16", "AI-20", "AI-23", "AI-26", "AI-31", "AI-33", "AI-35", "AI-36", "AI-37"],
        },
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
        "hero": "cfo_forward_spend",
        "kpis": [
            "cfo_gate_coverage",
            "cfo_cost_per_pax",
            "cfo_collection",
            "cfo_gate_queue",
            "cfo_price_coverage",
        ],
        "signature": "cfo_gate_matrix",
        "panels": [
            "cfo_spend_by_category",
            "cfo_runway",
            "cfo_cost_per_pax_schools",
            "cfo_revenue_funnel",
            "cfo_gate_decisions",
            "cfo_finance_catalogue",
        ],
        "alerts": "cfo_at_risk",
        "insights": ["AI-04", "AI-20", "AI-22", "AI-23", "AI-31", "AI-33", "AI-36", "AI-38", "AI-39", "AI-40"],
        "quickActions": ["review_gate", "menu_oversight", "funding_catalogue"],
        "mobileKpis": ["cfo_gate_queue", "cfo_collection", "cfo_forward_spend_kpi"],
    },
    # ------------------------------------------------- Cafeteria Manager --
    # A shift tool, not an analysis tool. The most-used of the ten and the only
    # one whose hero is a live count rather than a rate.
    "cafeteria_manager": {
        "hero": "caf_orders_at_risk",
        "kpis": [
            "caf_claim_latency",
            "caf_on_time",
            "caf_menu_readiness",
            "caf_staff_availability",
            "caf_pushback_rate",
        ],
        "signature": "caf_service_board",
        "panels": [
            "caf_claim_distribution",
            "caf_order_lifecycle",
            "caf_menu_performance",
            "caf_dietary_coverage",
            "caf_staffing_timeline",
            "caf_forward_demand",
        ],
        "alerts": "caf_at_risk",
        "insights": ["AI-06", "AI-15", "AI-17", "AI-22", "AI-23", "AI-41", "AI-42", "AI-43", "AI-44", "AI-45"],
        "quickActions": ["cafeteria_orders", "my_staff", "menu"],
        "mobileKpis": ["caf_claim_latency", "caf_staff_availability", "caf_on_time"],
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

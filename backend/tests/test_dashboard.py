"""Dashboard tests that need no database.

The existing suite runs against a live Postgres. These do not, deliberately:
the properties they check - every widget survives an empty result set, every
bound parameter is supplied, no profile names a widget that does not exist -
are the ones that break silently in a deploy where the database happens to be
fine. They are also the ones a developer needs to be able to run without one.

`FakeCursor` stands in for psycopg2 and returns nothing, which is the
**day-one** case: the seed carries no proposals, so an empty database is the
first thing every one of these queries meets. It also validates that every
`%(name)s` placeholder in the SQL has a matching key in the params dict, which
psycopg2 would otherwise only report at runtime, one widget at a time.
"""
from __future__ import annotations

import datetime as dt
import pathlib
import re
import sys

import pytest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.security.principal import Principal  # noqa: E402
from app.services.dashboard import QUICK_ACTIONS, _quick_actions, build_document  # noqa: E402
from app.services.dashboard.metrics.common import DEPARTMENT_SPEC  # noqa: E402
from app.services.dashboard.profiles import (  # noqa: E402
    DEPARTMENT_PROFILE,
    PROFILES,
    NoDashboardProfile,
    layout_for,
    resolve_dashboard_profiles,
)
from app.services.dashboard.scope import (  # noqa: E402
    DashboardConfig,
    Scope,
    apply_bucket_floor,
    delta,
    fold_tail,
    ratio,
    resolve_period,
    status_for,
    strip_identity,
)
from app.services.dashboard.widgets import WIDGET_REGISTRY  # noqa: E402
from app.services.dashboard.widgets.base import build as build_widget  # noqa: E402

_PLACEHOLDER = re.compile(r"%\((\w+)\)s")

TODAY = dt.date(2026, 8, 27)


class FakeCursor:
    """A cursor that answers every query with nothing, and checks the binding.

    Recording `seen` lets a test assert which tables a widget touched, which is
    how the scope-leak test below stays honest as widgets accumulate.
    """

    def __init__(self, rows_for=None):
        self.rows_for = rows_for or {}
        self.seen: list[tuple[str, dict]] = []
        self._rows: list[dict] = []

    def execute(self, sql, params=None):
        params = params or {}
        if isinstance(params, dict):
            missing = {name for name in _PLACEHOLDER.findall(sql)} - set(params)
            if missing:
                raise AssertionError(f"Unbound parameter(s) {sorted(missing)} in:\n{sql}")
        self.seen.append((sql, params if isinstance(params, dict) else {}))
        self._rows = []
        for fragment, rows in self.rows_for.items():
            if fragment in sql:
                self._rows = rows
                break

    def fetchall(self):
        return list(self._rows)

    def fetchone(self):
        return self._rows[0] if self._rows else None


def make_principal(assignments, user_id=1, email="head@demo.apu.edu.my") -> Principal:
    return Principal(
        user_id=user_id,
        full_name="Test Head",
        email=email,
        is_active=True,
        assignments=tuple(assignments),
    )


def make_scope(profile_key: str, unit_code: str | None, outlets=()) -> Scope:
    return Scope(
        principal=make_principal([("head-of-department", unit_code)] if unit_code else []),
        profile_key=profile_key,
        role_code="head-of-department",
        unit_code=unit_code,
        unit_label=unit_code,
        outlets=tuple(outlets),
        outlet_labels={code: code for code in outlets},
        period=resolve_period("30d", today=TODAY),
        config=DashboardConfig([]),
        today=TODAY,
    )


SCOPE_FOR_PROFILE = {
    "hod_av": ("a_v_services", ()),
    "hod_logistics": ("logistics_and_facilities", ()),
    "hod_transport": ("transport_services", ()),
    "hod_student_services": ("student_services", ()),
    "hod_photography": ("photography_services", ()),
    "hod_fmb": ("food_beverage_services", ()),
    "hod_generic": ("some_new_department", ()),
    "hos_school": ("school_of_computing", ()),
    "cfo": (None, ()),
    "cafeteria_manager": (None, ("cafeteria__atrium_cafeteria",)),
}


def _layouts():
    for key in PROFILES:
        variants = ("service", "commercial") if key == "hos_school" else (None,)
        for variant in variants:
            yield key, variant, layout_for(key, variant)


# --- Layout integrity -----------------------------------------------------


def test_every_profile_names_registered_widgets():
    """The declarative-layout guarantee. A profile is data; if it can name a
    widget that does not exist, the data is not trustworthy."""
    for key, variant, layout in _layouts():
        ids = [
            *([layout["hero"]] if layout.get("hero") else []),
            *([layout["signature"]] if layout.get("signature") else []),
            *([layout["alerts"]] if layout.get("alerts") else []),
            *layout["kpis"],
            *layout["panels"],
            *layout.get("mobileKpis", []),
        ]
        for widget_id in ids:
            assert widget_id in WIDGET_REGISTRY, f"{key}/{variant} names unknown widget {widget_id}"


def test_every_profile_names_registered_quick_actions():
    for key, variant, layout in _layouts():
        for action in layout["quickActions"]:
            assert action in QUICK_ACTIONS, f"{key}/{variant} names unknown action {action}"


def test_no_two_profiles_share_a_signature_panel():
    """The whole premise of ten dashboards rather than one with ten titles: band
    two is the role's own instrument.

    dept_risk_list is a deliberate exception: the HOD simplification unifies
    every service department (A/V, Logistics, Transport, Student Services,
    Photography) on the same plain "jobs at risk" signature panel, on purpose
    - a head reading a different department's dashboard should see the same
    shape, not a bespoke instrument per lane. CFO, School, F&B and Cafeteria
    are untouched by that simplification and still keep their own.
    """
    _SHARED_BY_DESIGN = {"gen_backlog_age"}
    signatures = {}
    for key, variant, layout in _layouts():
        name = f"{key}:{variant}" if variant else key
        signature = layout.get("signature")
        # A profile may carry no signature panel at all - the five department
        # profiles dropped theirs rather than restating their own hero.
        if signature is None or signature in _SHARED_BY_DESIGN:
            continue
        assert signature not in signatures, (
            f"{name} shares its signature panel {signature} with {signatures[signature]}"
        )
        signatures[signature] = name


def test_every_department_profile_has_a_spec():
    for unit_code, profile_key in DEPARTMENT_PROFILE.items():
        assert profile_key in PROFILES
        assert unit_code in DEPARTMENT_SPEC


def test_mobile_kpi_order_is_three_tiles():
    """Three tiles is what a phone shows above the fold after the hero. More is
    a scroll; fewer wastes the row.

    Only applies to a profile that actually carries a KPI row at all - the
    simplified HOD profiles (hero + Request Counts + Risk List + two panels,
    no KPI tiles) have nothing for mobileKpis to reorder, so an empty list
    there is the correct answer, not a shortfall.
    """
    for key, variant, layout in _layouts():
        kpi_count = len(layout.get("kpis") or [])
        if kpi_count == 0:
            assert not layout.get("mobileKpis"), f"{key}/{variant} lists mobileKpis but has no kpis"
            continue
        expected = min(3, kpi_count)
        order = layout.get("mobileKpis", [])
        assert len(order) == expected, f"{key}/{variant} lists {len(order)} mobile KPIs, expected {expected}"


# --- Empty database -------------------------------------------------------


@pytest.mark.parametrize("widget_id", sorted(WIDGET_REGISTRY))
def test_widget_survives_an_empty_database(widget_id):
    """Every widget renders on an empty database rather than erroring.

    The seed carries no proposals, so empty is the day-one case: NULLIF guards
    and None-safe arithmetic belong in the first draft rather than the bugfix.
    A widget that cannot answer returns an empty state, never `state: error`.
    """
    profile_key = _profile_for_widget(widget_id)
    unit_code, outlets = SCOPE_FOR_PROFILE[profile_key]
    scope = make_scope(profile_key, unit_code, outlets)
    result = build_widget(widget_id, FakeCursor(), scope)
    assert result["state"] != "error", f"{widget_id} errored on an empty database"
    assert result["kind"] in ("hero", "kpi", "panel", "counts")
    if result["kind"] == "panel":
        assert result["tableView"] is not None, f"{widget_id} ships no table view"


def _profile_for_widget(widget_id: str) -> str:
    for key, variant, layout in _layouts():
        ids = {
            *([layout["hero"]] if layout.get("hero") else []),
            *([layout["signature"]] if layout.get("signature") else []),
            *([layout["alerts"]] if layout.get("alerts") else []),
            *layout["kpis"],
            *layout["panels"],
            *layout.get("mobileKpis", []),
        }
        if layout.get("counts"):
            ids.add(layout["counts"])
        if widget_id in ids:
            return key
    raise AssertionError(f"{widget_id} is registered but no profile uses it")


def test_every_registered_widget_is_used_by_a_profile():
    """A widget nobody renders is a query nobody has looked at the output of."""
    for widget_id in WIDGET_REGISTRY:
        _profile_for_widget(widget_id)




# --- Profile resolution ---------------------------------------------------


def test_role_less_account_has_no_dashboard():
    """`farah.izzati@staff.apu.edu.my` exists and has never been onboarded. R1:
    fail closed, never a blank dashboard."""
    with pytest.raises(NoDashboardProfile):
        resolve_dashboard_profiles(FakeCursor(), make_principal([]))


def test_tier_order_puts_cfo_first():
    principal = make_principal([("cfo", None), ("head-of-department", "a_v_services")])
    profiles = resolve_dashboard_profiles(FakeCursor(), principal)
    assert profiles[0].key == "cfo"
    assert {p.key for p in profiles} == {"cfo", "hod_av"}


def test_requested_profile_reorders_but_cannot_widen():
    principal = make_principal([("cfo", None), ("head-of-department", "a_v_services")])
    profiles = resolve_dashboard_profiles(FakeCursor(), principal, requested="hod_av")
    assert profiles[0].key == "hod_av"
    # Asking for a profile the caller does not hold changes nothing.
    profiles = resolve_dashboard_profiles(FakeCursor(), principal, requested="cafeteria_manager")
    assert {p.key for p in profiles} == {"cfo", "hod_av"}


def test_head_of_two_units_gets_two_profiles():
    principal = make_principal(
        [("head-of-department", "a_v_services"), ("head-of-department", "transport_services")]
    )
    profiles = resolve_dashboard_profiles(FakeCursor(), principal)
    assert [p.key for p in profiles] == ["hod_av", "hod_transport"]


def test_manager_of_two_outlets_gets_one_profile():
    """One dashboard with an outlet switcher, grouped never averaged - not two
    dashboards, and never another manager's outlet."""
    principal = make_principal(
        [("cafeteria-manager", "cafeteria__atrium_cafeteria"), ("cafeteria-manager", "cafeteria__level_3_food_court")]
    )
    profiles = resolve_dashboard_profiles(FakeCursor(), principal)
    assert len(profiles) == 1
    assert profiles[0].key == "cafeteria_manager"


def test_unknown_service_unit_falls_back_to_generic():
    principal = make_principal([("head-of-department", "a_new_department")])
    profiles = resolve_dashboard_profiles(FakeCursor(), principal)
    assert profiles[0].key == "hod_generic"


# --- Scope ----------------------------------------------------------------


def test_period_keys_resolve_and_unknown_falls_back():
    assert resolve_period("7d", today=TODAY).start == dt.date(2026, 8, 21)
    assert resolve_period("90d", today=TODAY).days == 90
    assert resolve_period("ytd", today=TODAY).start == dt.date(2026, 1, 1)
    # Sep-Dec intake has not started on 27 August, so "term" is the May intake.
    assert resolve_period("term", today=TODAY).start == dt.date(2026, 5, 1)
    assert resolve_period("nonsense", today=TODAY).key == "30d"
    assert resolve_period(None, today=TODAY).key == "30d"


def test_period_comparison_window_is_the_same_length_and_adjacent():
    period = resolve_period("30d", today=TODAY)
    assert period.previous_end == period.start
    assert (period.start - period.previous_start).days == period.days


def test_unit_scope_never_comes_from_a_parameter():
    """R4. The `unit` query parameter is not read at all - a department head
    passing another unit's code gets their own data, not a 403."""
    import inspect

    from app.api import dashboard as api

    source = inspect.getsource(api)
    assert 'request.args.get("unit"' not in source
    assert "args.get('unit'" not in source


def test_outlet_scope_is_validated_against_the_callers_assignments():
    """R5. An outlet the caller does not manage falls back to their own set."""
    from app.services.dashboard import _build_scope
    from app.services.dashboard.profiles import ResolvedProfile

    principal = make_principal([("cafeteria-manager", "cafeteria__atrium_cafeteria")])
    profile = ResolvedProfile(
        key="cafeteria_manager",
        role_code="cafeteria-manager",
        unit_code=None,
        unit_label=None,
        title="Cafeteria",
        eyebrow="",
    )
    scope = _build_scope(FakeCursor(), principal, profile, "30d", "cafeteria__someone_elses", today=TODAY)
    assert scope.outlets == ("cafeteria__atrium_cafeteria",)


def test_config_prefers_a_per_unit_override():
    config = DashboardConfig(
        [{"code": "SLA_DECISION_HOURS", "number": 48}, {"code": "SLA_DECISION_HOURS__a_v_services", "number": 12}]
    )
    assert config.decision_sla_hours("a_v_services") == 12
    assert config.decision_sla_hours("transport_services") == 48
    # A missing code degrades to the documented default rather than raising.
    assert DashboardConfig([]).decision_sla_hours("a_v_services") == 48


# --- R7 / R8 --------------------------------------------------------------


def test_strip_identity_removes_every_row_identifier():
    rows = [{"request_id": 4, "applicant_name": "A", "n": 12, "median": 3.2}]
    assert strip_identity(rows) == [{"n": 12, "median": 3.2}]


def test_bucket_floor_suppresses_rather_than_dropping():
    """A bucket that vanishes misstates the chart; a reader cannot tell "none"
    from "too few to report"."""
    scope = make_scope("cfo", None)
    rows = [{"label": "A", "n": 12, "value": 4.0}, {"label": "B", "n": 2, "value": 9.0}]
    out = apply_bucket_floor(scope, rows, count_key="n", value_keys=("value",))
    assert len(out) == 2
    assert out[0]["value"] == 4.0 and out[0]["suppressed"] is False
    assert out[1]["value"] is None and out[1]["n"] is None and out[1]["suppressed"] is True
    assert scope.suppressed_buckets == 1


def test_fold_tail_caps_categorical_series_at_three():
    """Past three series the all-pairs colour floor fails - slot 4 puts yellow
    beside orange. Folding on the server is what makes the ceiling enforceable."""
    scope = make_scope("hod_transport", "transport_services")
    rows = [{"label": chr(65 + i), "value": 10 - i} for i in range(6)]
    folded = fold_tail(scope, rows, limit=3)
    assert len(folded) == 4
    assert folded[-1]["label"] == "Other"
    assert folded[-1]["value"] == 7 + 6 + 5
    assert scope.folded_series == 3


def test_fold_tail_leaves_short_lists_alone():
    scope = make_scope("hod_transport", "transport_services")
    rows = [{"label": "A", "value": 1}, {"label": "B", "value": 2}]
    assert fold_tail(scope, rows, limit=3) == rows
    assert scope.folded_series == 0


# --- Numeric helpers ------------------------------------------------------


def test_ratio_is_none_not_zero_on_an_empty_denominator():
    """A rate over no observations is undefined. Rendering it as 0% reads as
    failure when it means absence."""
    assert ratio(3, 0) is None
    assert ratio(3, None) is None
    assert ratio(None, 4) is None
    assert ratio(1, 4) == 0.25


def test_delta_separates_direction_from_goodness():
    """Latency falling is 'down' and good; coverage falling is 'down' and bad. A
    client inferring one from the other gets half of them wrong."""
    faster = delta(30, 40, higher_is_better=False)
    assert faster["direction"] == "down" and faster["isGood"] is True
    thinner = delta(0.3, 0.4, higher_is_better=True)
    assert thinner["direction"] == "down" and thinner["isGood"] is False
    assert delta(5, None, higher_is_better=True) is None


def test_status_thresholds_derive_server_side():
    assert status_for(0.5, warn=0.85, critical=1.0) == "good"
    assert status_for(0.9, warn=0.85, critical=1.0) == "warning"
    assert status_for(1.4, warn=0.85, critical=1.0) == "critical"
    assert status_for(0.95, minimum=0.9, critical=0.5, higher_is_better=True) == "good"
    assert status_for(0.7, minimum=0.9, critical=0.5, higher_is_better=True) == "warning"
    assert status_for(0.2, minimum=0.9, critical=0.5, higher_is_better=True) == "critical"
    assert status_for(None, warn=1) == "unknown"


# --- Panel contract -------------------------------------------------------


def test_panels_declare_a_single_y_axis():
    """No dual-axis. Two measures of different scale are two panels or one
    indexed series; the contract makes the alternative unrepresentable."""
    for widget_id in WIDGET_REGISTRY:
        profile_key = _profile_for_widget(widget_id)
        unit_code, outlets = SCOPE_FOR_PROFILE[profile_key]
        result = build_widget(widget_id, FakeCursor(), make_scope(profile_key, unit_code, outlets))
        if result["kind"] != "panel":
            continue
        axes = result.get("axes") or {}
        assert "y2" not in axes, f"{widget_id} declares a second y-axis"


def test_every_panel_names_what_would_populate_it_when_empty():
    """Never "No data" alone. A reader who cannot tell an empty period from a
    broken query will assume the second."""
    for widget_id in WIDGET_REGISTRY:
        profile_key = _profile_for_widget(widget_id)
        unit_code, outlets = SCOPE_FOR_PROFILE[profile_key]
        result = build_widget(widget_id, FakeCursor(), make_scope(profile_key, unit_code, outlets))
        if result["kind"] != "panel":
            continue
        assert result.get("empty"), f"{widget_id} has no empty-state sentence"
        assert result["empty"].strip().lower() not in ("no data", "no data."), widget_id


def test_colour_slots_are_integers_not_hexes():
    """The server assigns identity from the entity key; the client maps slot to
    colour. Filtering a series out cannot repaint the survivors."""
    for widget_id in WIDGET_REGISTRY:
        profile_key = _profile_for_widget(widget_id)
        unit_code, outlets = SCOPE_FOR_PROFILE[profile_key]
        result = build_widget(widget_id, FakeCursor(), make_scope(profile_key, unit_code, outlets))
        for entry in result.get("series") or []:
            assert isinstance(entry["colorSlot"], int), f"{widget_id} sent a non-integer colour slot"
            assert 1 <= entry["colorSlot"] <= 8, f"{widget_id} used slot {entry['colorSlot']}"


# --- Populated data -------------------------------------------------------
# The empty-database tests above and these are not redundant: empty data
# catches a missing NULLIF, populated data catches a panel that divides by a
# count it assumed was non-zero, a fold that drops the wrong series, or a chart
# that only renders once it has three points. Neither finds the other's bugs.


def _preview():
    from scripts import dashboard_preview

    return dashboard_preview


@pytest.mark.parametrize(
    "profile_key,variant",
    [
        (key, variant)
        for key in sorted(_preview().PROFILE_SETUP)
        for variant in (("service", "commercial") if key == "hos_school" else (None,))
    ],
)
def test_profile_builds_with_populated_data(profile_key, variant):
    document = _preview().build_preview(profile_key, variant=variant)
    widgets = [
        *([document["hero"]] if document["hero"] else []),
        *document["kpis"],
        *([document["signature"]] if document["signature"] else []),
        *document["panels"],
        *([document["alerts"]] if document["alerts"] else []),
    ]
    broken = [w["id"] for w in widgets if w.get("state") == "error"]
    assert not broken, f"{profile_key}/{variant}: {broken} errored on populated data"
    for widget in widgets:
        if widget["kind"] == "panel":
            assert widget["tableView"] is not None, f"{widget['id']} ships no table view"


@pytest.mark.parametrize("profile_key", sorted(_preview().PROFILE_SETUP))
def test_document_is_json_serialisable(profile_key):
    """psycopg2 hands back Decimal, date and time; Flask's provider handles the
    last two and refuses the first. Every metric passes through num() for
    exactly this reason, and this is what proves it stayed true."""
    import json

    document = _preview().build_preview(profile_key)
    json.dumps(document)  # No `default=`: anything needing one is a leak.


def test_generic_profile_survives_a_unit_with_no_detail_table():
    """A service department a System Admin creates later has no known detail
    table. It degrades to the flow/SLA/quality/people families rather than
    erroring - which is the whole reason hod_generic exists."""
    document = _preview().build_preview("hod_generic")
    widgets = [document["hero"], *document["kpis"], *([document["signature"]] if document["signature"] else []), *document["panels"]]
    assert all(w.get("state") != "error" for w in widgets)
    # Its drills land on an unfiltered list rather than one filtered by a
    # requirement the unit does not have.
    backlog = next(w for w in document["kpis"] if w["id"] == "gen_open_backlog")
    assert "requestKind" not in backlog["drill"]["params"]

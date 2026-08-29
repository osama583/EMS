"""Shared SQL vocabulary for the metric families.

The six service departments run the same lane with different nouns: a task
arrives, a head decides, staff are assigned to rows in a detail table, the work
happens on a date. `DEPARTMENT_SPEC` is that difference expressed as data, so
Family A/B/C/G queries can be written once and parameterised by unit instead of
copied six times with a table name changed - which is how six copies drift into
disagreeing about what "decision latency" means.

Only the *table and column names* live here. Every value that reaches SQL as
data still goes through psycopg2 binding; the identifiers below are chosen from
this dict by unit code and never come from a request.
"""
from __future__ import annotations

from typing import Any

# Proposal statuses whose rows are not a live commitment. A cancelled or
# rejected proposal's equipment booking is not holding anything, and counting it
# in a capacity forecast would manufacture a shortage that does not exist.
NON_COMMITTED_STATUSES = ("cancelled", "completed_rejected", "draft")

# Matches TASK_TERMINAL in services/workflow/constants.py.
OPEN_TASK_SQL = "t.status NOT IN ('completed', 'cancelled')"

# event_requirements carries a machine name and nothing else, so the human label is mapped here rather
# than joined.
REQUIREMENT_LABELS = {
    "logistics": "Logistics",
    "transportation": "Transportation",
    "photoVideo": "Photography / Videography",
    "soundLight": "Sound & Light",
    "campusTour": "Campus Tour",
    "fmb": "Food & Beverage",
    "waterNormal": "Mineral Water",
    "fundingPurchase": "Funding / Purchase",
}


def requirement_label(name: str | None) -> str:
    return REQUIREMENT_LABELS.get(name or "", name or "Unspecified")


class DepartmentSpec:
    """One service department's shape: which requirement it serves, which detail
    table holds its rows, and which columns on that table mean what."""

    def __init__(
        self,
        *,
        unit_code: str,
        label: str,
        requirement: str,
        table: str,
        pk: str,
        label_column: str,
        option_table: str | None = None,
        option_pk: str | None = None,
        option_fk: str = "option_id",
        start_column: str | None = None,
        end_column: str | None = None,
        location_column: str | None = None,
        quantity_column: str | None = None,
        capacity_column: str | None = None,
        catalogue_route: str | None = None,
    ):
        self.unit_code = unit_code
        self.label = label
        self.requirement = requirement
        self.table = table
        self.pk = pk
        self.label_column = label_column
        self.option_table = option_table
        self.option_pk = option_pk
        # Every detail table names its catalogue FK `option_id` except campus tours, which carry two
        # (start point and tour type) and so had to name them.
        self.option_fk = option_fk
        self.start_column = start_column
        self.end_column = end_column
        self.location_column = location_column
        self.quantity_column = quantity_column
        self.capacity_column = capacity_column
        self.catalogue_route = catalogue_route

    @property
    def has_window(self) -> bool:
        """True where a row occupies an interval rather than an instant.

        Transport rows carry a single `moving_time` and campus tours dropped
        their times entirely, so service-hour demand (M34) and hour-level
        collision detection (M31) are undefined for those two - they use
        headcount and group-split arithmetic instead. This flag is what keeps a
        widget from silently computing zero hours for them.
        """
        return bool(self.start_column and self.end_column)


DEPARTMENT_SPEC: dict[str, DepartmentSpec] = {
    "a_v_services": DepartmentSpec(
        unit_code="a_v_services",
        label="A/V Services",
        requirement="soundLight",
        table="request_sound_light",
        pk="request_sound_light_id",
        label_column="item",
        option_table="sound_light_options",
        option_pk="sound_light_option_id",
        start_column="start_time",
        end_column="end_time",
        location_column="location",
        catalogue_route="/app/dropdown-options/soundLight",
    ),
    "logistics_and_facilities": DepartmentSpec(
        unit_code="logistics_and_facilities",
        label="Logistics and Facilities",
        requirement="logistics",
        table="request_logistics",
        pk="request_logistics_id",
        label_column="item",
        option_table="logistics_options",
        option_pk="logistics_option_id",
        start_column="start_time",
        end_column="end_time",
        location_column="location",
        quantity_column="quantity",
        capacity_column="available_quantity",
        catalogue_route="/app/dropdown-options/logistics",
    ),
    "transport_services": DepartmentSpec(
        unit_code="transport_services",
        label="Transport Services",
        requirement="transportation",
        table="request_transportation",
        pk="request_transportation_id",
        label_column="type",
        option_table="transportation_options",
        option_pk="transportation_option_id",
        start_column="moving_time",
        location_column="pickup",
        quantity_column=None,
        capacity_column="available_vehicle_count",
        catalogue_route="/app/dropdown-options/transportation",
    ),
    "photography_services": DepartmentSpec(
        unit_code="photography_services",
        label="Photography Services",
        requirement="photoVideo",
        table="request_photography_videography",
        pk="request_photography_videography_id",
        label_column="service",
        option_table="media_options",
        option_pk="media_option_id",
        start_column="start_time",
        end_column="end_time",
        location_column="location",
        catalogue_route="/app/dropdown-options/photoVideo",
    ),
    "student_services": DepartmentSpec(
        unit_code="student_services",
        label="Student Services",
        requirement="campusTour",
        table="request_campus_tour",
        pk="request_campus_tour_id",
        label_column="start_point",
        option_table="campus_tour_start_options",
        option_pk="campus_tour_start_option_id",
        option_fk="start_point_option_id",
        quantity_column="pax",
        capacity_column="max_group_size",
        catalogue_route="/app/dropdown-options/campusTourStart",
    ),
    "food_beverage_services": DepartmentSpec(
        unit_code="food_beverage_services",
        label="F&B",
        requirement="fmb",
        table="request_fmb",
        pk="request_fmb_id",
        label_column="food_type",
        option_table="fmb_options",
        option_pk="fmb_option_id",
        start_column="serve_time",
        location_column="location",
        quantity_column="pax",
        catalogue_route="/app/cafeterias/menu-oversight",
    ),
}


def spec_for(unit_code: str | None) -> DepartmentSpec | None:
    return DEPARTMENT_SPEC.get(unit_code) if unit_code else None


def committed_rows_sql(spec: DepartmentSpec, alias: str = "x") -> str:
    """FROM clause for a department's detail rows joined to live proposals only."""
    return (
        f"FROM {spec.table} {alias} "
        f"JOIN request r ON r.request_id = {alias}.request_id "
        f"WHERE r.status <> ALL(%(non_committed)s)"
    )


def detail_params(extra: dict[str, Any] | None = None) -> dict[str, Any]:
    params: dict[str, Any] = {"non_committed": list(NON_COMMITTED_STATUSES)}
    if extra:
        params.update(extra)
    return params


def iso_week_start(column: str) -> str:
    """Postgres date_trunc to the Monday of the ISO week the column falls in.

    Weekly buckets everywhere use this, so a 12-week trend on one panel lines up
    with a 12-week trend on the next.
    """
    return f"date_trunc('week', {column})::date"

"""Workflow vocabulary: statuses, routing tables, and tunable config lookups.

Every value here mirrors ems_database_schema.sql's CHECK constraints and the
corrected state machine in
Nothing is hardcoded that the `config` table owns - thresholds are read live so
an admin change takes effect without a deploy.
"""
from __future__ import annotations

from decimal import Decimal

from ...db import fetch_one
from ...errors import WorkflowError

# --- request.status -------------------------------------------------------
DRAFT = "draft"
SUBMITTED = "submitted"
HOS_HOD_REVIEW = "hos_hod_review"
FMB_REVIEW = "fmb_review"
CFO_REVIEW = "cfo_review"
DEPARTMENT_REVIEW = "department_review"
RESUBMISSION_REQUIRED = "resubmission_required"
COMPLETED_APPROVED = "completed_approved"
COMPLETED_REJECTED = "completed_rejected"
CANCELLED = "cancelled"

# The three single-actor stages. One named person acts; they may approve,
# reject outright, or send it back. Departments can do none of those three.
REVIEWER_STAGES = (HOS_HOD_REVIEW, FMB_REVIEW, CFO_REVIEW)
TERMINAL_STATUSES = (COMPLETED_APPROVED, COMPLETED_REJECTED, CANCELLED)

# --- request_task.status --------------------------------------------------
TASK_PENDING = "pending"
TASK_APPROVED = "approved"
TASK_RESUBMITTED = "resubmitted"
TASK_PREPARING = "preparing"
TASK_COMPLETED = "completed"
TASK_CANCELLED = "cancelled"
TASK_TERMINAL = (TASK_COMPLETED, TASK_CANCELLED)

# --- request_fmb_selection.status ----------------------------------------
SEL_PENDING = "pending"
SEL_APPROVED = "approved"
SEL_RESUBMITTED = "resubmitted"
SEL_PREPARING = "preparing"
# Staff has finished preparing but not yet delivered - sits between claim and
# fulfilment (migration 013). Not terminal: SEL_TERMINAL is unchanged.
SEL_READY = "ready"
SEL_FULFILLED = "fulfilled"
SEL_CANCELLED = "cancelled"
SEL_TERMINAL = (SEL_FULFILLED, SEL_CANCELLED)

# --- Department routing ---------------------------------------------------
# chk_task_routing makes these mutually exclusive: a task carries EITHER an assigned_unit_code (the
# five Service-department requirements) OR an assigned_role (the two flat-routed ones), never both.
UNIT_CODE_FOR_REQUIREMENT = {
    "logistics": "logistics_and_facilities",
    "transportation": "transport_services",
    "photoVideo": "photography_services",
    "soundLight": "a_v_services",
    "campusTour": "student_services",
}
FLAT_ROLE_FOR_REQUIREMENT = {"fmb": "fmb"}

# Recorded on the form but never routed for approval: Funding/Purchase is
# informational only. The CFO's sole workflow role is the cfo_review stage.
NON_WORKFLOW_REQUIREMENTS = frozenset({"fundingPurchase"})

# Mineral water is not its own department lane - it folds into the F&B task, so
# F&B reviews food and water together as one unit of work.
WATER_REQUIREMENT = "waterNormal"
FMB_REQUIREMENT = "fmb"

# F&B's unit for USER identity (who is the F&B head). Task routing still uses
# the flat 'fmb' assigned_role token, because the cafeteria fan-out keys off it.
FMB_UNIT_CODE = "food_beverage_services"

# The one child table + its primary key column each requirement's rows live in.
TABLE_FOR_REQUIREMENT = {
    "logistics": ("request_logistics", "request_logistics_id"),
    "transportation": ("request_transportation", "request_transportation_id"),
    "photoVideo": ("request_photography_videography", "request_photography_videography_id"),
    "soundLight": ("request_sound_light", "request_sound_light_id"),
    "fmb": ("request_fmb", "request_fmb_id"),
    "campusTour": ("request_campus_tour", "request_campus_tour_id"),
    "waterNormal": ("request_mineral_water", "request_mineral_water_id"),
    "fundingPurchase": ("request_funding_purchase", "request_funding_purchase_id"),
}

# The five requirements whose rows can be individually assigned to staff (see request_row_assignment,
# migration 012).
ROW_ASSIGNABLE_REQUIREMENTS = frozenset({"logistics", "transportation", "photoVideo", "soundLight", "campusTour"})

# How many staff a single row of this requirement may have assigned at once.
MAX_ASSIGNEES_PER_ROW: dict[str, int | None] = {
    "logistics": None,
    "transportation": 1,
    "photoVideo": None,
    "soundLight": None,
    "campusTour": None,
}

HEAD_ROLE_CODES = ("head-of-school", "head-of-department")

# request.status (snake_case) -> the client's ProposalStage vocabulary (kebab-case, and
# completed_approved/completed_rejected collapse to a single 'approved'/'rejected' with no
# 'completed_' prefix).
STAGE_FOR_CLIENT = {
    SUBMITTED: "submitted",
    HOS_HOD_REVIEW: "hos-hod-review",
    FMB_REVIEW: "fmb-review",
    CFO_REVIEW: "cfo-review",
    DEPARTMENT_REVIEW: "department-review",
    RESUBMISSION_REQUIRED: "resubmission-required",
    COMPLETED_APPROVED: "approved",
    COMPLETED_REJECTED: "rejected",
    CANCELLED: "cancelled",
}


def stage_for_client(status: str | None) -> str | None:
    """Translate a raw request.status/resume_stage value for the client.

    Passes DRAFT and anything unrecognised through unchanged rather than
    raising - a resume_stage of None is common and must stay None.
    """
    if status is None:
        return None
    return STAGE_FOR_CLIENT.get(status, status)


def config_number(cur, code: str) -> Decimal:
    row = fetch_one(cur, "SELECT number FROM config WHERE code = %s", (code,))
    if row is None:
        raise WorkflowError(f"Configuration value {code} is missing.", code="config_missing")
    return row["number"]


def high_pax_threshold(cur) -> Decimal:
    return config_number(cur, "HIGH_PAX_THRESHOLD")


def cancellation_deadline_days(cur) -> int:
    return int(config_number(cur, "CANCELLATION_DEADLINE_DAYS"))


def max_event_categories(cur) -> int:
    return int(config_number(cur, "MAX_EVENT_CATEGORIES"))

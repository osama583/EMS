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
# Every department has approved and assigned; the work is in staff inboxes and
# the event is published. Departments decide at DEPARTMENT_REVIEW, staff carry
# out at IMPLEMENTATION - see recompute_department_phase() in tasks.py.
IMPLEMENTATION = "implementation"
RESUBMISSION_REQUIRED = "resubmission_required"
COMPLETED_APPROVED = "completed_approved"
COMPLETED_REJECTED = "completed_rejected"
CANCELLED = "cancelled"

# Set by the escalation job (migration 037) when an event date passed with no
# decision. The stage is part of the value because it is the accountability
# record: "overdue_cfo" answers "who was this waiting on" in every list, filter
# and export without a join.
OVERDUE_HOS_HOD = "overdue_hos_hod"
OVERDUE_FMB = "overdue_fmb"
OVERDUE_CFO = "overdue_cfo"
OVERDUE_DEPARTMENT = "overdue_department"
OVERDUE_STATUSES = (OVERDUE_HOS_HOD, OVERDUE_FMB, OVERDUE_CFO, OVERDUE_DEPARTMENT)

# The three single-actor stages. One named person acts; they may approve,
# reject outright, or send it back. Departments can do none of those three.
REVIEWER_STAGES = (HOS_HOD_REVIEW, FMB_REVIEW, CFO_REVIEW)
# Overdue counts as terminal: the event date has gone, so the proposal is a
# record rather than live work. This is what routes it OUT of every approver's
# inbox and INTO History - for the applicant and for the stage that held it -
# through _BUCKET_SQL, with no new query or page.
TERMINAL_STATUSES = (COMPLETED_APPROVED, COMPLETED_REJECTED, CANCELLED, *OVERDUE_STATUSES)

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
    IMPLEMENTATION: "implementation",
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


def min_event_lead_days(cur) -> int:
    """Days of notice required between today and the event start date.

    Missing rather than fatal: an installation that has not run migration 034
    should keep accepting proposals under the old no-notice rule, not reject
    every one of them.
    """
    row = fetch_one(cur, "SELECT number FROM config WHERE code = %s", ("MIN_EVENT_LEAD_DAYS",))
    return int(row["number"]) if row else 0


# --- Escalation policy (migration 037) --------------------------------------
# All five are "missing rather than fatal", for the same reason
# min_event_lead_days() is: an installation that has not run migration 037 must
# keep working under the old no-escalation behaviour, not fail every read. The
# defaults below therefore match the values the migration seeds.

def _config_int(cur, code: str, default: int) -> int:
    row = fetch_one(cur, "SELECT number FROM config WHERE code = %s", (code,))
    if not row or row["number"] is None:
        return default
    return int(row["number"])


def approval_warning_days(cur) -> int:
    """Days before the event at which an undecided proposal turns amber."""
    return _config_int(cur, "APPROVAL_WARNING_DAYS", 7)


def approval_urgent_days(cur) -> int:
    """Days before the event at which an undecided proposal turns red."""
    return _config_int(cur, "APPROVAL_URGENT_DAYS", 2)


def approval_warning_email_days(cur) -> int:
    """How often to re-chase the approver while amber. 0 = do not email."""
    return _config_int(cur, "APPROVAL_WARNING_EMAIL_DAYS", 2)


def approval_urgent_email_days(cur) -> int:
    """How often to re-chase the approver while red. 0 = do not email."""
    return _config_int(cur, "APPROVAL_URGENT_EMAIL_DAYS", 1)


def task_grace_minutes(cur) -> int:
    """Minutes past a task's own deadline before it counts as late."""
    return _config_int(cur, "TASK_GRACE_MINUTES", 5)

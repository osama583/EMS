"""Workflow vocabulary: statuses, routing tables, and tunable config lookups.

Every value here mirrors ems_database_schema.sql's CHECK constraints and the
corrected state machine in docs/superpowers/specs/2026-08-10-*-design.md §3.
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
SEL_FULFILLED = "fulfilled"
SEL_CANCELLED = "cancelled"
SEL_TERMINAL = (SEL_FULFILLED, SEL_CANCELLED)

# --- Department routing ---------------------------------------------------
# chk_task_routing makes these mutually exclusive: a task carries EITHER an
# assigned_unit_code (the five Service-department requirements) OR an
# assigned_role (the two flat-routed ones), never both.
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

HEAD_ROLE_CODES = ("head-of-school", "head-of-department")


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

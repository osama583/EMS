"""Widget registry. Importing this package registers every widget by id.

Module order is irrelevant to behaviour — `@widget()` raises on a duplicate id,
so a collision is a startup error rather than one profile silently shadowing
another's panel.

    base              the registry, the three widget shapes, the format vocabulary
    department        shared across every HOD profile (dept_jobs_at_risk,
                      dept_risk_list, dept_request_counts, dept_staff_balance,
                      dept_catalogue_health, and the hod_generic fallbacks) -
                      A/V, Logistics, Transport, Student Services and
                      Photography were unified onto this one shared shape and
                      no longer carry their own per-department widget module
    fmb               the F&B fan-out dashboard - not yet unified, see
                      department.py's module note
    cafeteria         the shift dashboard
    school            one profile, two shapes, chosen from the school's own data
    cfo               the institutional finance dashboard, R7 aggregates throughout
"""
from __future__ import annotations

from . import (  # noqa: F401  (imported for the side effect of registering)
    cafeteria,
    cfo,
    department,
    fmb,
    school,
)
from .base import WIDGET_REGISTRY, build

__all__ = ["WIDGET_REGISTRY", "build"]

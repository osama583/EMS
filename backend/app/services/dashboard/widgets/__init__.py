"""Widget registry. Importing this package registers every widget by id.

Module order is irrelevant to behaviour — `@widget()` raises on a duplicate id,
so a collision is a startup error rather than one profile silently shadowing
another's panel.

    base              the registry, the three widget shapes, the format vocabulary
    department        shared across all six service HODs, parameterised by unit
    av, logistics, transport, student_services, photography, fmb
                      the per-department instruments; each owns its signature panel
    cafeteria         the shift dashboard
    school            one profile, two shapes, chosen from the school's own data
    cfo               the institutional finance dashboard, R7 aggregates throughout
"""
from __future__ import annotations

from . import (  # noqa: F401  (imported for the side effect of registering)
    av,
    cafeteria,
    cfo,
    department,
    fmb,
    logistics,
    photography,
    school,
    student_services,
    transport,
)
from .base import WIDGET_REGISTRY, build

__all__ = ["WIDGET_REGISTRY", "build"]

"""The semantic layer: every number any dashboard can show, defined once.

One module per metric family

    common    shared SQL vocabulary and the per-department table/column map
    flow      Family A - flow and throughput      (M01-M08)
    sla       Family B - SLA and latency          (M10-M19)
    quality   Family C - quality and rework       (M20-M27)
    capacity  Family D - capacity and utilisation (M30-M39)
    demand    Family E - demand and forecast      (M40-M47)
    finance   Family F - cost and finance         (M50-M58)
    people    Family G - people and productivity  (M60-M67)
    risk      Family H - risk and anomaly         (M70-M78)

Widgets cite these functions rather than restating their SQL, so two dashboards
showing "decision latency" cannot disagree about what it means.
"""
from __future__ import annotations

from . import capacity, common, demand, finance, flow, people, quality, risk, sla

__all__ = ["capacity", "common", "demand", "finance", "flow", "people", "quality", "risk", "sla"]

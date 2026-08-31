"""Emit the whole-database ERD as Mermaid erDiagram source, from live introspection.

Reads _schema.json and writes 00-erd.mmd. Same source of truth as _build_erd.py,
so the Mermaid version and the SVG version can never disagree.
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
DATA = json.loads((HERE / "_schema.json").read_text(encoding="utf-8"))

# Same clusters as the SVG build, so the two figures group identically.
CLUSTERS = [
    ("Identity and access", [
        "users", "staff", "student", "external_user_profile", "unit", "role",
        "role_unit", "user_unit_roles", "password_reset_token"]),
    ("Navigation and page visibility", [
        "nav_page", "nav_page_grants", "nav_page_grant_roles", "nav_page_grant_units"]),
    ("Request core", [
        "request", "request_categories", "application_requirements", "request_clubs",
        "co_owners", "organizers", "important_people", "general_guest",
        "event_schedule", "brief_agenda", "request_discussion_topics"]),
    ("Requirement detail", [
        "request_logistics", "request_transportation", "request_photography_videography",
        "request_sound_light", "request_fmb", "request_fmb_selection",
        "request_campus_tour", "request_mineral_water", "request_funding_purchase"]),
    ("Workflow and assignment", [
        "request_task", "request_row_assignment", "task_assignment",
        "workflow_history", "proposal_escalation_sent"]),
    ("Events and community", [
        "event_registration", "saved_event", "notification_preference",
        "event_reminder_sent", "clubs", "club_categories", "club_category_links",
        "club_members", "club_join_requests", "club_president_change_requests"]),
    ("Catalog and dropdown options", [
        "event_category", "event_format", "event_requirements", "logistics_options",
        "transportation_options", "media_options", "sound_light_options",
        "dietary_information_options", "serving_unit_options", "fmb_options",
        "fmb_option_dietary_information", "campus_tour_start_options",
        "campus_tour_type_options", "funding_main_options", "funding_sub_options",
        "venue_options"]),
    ("Platform and audit", [
        "config", "schema_migrations", "cafeteria_staff_audit_log", "ai_access_denial"]),
]

# Mermaid attribute types must be a single bare token — no spaces, no parentheses.
TYPE_SHORT = {
    "bigint": "bigint", "integer": "integer", "smallint": "smallint",
    "boolean": "boolean", "text": "text", "jsonb": "jsonb", "json": "json",
    "date": "date", "numeric": "numeric", "double precision": "float8",
    "ARRAY": "array", "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamptz",
    "time without time zone": "time", "uuid": "uuid",
    "character varying": "varchar", "character": "char",
}

cols = defaultdict(list)
for c in DATA["columns"]:
    cols[c["table_name"]].append(c)

pk = defaultdict(set)
for p in DATA["primary_keys"]:
    pk[p["table_name"]].add(p["column_name"])

uk = defaultdict(set)
for u in DATA["uniques"]:
    uk[u["table_name"]].add(u["column_name"])

fk = defaultdict(set)
for f in DATA["foreign_keys"]:
    fk[f["src_table"]].add(f["src_column"])

nullable = {(c["table_name"], c["column_name"]): c["is_nullable"] == "YES"
            for c in DATA["columns"]}

all_tables = {t["table_name"] for t in DATA["tables"]}
placed = {t for _, ts in CLUSTERS for t in ts}
missing = sorted(all_tables - placed)
if missing:
    CLUSTERS.append(("Unclassified", missing))

out = ["erDiagram"]
A = out.append

for label, tables in CLUSTERS:
    A("")
    A(f"    %% ═══ {label} ═══")
    for t in tables:
        if t not in all_tables:
            continue
        A(f"    {t} {{")
        for c in cols[t]:
            name = c["column_name"]
            typ = TYPE_SHORT.get(c["data_type"], c["data_type"]).replace(" ", "_")
            marks = []
            if name in pk[t]:
                marks.append("PK")
            if name in fk[t]:
                marks.append("FK")
            if name in uk[t] and name not in pk[t]:
                marks.append("UK")
            suffix = f" {','.join(marks)}" if marks else ""
            A(f"        {typ} {name}{suffix}")
        A("    }")

A("")
A("    %% ═══ Relationships — 111 foreign keys ═══")
seen = set()
for f in sorted(DATA["foreign_keys"], key=lambda r: (r["ref_table"], r["src_table"], r["src_column"])):
    src, ref, col = f["src_table"], f["ref_table"], f["src_column"]
    if src not in all_tables or ref not in all_tables:
        continue
    key = (ref, src, col)
    if key in seen:
        continue
    seen.add(key)
    # nullable FK -> the parent side is optional
    left = "|o" if nullable.get((src, col), False) else "||"
    A(f'    {ref} {left}--o{{ {src} : "{col}"')

(HERE / "00-erd.mmd").write_text("\n".join(out) + "\n", encoding="utf-8")
print(f"wrote 00-erd.mmd  entities={sum(1 for _,ts in CLUSTERS for t in ts if t in all_tables)} "
      f"relationships={len(seen)} lines={len(out)}")

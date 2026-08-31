"""Generate the whole-database ERD as SVG from live schema introspection.

Reads _schema.json (produced by backend/scripts/_introspect_schema.py) and emits
00-erd.html. Every table, column, key and relationship comes from the database —
nothing here is hand-written, so the figure cannot drift from the schema.
"""
from __future__ import annotations

import json
import math
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).parent
DATA = json.loads((HERE / "_schema.json").read_text(encoding="utf-8"))

# ── palette (shared with the other figures) ──────────────────────────────
INK, BLUE, STRIP = "#141A20", "#27456F", "#E4EAF2"
RULE, DIM, TINT = "#AFBAC4", "#8A939D", "#F6F8FA"
PIG, PIG_SOFT = "#8E3A22", "#C08670"
EDGE, EDGE_HUB = "#6E8299", "#A8B6C4"

# ── geometry ─────────────────────────────────────────────────────────────
TW = 286          # table width
ROW = 16.5        # attribute row height
HEAD = 30         # entity header height
PAD_B = 7         # padding below last row
GAP_Y = 26        # vertical gap between tables
COL_GAP = 104     # horizontal channel between columns
MAX_H = 2700      # column packing height
CLUSTER_PAD = 16
TOP = 96

CLUSTERS = [
    ("Identity & access", [
        "users", "staff", "student", "external_user_profile", "unit", "role",
        "role_unit", "user_unit_roles", "password_reset_token"]),
    ("Navigation & page visibility", [
        "nav_page", "nav_page_grants", "nav_page_grant_roles", "nav_page_grant_units"]),
    ("Request core", [
        "request", "request_categories", "application_requirements", "request_clubs",
        "co_owners", "organizers", "important_people", "general_guest",
        "event_schedule", "brief_agenda", "request_discussion_topics"]),
    ("Requirement detail", [
        "request_logistics", "request_transportation", "request_photography_videography",
        "request_sound_light", "request_fmb", "request_fmb_selection",
        "request_campus_tour", "request_mineral_water", "request_funding_purchase"]),
    ("Workflow & assignment", [
        "request_task", "request_row_assignment", "task_assignment",
        "workflow_history", "proposal_escalation_sent"]),
    ("Events & community", [
        "event_registration", "saved_event", "notification_preference",
        "event_reminder_sent", "clubs", "club_categories", "club_category_links",
        "club_members", "club_join_requests", "club_president_change_requests"]),
    ("Catalog & dropdown options", [
        "event_category", "event_format", "event_requirements", "logistics_options",
        "transportation_options", "media_options", "sound_light_options",
        "dietary_information_options", "serving_unit_options", "fmb_options",
        "fmb_option_dietary_information", "campus_tour_start_options",
        "campus_tour_type_options", "funding_main_options", "funding_sub_options",
        "venue_options"]),
    ("Platform & audit", [
        "config", "schema_migrations", "cafeteria_staff_audit_log", "ai_access_denial"]),
]

TYPE_SHORT = {
    "bigint": "int8", "integer": "int4", "smallint": "int2", "boolean": "bool",
    "text": "text", "jsonb": "jsonb", "json": "json", "date": "date",
    "numeric": "numeric", "double precision": "float8", "ARRAY": "array",
    "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamptz",
    "time without time zone": "time", "uuid": "uuid",
}


def short_type(col: dict) -> str:
    dt = col["data_type"]
    if dt == "character varying":
        n = col.get("character_maximum_length")
        return f"varchar({n})" if n else "varchar"
    if dt == "character":
        return "char"
    return TYPE_SHORT.get(dt, dt)


# ── index the introspection ──────────────────────────────────────────────
cols_by_table: dict[str, list[dict]] = defaultdict(list)
for c in DATA["columns"]:
    cols_by_table[c["table_name"]].append(c)

pk: dict[str, set[str]] = defaultdict(set)
for p in DATA["primary_keys"]:
    pk[p["table_name"]].add(p["column_name"])

fk: dict[str, set[str]] = defaultdict(set)
for f in DATA["foreign_keys"]:
    fk[f["src_table"]].add(f["src_column"])

uniq: dict[str, set[str]] = defaultdict(set)
for u in DATA["uniques"]:
    uniq[u["table_name"]].add(u["column_name"])

all_tables = [t["table_name"] for t in DATA["tables"]]
placed = {t for _, ts in CLUSTERS for t in ts}
missing = [t for t in all_tables if t not in placed]
if missing:                                    # never silently drop a table
    CLUSTERS.append(("Unclassified", missing))
extra = [t for _, ts in CLUSTERS for t in ts if t not in all_tables]
assert not extra, f"cluster names not in database: {extra}"


def table_height(t: str) -> float:
    return HEAD + len(cols_by_table[t]) * ROW + PAD_B


# ── pack clusters into columns ───────────────────────────────────────────
columns: list[list[str]] = []
col_cluster: list[int] = []
cluster_cols: dict[int, list[int]] = defaultdict(list)

for ci, (_, tables) in enumerate(CLUSTERS):
    cur: list[str] = []
    h = 0.0
    for t in tables:
        th = table_height(t)
        if cur and h + th + GAP_Y > MAX_H:
            columns.append(cur)
            col_cluster.append(ci)
            cluster_cols[ci].append(len(columns) - 1)
            cur, h = [], 0.0
        cur.append(t)
        h += th + GAP_Y
    if cur:
        columns.append(cur)
        col_cluster.append(ci)
        cluster_cols[ci].append(len(columns) - 1)

# geometry per table
pos: dict[str, tuple[float, float]] = {}
col_x: list[float] = []
x = 40.0
prev_cluster = None
for i, col in enumerate(columns):
    if prev_cluster is not None and col_cluster[i] != prev_cluster:
        x += 46                                # extra air between clusters
    col_x.append(x)
    y = TOP
    for t in col:
        pos[t] = (x, y)
        y += table_height(t) + GAP_Y
    x += TW + COL_GAP
    prev_cluster = col_cluster[i]

CANVAS_W = x - COL_GAP + 40
CANVAS_H = max(pos[t][1] + table_height(t) for t in pos) + 56


def row_y(t: str, colname: str) -> float:
    x0, y0 = pos[t]
    for i, c in enumerate(cols_by_table[t]):
        if c["column_name"] == colname:
            return y0 + HEAD + i * ROW + ROW / 2
    return y0 + HEAD / 2


def col_index_of(t: str) -> int:
    for i, col in enumerate(columns):
        if t in col:
            return i
    return 0


# ── emit ─────────────────────────────────────────────────────────────────
out: list[str] = []
A = out.append

A(f'<svg viewBox="0 0 {CANVAS_W:.0f} {CANVAS_H:.0f}" role="img" '
  f'aria-label="Entity relationship diagram of the APU Event Management System database">')
A('''  <defs>
    <marker id="crow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="11"
            markerHeight="11" orient="auto-start-reverse">
      <path d="M11,6 L0,0 M11,6 L0,6 M11,6 L0,12" fill="none" stroke="#7C8DA1" stroke-width="1.2"/>
    </marker>
    <marker id="one" viewBox="0 0 12 12" refX="2" refY="6" markerWidth="11"
            markerHeight="11" orient="auto-start-reverse">
      <path d="M3,1 L3,11" fill="none" stroke="#7C8DA1" stroke-width="1.4"/>
    </marker>
  </defs>''')

# cluster bands
for ci, (label, _) in enumerate(CLUSTERS):
    cols = cluster_cols.get(ci, [])
    if not cols:
        continue
    bx = col_x[cols[0]] - CLUSTER_PAD
    bw = (col_x[cols[-1]] + TW + CLUSTER_PAD) - bx
    # Band hugs its own content — a full-height band on a short cluster reads
    # as empty space the reader keeps scanning for something in.
    bottom = max(pos[t][1] + table_height(t) for c in cols for t in columns[c])
    A(f'  <rect x="{bx:.1f}" y="{TOP - 52:.1f}" width="{bw:.1f}" '
      f'height="{bottom - TOP + 52 + CLUSTER_PAD:.1f}" fill="{TINT}" stroke="{RULE}" '
      f'stroke-width="1" stroke-dasharray="4 4" rx="3"/>')
    A(f'  <text class="cl" x="{bx + 14:.1f}" y="{TOP - 28:.1f}">{label}</text>')

# relationship edges, drawn under the tables
hub = {"users", "request"}
for f in DATA["foreign_keys"]:
    s, tgt = f["src_table"], f["ref_table"]
    if s not in pos or tgt not in pos:
        continue
    sy, ty = row_y(s, f["src_column"]), row_y(tgt, f["ref_column"])
    si, ti = col_index_of(s), col_index_of(tgt)
    sx0, tx0 = pos[s][0], pos[tgt][0]
    stroke = EDGE_HUB if tgt in hub else EDGE
    jit = (hash(f["constraint_name"]) % 46) - 23

    if si < ti:
        p1, p2 = sx0 + TW, tx0
        mid = (p1 + p2) / 2 + jit
    elif si > ti:
        p1, p2 = sx0, tx0 + TW
        mid = (p1 + p2) / 2 + jit
    else:                                       # same column: route left
        p1, p2 = sx0, tx0
        mid = sx0 - 34 - abs(jit) * 0.7
    d = f"M{p1:.1f},{sy:.1f} H{mid:.1f} V{ty:.1f} H{p2:.1f}"
    A(f'  <path d="{d}" fill="none" stroke="{stroke}" stroke-width="1.15" '
      f'marker-start="url(#crow)" marker-end="url(#one)"/>')

# tables
for t, (tx, ty) in pos.items():
    h = table_height(t)
    A(f'  <g>')
    A(f'    <rect x="{tx}" y="{ty}" width="{TW}" height="{h:.1f}" fill="#FFFFFF" '
      f'stroke="{BLUE}" stroke-width="1.5" rx="2"/>')
    A(f'    <rect x="{tx + 0.75}" y="{ty + 0.75}" width="{TW - 1.5}" height="{HEAD - 0.75}" fill="{STRIP}"/>')
    A(f'    <line x1="{tx}" y1="{ty + HEAD}" x2="{tx + TW}" y2="{ty + HEAD}" stroke="{BLUE}" stroke-width="1.2"/>')
    A(f'    <text class="en" x="{tx + 11}" y="{ty + 20}">{t}</text>')
    A(f'    <text class="ec" x="{tx + TW - 11}" y="{ty + 20}" text-anchor="end">'
      f'{len(cols_by_table[t])}</text>')
    for i, c in enumerate(cols_by_table[t]):
        cy = ty + HEAD + i * ROW
        name = c["column_name"]
        is_pk, is_fk = name in pk[t], name in fk[t]
        if i % 2 == 1:
            A(f'    <rect x="{tx + 0.75}" y="{cy:.1f}" width="{TW - 1.5}" height="{ROW}" fill="#FAFBFC"/>')
        tag = "PK" if is_pk else ("FK" if is_fk else "")
        if tag:
            A(f'    <text class="{"pk" if is_pk else "fk"}" x="{tx + 10}" y="{cy + 12:.1f}">{tag}</text>')
        cls = "an-k" if (is_pk or is_fk) else "an"
        nm = name if len(name) <= 30 else name[:29] + "…"
        A(f'    <text class="{cls}" x="{tx + 34}" y="{cy + 12:.1f}">{nm}</text>')
        ty_txt = short_type(c)
        nullable = "" if c["is_nullable"] == "NO" else " ?"
        A(f'    <text class="ty" x="{tx + TW - 10}" y="{cy + 12:.1f}" text-anchor="end">'
          f'{ty_txt}{nullable}</text>')
    A('  </g>')

A('</svg>')

svg = "\n".join(out)

HTML = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Entity relationship diagram</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  html,body{{margin:0;padding:0;background:#fff}}
  body{{display:flex;justify-content:center;padding:20px}}
  svg{{width:100%;max-width:{CANVAS_W:.0f}px;height:auto;display:block}}
  .cl {{font-family:"Barlow Condensed",sans-serif;font-weight:700;font-size:19px;
       letter-spacing:.16em;text-transform:uppercase;fill:{BLUE}}}
  .en {{font-family:"Barlow Condensed",sans-serif;font-weight:600;font-size:17px;
       letter-spacing:.03em;fill:{INK}}}
  .ec {{font-family:"IBM Plex Mono",monospace;font-weight:500;font-size:9.5px;fill:#7B93B4}}
  .an {{font-family:"IBM Plex Mono",monospace;font-weight:400;font-size:10.5px;fill:#48525C}}
  .an-k{{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:10.5px;fill:{INK}}}
  .ty {{font-family:"IBM Plex Mono",monospace;font-weight:400;font-size:9px;fill:{DIM}}}
  .pk {{font-family:"IBM Plex Mono",monospace;font-weight:700;font-size:8.5px;fill:{PIG}}}
  .fk {{font-family:"IBM Plex Mono",monospace;font-weight:600;font-size:8.5px;fill:#5C7FA8}}
</style>
</head>
<body>
{svg}
</body>
</html>
"""

(HERE / "00-erd.html").write_text(HTML, encoding="utf-8")
print(f"tables={len(pos)} columns={sum(len(v) for v in cols_by_table.values())} "
      f"fks={len(DATA['foreign_keys'])} canvas={CANVAS_W:.0f}x{CANVAS_H:.0f} "
      f"cols={len(columns)}")

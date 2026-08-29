"""Production-like seed: an EMS that looks like it has been running for months.

    python -m seed.seed_production                 # generate
    python -m seed.seed_production --dry-run       # generate, then roll back
    python -m seed.seed_production --validate-only # just run the Phase 10 checks

Every proposal is created with `app.services.proposals.create` and moved through
`app.services.workflow` exactly the way the API does it - never a raw INSERT into
`request`, `request_task`, `request_row_assignment`, `request_fmb_selection` or
`workflow_history`. That is the only way a seeded row ends up with a correct
audit trail, correct department tasks and correct derived state.

The clock is the one thing the state machine cannot get right on its own: every
workflow function stamps `now()`, and inside a transaction Postgres `now()` is
the transaction start, so a naively seeded database claims every event in its
history was approved this afternoon. `Clock` below rewrites those columns to a
virtual timestamp after each step. The rewrite is exact rather than approximate
because every not-yet-rewritten value equals that single transaction timestamp.

See docs/seed/dependency-map.md for the analysis this is built on.

This script only ADDS. It never truncates and never deletes.
"""
from __future__ import annotations

import argparse
import logging
import pathlib
import random
import sys
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

import psycopg2.extras

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app.config import config  # noqa: E402
from app.db import fetch_all, fetch_one, init_pool, transaction  # noqa: E402
from app.security.passwords import hash_password  # noqa: E402
from app.security.principal import Principal  # noqa: E402
from app.services import proposals  # noqa: E402
from app.services import workflow as wf  # noqa: E402
from seed import production_data as P  # noqa: E402

log = logging.getLogger("seed.production")

ATRIUM = "cafeteria__atrium_cafeteria"
FOOD_COURT = "cafeteria__level_3_food_court"
CAFETERIAS = (ATRIUM, FOOD_COURT)

# Which requirements each kind of event actually asks for.
REQUIREMENT_MIX = {
    "fair":        ["logistics", "soundLight", "photoVideo", "fundingPurchase"],
    "seminar":     ["logistics", "soundLight"],
    "meeting":     ["logistics", "fmb"],
    "conference":  ["logistics", "soundLight", "photoVideo", "fmb"],
    "dinner":      ["logistics", "fmb", "soundLight", "photoVideo", "fundingPurchase"],
    "workshop":    ["logistics", "fmb"],
    "hackathon":   ["logistics", "soundLight", "fmb", "waterNormal", "photoVideo"],
    "competition": ["logistics", "soundLight", "photoVideo"],
    "exhibition":  ["logistics", "photoVideo"],
    "festival":    ["logistics", "soundLight", "photoVideo", "fmb", "waterNormal", "fundingPurchase"],
    "ceremony":    ["logistics", "soundLight", "photoVideo"],
    "concert":     ["logistics", "soundLight", "photoVideo"],
    "sports":      ["logistics", "waterNormal", "photoVideo"],
    "wellness":    ["logistics"],
    "drive":       ["logistics", "waterNormal"],
    "offsite":     ["transportation", "logistics", "waterNormal"],
    "orientation": ["logistics", "campusTour", "soundLight", "fmb"],
    "gaming":      ["logistics", "soundLight", "fmb"],
    "screening":   ["logistics", "soundLight"],
    "openday":     ["logistics", "campusTour", "soundLight", "photoVideo", "fmb", "fundingPurchase"],
    "tour":        ["campusTour"],
}

# Real files in fyp-ui/public/assets/events - a served image beats a grey
# placeholder on every card, calendar tile and detail modal.
IMAGE_FOR_KIND = {
    "fair": "career-connect-fair.jpg", "seminar": "career-connect-fair.jpg",
    "hackathon": "tech-expo.jpg", "workshop": "tech-expo.jpg", "competition": "tech-expo.jpg",
    "festival": "cultural-night.jpg", "concert": "cultural-night.jpg", "ceremony": "cultural-night.jpg",
    "gaming": "esports-showdown.jpg",
    "sports": "wellness-run.jpg", "wellness": "wellness-run.jpg",
    "drive": "community-green-day.jpg", "offsite": "community-green-day.jpg",
    "meeting": "startup-pitch-night.jpg", "conference": "startup-pitch-night.jpg",
    "screening": "campus-after-dark.jpg", "dinner": "campus-after-dark.jpg",
    "openday": "campus-after-dark.jpg", "tour": "campus-after-dark.jpg",
    "orientation": "campus-after-dark.jpg", "exhibition": "campus-after-dark.jpg",
}

HEAD_EMAIL_FOR_REQUIREMENT = {
    "logistics": "logistics.manager@demo.apu.edu.my",
    "transportation": "transport.manager@demo.apu.edu.my",
    "photoVideo": "photography.manager@demo.apu.edu.my",
    "soundLight": "av.manager@demo.apu.edu.my",
    "campusTour": "student.services.manager@demo.apu.edu.my",
    "fmb": "fmb@demo.apu.edu.my",
}
UNIT_FOR_REQUIREMENT = dict(wf.constants.UNIT_CODE_FOR_REQUIREMENT)
ROW_ASSIGNABLE = set(wf.constants.ROW_ASSIGNABLE_REQUIREMENTS)

# How many staff a manager puts on one row. A big chairs-and-tables setup gets
# two people; a vehicle gets exactly one (MAX_ASSIGNEES_PER_ROW enforces it).
CREW_SIZE = {"logistics": (1, 2), "photoVideo": (1, 2), "soundLight": (1, 2),
             "campusTour": (1, 2), "transportation": (1, 1)}

SEND_BACK_COMMENTS = [
    "The setup window overlaps another booking in this venue. Please move the start time to 07:00 or pick a different hall.",
    "Quantities do not match the stated pax. Please revise the count and resubmit.",
    "We need the exact power requirements before we can commit equipment to this date.",
    "This falls outside our published lead time. Please resubmit with a date at least five working days out.",
    "The location field is ambiguous - please name the specific room rather than the block.",
]
REVIEWER_SEND_BACK = [
    "The budget section does not add up against the stated pax. Please correct the figures and resubmit.",
    "Please add the expected benefits in measurable terms - the current wording is too general to approve.",
    "The venue is already committed on this date. Confirm an alternative with Logistics before resubmitting.",
    "Add the external speaker's details and confirm who is covering their honorarium.",
]
REJECTION_REASONS = [
    "The date clashes with the university examination period, which is a hard block under the academic calendar policy.",
    "Off-campus events without an approved venue partner and insurance cover fall outside current policy.",
    "The requested budget exceeds the remaining envelope for this quarter and cannot be committed.",
    "Duplicate of an already-approved proposal from the same organiser for the same week.",
]
PUSHBACK_COMMENTS = [
    "Atrium cannot take an order this size on that date - please split it across both outlets.",
    "This item is off the menu until the new supplier contract starts. Please pick an alternative.",
    "Serving time is inside our peak lunch service. Please move it to 14:00 or later.",
]


# --- Small helpers ---------------------------------------------------------
def principal_for(cur, user_id: int) -> Principal:
    user = fetch_one(cur, "SELECT * FROM users WHERE user_id = %s", (user_id,))
    if not user:
        raise SystemExit(f"user {user_id} missing - run `python -m seed.run` first")
    rows = fetch_all(
        cur, "SELECT role_code, unit_code FROM user_unit_roles WHERE user_id = %s", (user_id,)
    )
    return Principal(
        user_id=user["user_id"], full_name=user["full_name"], email=user["email"],
        is_active=True, assignments=tuple((r["role_code"], r["unit_code"]) for r in rows),
    )


def status_of(cur, request_id: int) -> str:
    return fetch_one(cur, "SELECT status FROM request WHERE request_id = %s", (request_id,))["status"]


class Clock:
    """Virtual time for one proposal.

    `tick()` advances toward `deadline` by a fraction of what is left, so the
    sequence is always strictly increasing and never crosses the deadline no
    matter how many steps a proposal takes. `stamp()` rewrites the workflow
    history rows written since the last stamp; `settle()` derives every other
    timestamp from that rewritten history at the end.
    """

    def __init__(self, cur, request_id: int, start: datetime, deadline: datetime, rng: random.Random, txn_now: datetime):
        self.cur, self.rid, self.rng, self.txn_now = cur, request_id, rng, txn_now
        self.at = start
        self.created_at = start
        self.deadline = max(deadline, start + timedelta(hours=2))
        self.selection_stamps: list[tuple[int, str, datetime]] = []

    def tick(self, minimum_hours: float = 1.0) -> datetime:
        """Advance by a slice of the time that is left, never past the deadline.

        Geometric rather than fixed-size on purpose: a proposal does not know in
        advance how many transitions it will take (a send-back adds two, a
        cafeteria pushback adds two more), so any additive step eventually
        overshoots and starts stamping the audit trail into the future. Taking a
        fraction of the remainder cannot.
        """
        remaining = (self.deadline - self.at).total_seconds()
        if remaining <= 120:
            step = remaining / 2
        else:
            step = self.rng.uniform(0.10, 0.35) * remaining
            step = max(min(step, remaining - 60.0), min(60.0, remaining - 60.0))
            if remaining > 6 * 3600:
                step = min(max(step, minimum_hours * 3600), remaining * 0.6)
        self.at += timedelta(seconds=step)
        return self.at

    def stamp(self) -> None:
        """Rewrite everything the last workflow call stamped with now()."""
        self.cur.execute(
            "UPDATE workflow_history SET created_at = %s WHERE request_id = %s AND created_at >= %s",
            (self.at, self.rid, self.txn_now),
        )

    def note_selection(self, selection_id: int, column: str) -> None:
        self.selection_stamps.append((selection_id, column, self.at))

    def settle(self) -> None:
        """Derive every remaining timestamp from the rewritten audit trail."""
        cur, rid, final = self.cur, self.rid, self.at
        cur.execute(
            """UPDATE request r SET
                   created_at   = %(created)s,
                   submitted_at = (SELECT min(h.created_at) FROM workflow_history h
                                    WHERE h.request_id = r.request_id AND h.action = 'submit'),
                   updated_at   = COALESCE((SELECT max(h.created_at) FROM workflow_history h
                                    WHERE h.request_id = r.request_id), %(final)s),
                   cancelled_at = (SELECT max(h.created_at) FROM workflow_history h
                                    WHERE h.request_id = r.request_id AND h.action = 'cancel'
                                      AND h.request_task_id IS NULL)
               WHERE r.request_id = %(rid)s""",
            {"created": self.created_at, "final": final, "rid": rid},
        )
        cur.execute(
            """UPDATE request_task t SET
                   created_at  = COALESCE((SELECT min(h.created_at) FROM workflow_history h
                                    WHERE h.request_task_id = t.request_task_id AND h.action = 'task-created'),
                                    t.created_at),
                   resolved_at = CASE WHEN t.resolved_at IS NULL THEN NULL ELSE
                                    COALESCE((SELECT max(h.created_at) FROM workflow_history h
                                       WHERE h.request_task_id = t.request_task_id
                                         AND h.new_status IN ('approved','completed','cancelled')), %(final)s)
                                 END
               WHERE t.request_id = %(rid)s""",
            {"final": final, "rid": rid},
        )
        cur.execute(
            """UPDATE task_assignment ta SET assigned_at = COALESCE(
                       (SELECT max(h.created_at) FROM workflow_history h
                         WHERE h.request_task_id = ta.request_task_id AND h.action = 'assign'), %(final)s)
                 FROM request_task t
                WHERE t.request_task_id = ta.request_task_id AND t.request_id = %(rid)s
                  AND ta.assigned_at >= %(txn)s""",
            {"final": final, "rid": rid, "txn": self.txn_now},
        )
        cur.execute(
            """UPDATE request_row_assignment a SET
                   assigned_at = COALESCE((SELECT min(h.created_at) FROM workflow_history h
                                    WHERE h.request_task_id = a.request_task_id AND h.action = 'assign-row'
                                      AND h.comment = 'row ' || a.row_id), %(final)s),
                   resolved_at = CASE WHEN a.resolved_at IS NULL THEN NULL ELSE
                                    COALESCE((SELECT max(h.created_at) FROM workflow_history h
                                       WHERE h.request_task_id = a.request_task_id AND h.action = 'completed'
                                         AND h.comment = 'row ' || a.row_id), %(final)s)
                                 END
                 FROM request_task t
                WHERE t.request_task_id = a.request_task_id AND t.request_id = %(rid)s
                  AND a.assigned_at >= %(txn)s""",
            {"final": final, "rid": rid, "txn": self.txn_now},
        )
        for selection_id, column, when in self.selection_stamps:
            cur.execute(
                f"UPDATE request_fmb_selection SET {column} = %s WHERE request_fmb_selection_id = %s",
                (when, selection_id),
            )


# --- Catalogue resolution --------------------------------------------------
class Catalogue:
    """Live option ids by label, so nothing here hardcodes a primary key."""

    TABLES = {
        "logistics": ("logistics_options", "logistics_option_id"),
        "transportation": ("transportation_options", "transportation_option_id"),
        "photoVideo": ("media_options", "media_option_id"),
        "soundLight": ("sound_light_options", "sound_light_option_id"),
        "campusTourStart": ("campus_tour_start_options", "campus_tour_start_option_id"),
        "campusTourType": ("campus_tour_type_options", "campus_tour_type_option_id"),
        "fundingMain": ("funding_main_options", "funding_main_option_id"),
        "fundingSub": ("funding_sub_options", "funding_sub_option_id"),
        "venue": ("venue_options", "venue_option_id"),
    }

    def __init__(self, cur):
        self.by_label: dict[str, dict[str, int]] = {}
        self.order: dict[str, list[int]] = {}
        for kind, (table, pk) in self.TABLES.items():
            order_by = "sort_order, " + pk if kind == "venue" else pk
            rows = fetch_all(
                cur,
                f"SELECT {pk} AS id, label FROM {table} "
                f"WHERE active AND archived_at IS NULL ORDER BY {order_by}",
            )
            self.by_label[kind] = {r["label"]: r["id"] for r in rows}
            self.order[kind] = [r["id"] for r in rows]
        self.menu: dict[str, list[dict]] = {}
        for row in fetch_all(
            cur,
            """SELECT fmb_option_id AS id, label, unit_code, unit_price_rm
                 FROM fmb_options WHERE active AND archived_at IS NULL AND unit_code = ANY(%s)
             ORDER BY fmb_option_id""",
            (list(CAFETERIAS),),
        ):
            self.menu.setdefault(row["unit_code"], []).append(row)

    def venue(self, rng: random.Random) -> tuple[str, str]:
        """A random live venue as ("venue:{n}", label).

        Read from venue_options rather than a literal list: after migration 032
        the venue catalogue IS the source, and a seed that carried its own copy
        would be exactly the hardcoded list this feature removed.
        """
        table = self.by_label.get("venue") or {}
        if not table:
            raise SystemExit("no active venues - run `python -m seed.run` first")
        label = rng.choice(sorted(table))
        return f"venue:{table[label]}", label

    def pick(self, kind: str, *preferred: str) -> str:
        """`"{kind}:{id}"` for the first preferred label that exists, else the first active row."""
        table = self.by_label[kind]
        for label in preferred:
            if label in table:
                return f"{kind}:{table[label]}"
        if not self.order[kind]:
            raise SystemExit(f"no active {kind} options - run `python -m seed.run` first")
        return f"{kind}:{self.order[kind][0]}"


# --- Requirement row builders ----------------------------------------------
def build_requirement_rows(cat: Catalogue, kinds: list[str], day: str, venue: tuple[str, str],
                           pax: int, rng: random.Random) -> dict[str, list[dict]]:
    """`venue` is the ("venue:{n}", label) pair from the venue catalogue.

    Logistics, Sound & Light, Food and Mineral Water send `venueId` and no
    location text at all: those four are delivered by the university, so the
    only place they can be delivered to is a university venue (migration 032).
    The proposal service freezes the label onto each row from the id.
    """
    venue_ref, venue_label = venue
    rows: dict[str, list[dict]] = {}

    if "logistics" in kinds:
        items = [{
            "item": cat.pick("logistics", "Banquet Chair"),
            "quantity": max(10, min(400, int(pax * rng.uniform(0.7, 1.0)))),
            "date": day, "start": "07:30", "end": "19:00", "venueId": venue_ref,
            "notes": "Chairs in theatre rows, aisle down the centre.",
        }]
        if pax >= 60:
            items.append({
                "item": cat.pick("logistics", "Round Table (8 pax)"),
                "quantity": max(2, min(40, pax // 10)),
                "date": day, "start": "07:30", "end": "19:00", "venueId": venue_ref,
                "notes": "Round tables at the back for registration and refreshments.",
            })
        if pax >= 150:
            items.append({
                "item": cat.pick("logistics", "Portable Stage Deck"),
                "quantity": rng.randint(4, 10),
                "date": day, "start": "06:30", "end": "20:00", "venueId": venue_ref,
                "notes": "Stage built the evening before if the hall is free.",
            })
        if rng.random() < 0.45:
            items.append({
                "item": cat.pick("logistics", "Pull-up Banner Stand"),
                "quantity": rng.randint(2, 6),
                "date": day, "start": "08:00", "end": "18:00", "venueId": venue_ref,
                "notes": "Banners at the entrance and either side of the stage.",
            })
        rows["logistics"] = items

    if "soundLight" in kinds:
        items = [{
            "item": cat.pick("soundLight", "Full Stage Sound" if pax >= 200 else "Basic PA System"),
            "date": day, "start": "07:00", "end": "20:00", "venueId": venue_ref,
            "notes": "Sound check ninety minutes before doors.",
        }]
        items.append({
            "item": cat.pick("soundLight", "Wireless Microphone"),
            "date": day, "start": "08:00", "end": "19:00", "venueId": venue_ref,
            "notes": f"{rng.randint(2, 6)} handhelds plus one lapel for the host.",
        })
        if pax >= 250:
            items.append({
                "item": cat.pick("soundLight", "Stage Lighting Rig"),
                "date": day, "start": "06:00", "end": "22:00", "venueId": venue_ref,
                "notes": "Front wash plus movers for the performance segment.",
            })
        rows["soundLight"] = items

    if "photoVideo" in kinds:
        items = [{
            "service": cat.pick("photoVideo", "Event Photography"),
            "date": day, "start": "08:30", "end": "18:00", "venueId": venue_ref,
            "notes": "Coverage of the opening, the main session and the group photo.",
        }]
        if pax >= 200:
            items.append({
                "service": cat.pick("photoVideo", "Event Videography"),
                "date": day, "start": "09:00", "end": "18:00", "venueId": venue_ref,
                "notes": "Highlight reel for the marketing team, delivered within two weeks.",
            })
        rows["photoVideo"] = items

    if "transportation" in kinds:
        seats = 40 if pax >= 60 else 18
        label = "40-Seater Coach" if seats == 40 else "18-Seater Van"
        rows["transportation"] = [{
            "type": cat.pick("transportation", label),
            "requestedPax": min(pax, seats),
            "pickup": "APU Main Entrance", "dropoff": venue_label,
            "date": day, "start": "07:00",
            "notes": "Return leg departs the site at 16:30.",
        }]
        if pax > seats:
            rows["transportation"].append({
                "type": cat.pick("transportation", "18-Seater Van"),
                "requestedPax": min(18, pax - seats),
                "pickup": "APU Main Entrance", "dropoff": venue_label,
                "date": day, "start": "07:15",
                "notes": "Overflow vehicle for the remaining participants.",
            })

    if "campusTour" in kinds:
        rows["campusTour"] = [{
            "startPoint": cat.pick("campusTourStart", "Main Lobby", "Auditorium Foyer"),
            "tourType": cat.pick("campusTourType", "General Campus Tour", "Facilities Tour"),
            "date": day, "pax": max(10, min(pax, rng.randint(20, 60))),
            "notes": "Split into groups of twenty with one guide each.",
        }]

    if "fmb" in kinds:
        cafeteria = rng.choice(CAFETERIAS)
        menu = cat.menu.get(cafeteria) or next(iter(cat.menu.values()))
        item = rng.choice(menu)
        rows["fmb"] = [{
            "foodType": f"fmb:{item['id']}",
            "quantity": max(10, int(pax * rng.uniform(0.6, 1.0))),
            "date": day, "start": rng.choice(["10:30", "12:30", "15:30", "18:30"]),
            "venueId": venue_ref,
            "notes": "Halal only. Please label anything containing nuts.",
        }]

    if "waterNormal" in kinds:
        rows["waterNormal"] = [{
            "quantity": max(24, int(pax * rng.uniform(0.8, 1.4)) // 24 * 24 or 24),
            "withLogo": "yes" if rng.random() < 0.4 else "no",
            "date": day, "start": "08:00", "end": "18:00", "venueId": venue_ref,
            "notes": "Chilled, delivered to the registration desk.",
        }]

    if "fundingPurchase" in kinds:
        main = rng.choice(["Marketing & Publicity", "Speaker & Talent", "Equipment Rental", "Venue & Facilities"])
        sub = {"Marketing & Publicity": "Printed Collateral", "Speaker & Talent": "Speaker Honorarium",
               "Equipment Rental": "AV Equipment Hire", "Venue & Facilities": "External Venue Hire"}[main]
        rows["fundingPurchase"] = [{
            "mainItem": cat.pick("fundingMain", main),
            "subItem": cat.pick("fundingSub", sub),
            "quantity": rng.randint(1, 8),
            "unit": round(rng.uniform(150, 2400), 2),
            "notes": "Quotation attached to the finance folder.",
        }]
    return rows


# --- Organisation ----------------------------------------------------------
@dataclass
class Ctx:
    """Everything the proposal builder needs to look somebody up."""
    users_by_email: dict[str, int] = field(default_factory=dict)
    unit_label: dict[str, str] = field(default_factory=dict)
    menu_by_unit: dict[str, list[dict]] = field(default_factory=dict)
    cafeteria_manager: dict[str, int] = field(default_factory=dict)
    students_by_school: dict[str, list[int]] = field(default_factory=dict)
    lecturers_by_school: dict[str, list[int]] = field(default_factory=dict)
    hos_by_school: dict[str, int] = field(default_factory=dict)
    staff_by_unit: dict[str, list[int]] = field(default_factory=dict)
    externals: list[int] = field(default_factory=list)
    club_presidents: list[tuple[int, str, str]] = field(default_factory=list)  # (user_id, club, school)
    # club_name -> club_id. Specs carry a club NAME (that is what _choose_applicant
    # returns), but a "Club Only" proposal has to submit club IDs so request_clubs
    # can record the audience - this is the bridge between the two.
    club_ids_by_name: dict[str, int] = field(default_factory=dict)
    # Both replaced from the database in seed_organisation - the clock that
    # matters is Postgres's, not this process's.
    txn_now: datetime = field(default_factory=lambda: datetime(1970, 1, 1))
    today: date = field(default_factory=lambda: date(1970, 1, 1))


def _insert_users(cur, people: list[tuple[str, str, list[tuple[str, str | None]]]], password_hash: str,
                  unit_label: dict[str, str]) -> dict[str, int]:
    """Insert accounts that do not exist yet. Returns email -> user_id for all of them."""
    emails = [email for email, _, _ in people]
    existing = {
        r["email"]: r["user_id"]
        for r in fetch_all(cur, "SELECT user_id, email FROM users WHERE email = ANY(%s)", (emails,))
    }
    missing = [p for p in people if p[0] not in existing]
    for email, full_name, assignments in missing:
        cur.execute(
            "INSERT INTO users (full_name, email, password, is_active) VALUES (%s, %s, %s, TRUE) RETURNING user_id",
            (full_name, email, password_hash),
        )
        user_id = cur.fetchone()["user_id"]
        existing[email] = user_id
        student_school = staff_department = None
        for role_code, unit_code in assignments:
            cur.execute(
                "INSERT INTO user_unit_roles (user_id, unit_code, role_code) VALUES (%s, %s, %s)"
                " ON CONFLICT DO NOTHING",
                (user_id, unit_code, role_code),
            )
            if role_code == "student":
                student_school = unit_label.get(unit_code, unit_code)
            elif role_code in ("head-of-school", "head-of-department", "lecturer", "staff"):
                staff_department = unit_label.get(unit_code, unit_code)
        if student_school:
            cur.execute("INSERT INTO student (user_id, school) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (user_id, student_school))
        elif staff_department:
            cur.execute("INSERT INTO staff (user_id, department_or_school) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (user_id, staff_department))
    return existing


def seed_organisation(cur, rng: random.Random, password_hash: str) -> Ctx:
    ctx = Ctx(txn_now=fetch_one(cur, "SELECT now() AS n")["n"].replace(tzinfo=None),
              today=fetch_one(cur, "SELECT current_date AS d")["d"])

    # --- new School units -------------------------------------------------
    for code, description in P.NEW_SCHOOL_UNITS:
        cur.execute("INSERT INTO unit (code, description, is_active) VALUES (%s, %s, TRUE) "
                    "ON CONFLICT (code) DO NOTHING", (code, description))
        for role_code in ("head-of-school", "lecturer", "student", "staff"):
            cur.execute("INSERT INTO role_unit (role_code, unit_code) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        (role_code, code))
    extend_nav_grants(cur, [code for code, _ in P.NEW_SCHOOL_UNITS])

    ctx.unit_label = {r["code"]: r["description"] for r in fetch_all(cur, "SELECT code, description FROM unit")}

    # --- faculty and department staff ------------------------------------
    people: list[tuple[str, str, list[tuple[str, str | None]]]] = []
    people += [(e, n, a) for e, n, a in P.NEW_FACULTY]
    people += [(e, n, a) for e, n, a in P.NEW_DEPARTMENT_STAFF]

    # --- students ---------------------------------------------------------
    used_names: set[str] = set()
    for school, count in P.STUDENTS_PER_SCHOOL.items():
        prefix = "".join(part[0] for part in school.split("_") if part not in ("of", "school"))
        for index in range(count):
            for _ in range(40):
                name = f"{rng.choice(P.GIVEN_NAMES)} {rng.choice(P.FAMILY_NAMES)}"
                if name not in used_names:
                    break
            used_names.add(name)
            email = f"{prefix}{index + 1:03d}@student.apu.edu.my"
            people.append((email, name, [("student", school)]))

    # --- external guests --------------------------------------------------
    for email, name, _age, _gender in P.EXTERNAL_GUESTS:
        people.append((email, name, [("external-user", None)]))

    ctx.users_by_email = _insert_users(cur, people, password_hash, ctx.unit_label)

    for email, _name, age, gender in P.EXTERNAL_GUESTS:
        cur.execute(
            "INSERT INTO external_user_profile (user_id, age, gender) VALUES (%s, %s, %s) "
            "ON CONFLICT (user_id) DO NOTHING",
            (ctx.users_by_email[email], age, gender),
        )

    # --- index everybody by unit/role, including accounts already present --
    for row in fetch_all(
        cur,
        """SELECT r.user_id, r.role_code, r.unit_code
             FROM user_unit_roles r JOIN users u ON u.user_id = r.user_id
            WHERE r.archived_at IS NULL AND u.is_active AND u.archived_at IS NULL""",
    ):
        role, unit, uid = row["role_code"], row["unit_code"], row["user_id"]
        if role == "student" and unit:
            ctx.students_by_school.setdefault(unit, []).append(uid)
        elif role == "lecturer" and unit:
            ctx.lecturers_by_school.setdefault(unit, []).append(uid)
        elif role == "head-of-school" and unit:
            ctx.hos_by_school.setdefault(unit, uid)
        elif role in ("staff", "cafeteria-staff") and unit:
            ctx.staff_by_unit.setdefault(unit, []).append(uid)
        elif role == "cafeteria-manager" and unit:
            ctx.cafeteria_manager.setdefault(unit, uid)
        elif role == "external-user":
            ctx.externals.append(uid)
    ctx.externals = sorted(set(ctx.externals))

    # Full address book, not just the accounts this run created: department
    # heads, the CFO and the F&B head were seeded by seed/run.py and every
    # workflow step below needs to look them up by email.
    ctx.users_by_email = {
        r["email"]: r["user_id"]
        for r in fetch_all(cur, "SELECT user_id, email FROM users WHERE is_active AND archived_at IS NULL")
    }
    for row in fetch_all(
        cur,
        """SELECT fmb_option_id AS id, label, unit_code FROM fmb_options
            WHERE active AND archived_at IS NULL AND unit_code = ANY(%s) ORDER BY fmb_option_id""",
        (list(CAFETERIAS),),
    ):
        ctx.menu_by_unit.setdefault(row["unit_code"], []).append(row)
    return ctx


def extend_nav_grants(cur, new_unit_codes: list[str]) -> None:
    """Teach the existing 'every unit' nav grants about newly created Schools.

    seed/nav.py writes unit_role/unit grants that enumerate every unit that
    existed at seed time. A School added afterwards would satisfy no grant and
    its users would sign in to an empty sidebar - so any grant that already
    names an existing School learns the new ones too. Cafeteria-scoped grants
    (which name only cafeteria units) are deliberately left alone.
    """
    grant_ids = [
        r["grant_id"] for r in fetch_all(
            cur,
            """SELECT DISTINCT g.grant_id
                 FROM nav_page_grants g JOIN nav_page_grant_units gu ON gu.grant_id = g.grant_id
                WHERE gu.unit_code = 'school_of_computing' AND g.archived_at IS NULL""",
        )
    ]
    for grant_id in grant_ids:
        for unit_code in new_unit_codes:
            cur.execute(
                "INSERT INTO nav_page_grant_units (grant_id, unit_code) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                (grant_id, unit_code),
            )


def seed_clubs(cur, ctx: Ctx, rng: random.Random) -> None:
    admin = fetch_one(cur, "SELECT user_id FROM users WHERE email = %s", ("club.admin@demo.apu.edu.my",))
    if not admin:
        return
    categories = {
        r["name"]: r["club_category_id"]
        for r in fetch_all(cur, "SELECT club_category_id, name FROM club_categories WHERE archived_at IS NULL")
    }
    existing = {r["club_name"] for r in fetch_all(cur, "SELECT club_name FROM clubs")}

    all_students = [(uid, school) for school, ids in ctx.students_by_school.items() for uid in ids]
    rng.shuffle(all_students)
    taken_presidents: set[int] = {
        r["user_id"] for r in fetch_all(cur, "SELECT user_id FROM clubs WHERE archived_at IS NULL")
    }
    # Presidents of the 'none'-tier clubs: real clubs with real members that have
    # simply never run an event. They must stay out of the organiser pool.
    dormant: set[int] = set()

    for club_name, description, category_names, member_count, tier in P.NEW_CLUBS:
        if club_name in existing:
            continue
        president = next((s for s in all_students if s[0] not in taken_presidents), None)
        if president is None:
            break
        taken_presidents.add(president[0])
        created_at = ctx.txn_now - timedelta(days=rng.randint(150, 900))
        cur.execute(
            """INSERT INTO clubs (user_id, club_name, description, created_by_user_id, active, created_at, image_url)
               VALUES (%s, %s, %s, %s, TRUE, %s, %s) RETURNING club_id""",
            (president[0], club_name, description, admin["user_id"], created_at, None),
        )
        club_id = cur.fetchone()["club_id"]
        ctx.club_ids_by_name[club_name] = club_id
        for name in category_names:
            if name in categories:
                cur.execute("INSERT INTO club_category_links (club_id, club_category_id) VALUES (%s, %s) "
                            "ON CONFLICT DO NOTHING", (club_id, categories[name]))
        members = {president[0]}
        pool = [uid for uid, _ in all_students]
        rng.shuffle(pool)
        for uid in pool[: max(0, member_count - 1)]:
            members.add(uid)
        rows = [(club_id, uid, (created_at + timedelta(days=rng.randint(0, 240))).date()) for uid in members]
        psycopg2.extras.execute_values(
            cur, "INSERT INTO club_members (club_id, user_id, date_joined) VALUES %s ON CONFLICT DO NOTHING", rows
        )
        if tier == "none":
            dormant.add(president[0])
        else:
            # A busy club shows up more often simply by appearing more than once
            # in the pool the organiser picker samples from.
            weight = {"high": 3, "medium": 2, "low": 1}[tier]
            ctx.club_presidents.extend([(president[0], club_name, president[1])] * weight)

    # Clubs seeded before this run have a president and almost nobody else, so
    # every roster screen and member count reads as a dead society. Top them up
    # from the same student body.
    for row in fetch_all(
        cur,
        """SELECT c.club_id, c.user_id,
                  (SELECT count(*) FROM club_members m WHERE m.club_id = c.club_id) AS members
             FROM clubs c WHERE c.archived_at IS NULL AND c.active""",
    ):
        target = rng.randint(16, 45)
        if row["members"] >= target:
            continue
        current = {
            r["user_id"] for r in fetch_all(
                cur, "SELECT user_id FROM club_members WHERE club_id = %s", (row["club_id"],))
        }
        candidates = [uid for uid, _ in all_students if uid not in current]
        rng.shuffle(candidates)
        joined = [
            (row["club_id"], uid, (ctx.txn_now - timedelta(days=rng.randint(10, 420))).date())
            for uid in candidates[: target - row["members"]]
        ]
        if joined:
            psycopg2.extras.execute_values(
                cur, "INSERT INTO club_members (club_id, user_id, date_joined) VALUES %s ON CONFLICT DO NOTHING",
                joined,
            )

    # Presidents of clubs seeded earlier can run events too.
    for row in fetch_all(
        cur,
        """SELECT c.club_id, c.club_name, c.user_id,
                  (SELECT unit_code FROM user_unit_roles r
                    WHERE r.user_id = c.user_id AND r.role_code = 'student' LIMIT 1) AS school
             FROM clubs c WHERE c.archived_at IS NULL AND c.active ORDER BY c.club_id""",
    ):
        if row["school"] and row["user_id"] not in dormant \
                and not any(p[0] == row["user_id"] for p in ctx.club_presidents):
            ctx.club_presidents.append((row["user_id"], row["club_name"], row["school"]))
        ctx.club_ids_by_name.setdefault(row["club_name"], row["club_id"])


def seed_club_requests(cur, ctx: Ctx, rng: random.Random) -> int:
    """Join requests and president handovers - the club-side inbox and history."""
    clubs = fetch_all(
        cur, "SELECT club_id, club_name, user_id FROM clubs WHERE archived_at IS NULL AND active ORDER BY club_id"
    )
    if not clubs:
        return 0
    reasons = [
        "I have been following the club's projects since orientation and want to join the build team.",
        "I am looking for a society where I can practise what I am learning in my programme.",
        "A friend in my cohort recommended this club and I would like to contribute to the committee.",
        "I ran a similar society at college and would like to help organise events here.",
        "I want to meet people outside my own School and this seemed like the right place to start.",
    ]
    created = 0
    for club in clubs:
        members = {
            r["user_id"] for r in fetch_all(cur, "SELECT user_id FROM club_members WHERE club_id = %s", (club["club_id"],))
        }
        candidates = [uid for ids in ctx.students_by_school.values() for uid in ids if uid not in members]
        rng.shuffle(candidates)
        pending = candidates[: rng.randint(1, 4)]
        resolved = candidates[len(pending): len(pending) + rng.randint(2, 5)]
        for uid in pending:
            cur.execute(
                """INSERT INTO club_join_requests (club_id, requester_user_id, reason, status, created_at)
                   VALUES (%s, %s, %s, 'pending', %s) ON CONFLICT DO NOTHING""",
                (club["club_id"], uid, rng.choice(reasons), ctx.txn_now - timedelta(days=rng.randint(1, 16))),
            )
            created += cur.rowcount
        for uid in resolved:
            made = ctx.txn_now - timedelta(days=rng.randint(20, 200))
            approved = rng.random() < 0.75
            cur.execute(
                """INSERT INTO club_join_requests
                       (club_id, requester_user_id, reason, status, comment, created_at, resolved_at, resolved_by_user_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (club["club_id"], uid, rng.choice(reasons),
                 "approved" if approved else "rejected",
                 None if approved else "Committee places are full for this semester - please reapply in the next intake.",
                 made, made + timedelta(days=rng.randint(1, 6)), club["user_id"]),
            )
            created += 1
            if approved:
                cur.execute(
                    "INSERT INTO club_members (club_id, user_id, date_joined) VALUES (%s, %s, %s) "
                    "ON CONFLICT DO NOTHING",
                    (club["club_id"], uid, (made + timedelta(days=2)).date()),
                )

    # One live handover waiting on the Club Admin, plus two decided ones.
    already = {
        r["club_id"] for r in fetch_all(
            cur, "SELECT club_id FROM club_president_change_requests WHERE status = 'pending'")
    }
    admin = fetch_one(cur, "SELECT user_id FROM users WHERE email = %s", ("club.admin@demo.apu.edu.my",))
    handover_clubs = [c for c in clubs if c["club_id"] not in already][:3]
    for index, club in enumerate(handover_clubs):
        members = [
            r["user_id"] for r in fetch_all(
                cur, "SELECT user_id FROM club_members WHERE club_id = %s AND user_id <> %s",
                (club["club_id"], club["user_id"]))
        ]
        if not members:
            continue
        successor = rng.choice(members)
        made = ctx.txn_now - timedelta(days=rng.randint(2, 90))
        if index == 0:
            cur.execute(
                """INSERT INTO club_president_change_requests
                       (club_id, current_president_user_id, requested_president_user_id, status, created_at)
                   VALUES (%s, %s, %s, 'pending', %s)""",
                (club["club_id"], club["user_id"], successor, made),
            )
        else:
            approved = index == 1
            cur.execute(
                """INSERT INTO club_president_change_requests
                       (club_id, current_president_user_id, requested_president_user_id, status, comment,
                        created_at, resolved_at, resolved_by_user_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (club["club_id"], club["user_id"], successor,
                 "approved" if approved else "rejected",
                 None if approved else "The nominee is graduating this semester - please nominate a continuing student.",
                 made, made + timedelta(days=rng.randint(1, 9)),
                 admin["user_id"] if admin else club["user_id"]),
            )
        created += 1
    return created


# --- Proposal specification -------------------------------------------------
STAGE_ORDER = ("hos_hod_review", "fmb_review", "cfo_review")
REPEAT_SUFFIXES = (" (Semester 2)", " (March Intake)", " (September Intake)", " - Second Edition")

# Events whose organiser is fixed because the point of them is the routing they
# produce: a CFO applicant skips every approval gate, a Head of School skips
# their own review.
APPLICANT_OVERRIDE = {
    "Finance Office Budget Briefing": "cfo@demo.apu.edu.my",
    "Sponsor Site Visit": "cfo@demo.apu.edu.my",
    "Department Heads Quarterly Review": "hoshod@demo.apu.edu.my",
    "Faculty Development Day": "hos.business@demo.apu.edu.my",
    "New Staff Induction": "hos.engineering@demo.apu.edu.my",
}
CLUB_KINDS = {"gaming", "festival", "sports", "drive", "offsite", "exhibition", "concert", "screening"}
STAFF_KINDS = {"meeting"}
PAID_KINDS = {"dinner", "competition", "concert"}


@dataclass
class Spec:
    index: int
    template: tuple
    title: str
    applicant_id: int
    applicant_unit: str | None
    # ("venue:{n}", "Grand Hall"). The ref is what request rows and the schedule
    # carry - the label is only used for the agenda, which is still free text.
    venue: tuple[str, str]
    event_format: str
    # Set only for an Off Campus event: the street address that goes in the schedule's Outside
    # University branch.
    external_location: str | None
    day: date
    days: int
    visibility: str
    registration_mode: str
    cost: float | None
    outcome: str
    requirements: list[str]
    dept_modes: dict[str, str]
    submitted_at: datetime
    deadline: datetime
    stall_at: str | None = None
    resubmit_at: str | None = None
    cancel_at: str = "department_review"
    club: str | None = None


def _routed_requirements(kinds: list[str]) -> list[str]:
    folded = {wf.constants.FMB_REQUIREMENT if k == "waterNormal" else k for k in kinds}
    return sorted(folded - wf.constants.NON_WORKFLOW_REQUIREMENTS)


derive_fmb_cycle = (
    # Walked in order across the in-flight proposals so the F&B lane is not left to chance.
    "assigned", "preparing", "assigned", "pending", "preparing",
    "complete", "assigned", "sendback", "preparing", "assigned",
)


def _plan_departments(routed: list[str], outcome: str, rng: random.Random,
                      fmb_mode: str | None = None) -> dict[str, str]:
    """What each department has done so far.

    'complete' everywhere is the only shape that lets a proposal reach
    completed_approved, so a proposal parked in department_review is forced to
    keep at least one lane open - otherwise the state machine would finish it
    and the seed would silently have no department inbox at all.
    """
    if outcome != "department_review":
        return {name: "complete" for name in routed}
    choices = ["pending", "assigned", "preparing", "sendback", "complete"]
    weights = [34, 24, 22, 12, 8]
    modes = {name: rng.choices(choices, weights=weights, k=1)[0] for name in routed}
    if fmb_mode and wf.constants.FMB_REQUIREMENT in modes:
        modes[wf.constants.FMB_REQUIREMENT] = fmb_mode
    # 'pending' and 'sendback' are the only two modes that cannot terminate on their own.
    if not any(mode in ("pending", "sendback") for mode in modes.values()):
        modes[rng.choice(routed)] = "pending"
    return modes


def _choose_applicant(ctx: Ctx, rng: random.Random, title: str, kind: str, categories: list[int]):
    """(user_id, unit_code, club_name). Never a Service-department account.

    hos_hod_review is answered by the head of a SCHOOL the applicant belongs to.
    A department staff member belongs only to a Service unit, which has a head of
    department and no head of school, so their proposal would enter a stage with
    no possible actor and sit there for ever (stages.py::_skips_hos_hod does not
    cover that case). Applicants are therefore School people, the CFO, or a Head
    of School - all of which either have a reviewer or legitimately skip.
    """
    override = APPLICANT_OVERRIDE.get(title)
    if override and override in ctx.users_by_email:
        user_id = ctx.users_by_email[override]
        unit = fetch_unit_of(ctx, user_id)
        return user_id, unit, None

    if (5 in categories or kind in CLUB_KINDS) and ctx.club_presidents:
        user_id, club_name, school = rng.choice(ctx.club_presidents)
        return user_id, school, club_name

    schools = [s for s in ctx.students_by_school if ctx.hos_by_school.get(s)]
    school = rng.choice(schools) if schools else "school_of_computing"
    if kind in STAFF_KINDS or rng.random() < 0.42:
        pool = ctx.lecturers_by_school.get(school) or []
        if pool:
            return rng.choice(pool), school, None
    pool = ctx.students_by_school.get(school) or []
    if pool:
        return rng.choice(pool), school, None
    return ctx.hos_by_school[school], school, None


def fetch_unit_of(ctx: Ctx, user_id: int) -> str | None:
    for mapping in (ctx.hos_by_school, ):
        for unit, uid in mapping.items():
            if uid == user_id:
                return unit
    for mapping in (ctx.students_by_school, ctx.lecturers_by_school, ctx.staff_by_unit):
        for unit, ids in mapping.items():
            if user_id in ids:
                return unit
    return None


def build_specs(cat: Catalogue, ctx: Ctx, rng: random.Random, high_pax: int,
                cancel_days: int) -> list[Spec]:
    today, now = ctx.today, ctx.txn_now
    templates = list(P.EVENTS)
    rng.shuffle(templates)

    # (outcome, count, date window in days relative to today)
    recipe: list[tuple[str, int, tuple[int, int]]] = [
        ("approved", 30, (-168, -4)),      # completed, last five and a half months
        ("approved", 4, (-1, 2)),          # happening right now
        ("approved", 18, (4, 122)),        # published and still to come
        ("department_review", 11, (12, 95)),
        ("department_review", 3, (-26, -3)),   # stalled: the event has passed, the lane never closed
        ("hos_hod_review", 4, (18, 80)),
        ("fmb_review", 2, (22, 70)),
        ("cfo_review", 2, (25, 75)),
        ("resubmission_required", 3, (20, 85)),
        ("completed_rejected", 4, (-60, 70)),
        ("cancelled", 3, (cancel_days + 6, cancel_days + 70)),
        ("draft", 6, (30, 150)),
    ]

    specs: list[Spec] = []
    index = 0
    fmb_turn = 0
    for outcome, count, (low, high) in recipe:
        for _ in range(count):
            template = templates[index % len(templates)]
            title, _intro, _goals, _benefits, categories, pax, kind = template
            if index >= len(templates):
                title += REPEAT_SUFFIXES[(index // len(templates) - 1) % len(REPEAT_SUFFIXES)]
            applicant_id, applicant_unit, club = _choose_applicant(ctx, rng, template[0], kind, categories)

            offset = rng.randint(low, high)
            day = today + timedelta(days=offset)
            days = 1 if kind not in ("hackathon", "fair", "festival", "openday", "sports") else rng.randint(1, 3)
            if outcome == "approved" and low == -1:
                day, days = today - timedelta(days=1), 3        # spans today

            visibility = _pick_visibility(rng, kind, categories, club, index)
            cost = None
            if kind in PAID_KINDS and rng.random() < 0.45:
                cost = float(rng.choice([15, 25, 35, 50, 65, 80, 120]))
            registration_mode = "Manual" if cost else rng.choices(["Automatic", "Manual"], [76, 24])[0]

            requirements = list(REQUIREMENT_MIX.get(kind, ["logistics"]))
            # Transport and Campus Tour are genuinely rarer asks, but leaving
            # them only on the two or three kinds that always need them starves
            # those two departments of a workload worth looking at.
            for extra, chance in (("fundingPurchase", 0.22), ("transportation", 0.20), ("campusTour", 0.17)):
                if extra not in requirements and rng.random() < chance:
                    requirements.append(extra)
            routed = _routed_requirements(requirements)

            event_start = datetime.combine(day, datetime.min.time()) + timedelta(hours=9)
            if outcome in ("approved",):
                deadline = min(event_start - timedelta(days=1), now - timedelta(hours=2))
            elif outcome == "cancelled":
                deadline = now - timedelta(hours=6)
            else:
                deadline = now - timedelta(hours=2)
            lead_days = rng.randint(24, 78)
            submitted_at = min(deadline - timedelta(hours=12), event_start - timedelta(days=lead_days))

            stall_at = resubmit_at = None
            if outcome in ("completed_rejected", "resubmission_required"):
                stall_at = "fmb_review" if (pax > high_pax and rng.random() < 0.4) else "hos_hod_review"
            elif outcome == "approved" and rng.random() < 0.16:
                resubmit_at = "hos_hod_review"

            fmb_mode = None
            # Only a proposal that actually asked for FOOD can exercise the cafeteria flow: a water-
            # only request folds into the same F&B task, but approving it IS the fulfilment
            # (tasks.py::approve_task), so it never produces an order for a manager to accept.
            if outcome == "department_review" and "fmb" in requirements:
                fmb_mode = derive_fmb_cycle[fmb_turn % len(derive_fmb_cycle)]
                fmb_turn += 1

            # Format first, because it decides whether this event is held at a
            # university venue at all. An "offsite" template is always Off
            # Campus; everything else follows the usual mix.
            event_format = ("Off Campus" if template[6] == "offsite" else
                            rng.choices(["On Campus", "Hybrid", "Off Campus", "Online"],
                                        [78, 12, 7, 3])[0])
            external_location = (
                rng.choice(P.EXTERNAL_LOCATIONS) if event_format == "Off Campus" else None
            )
            specs.append(Spec(
                index=index, template=template, title=title,
                applicant_id=applicant_id, applicant_unit=applicant_unit,
                venue=cat.venue(rng), event_format=event_format,
                external_location=external_location, day=day, days=days,
                visibility=visibility, registration_mode=registration_mode, cost=cost,
                outcome=outcome, requirements=requirements,
                dept_modes=_plan_departments(routed, outcome, rng, fmb_mode),
                submitted_at=submitted_at, deadline=deadline,
                stall_at=stall_at, resubmit_at=resubmit_at,
                cancel_at="hos_hod_review" if index % 3 == 0 else "department_review",
                club=club,
            ))
            index += 1
    _guarantee_lane_coverage(specs, rng)
    return specs


def _guarantee_lane_coverage(specs: list[Spec], rng: random.Random) -> None:
    """Make sure every department lane has live work, not just most of them.

    Sampling gave Student Services an empty inbox and the cafeterias no order to
    accept, purely because the requirement mixes that route to them are rarer.
    Phase 8's rule is that no screen is empty unless it is meant to be, so the
    three states that back Inbox / Ongoing / Upcoming are placed deliberately per
    lane and the rest is left to the weights.
    """
    inflight = [spec for spec in specs if spec.outcome == "department_review"]
    if not inflight:
        return
    fmb = wf.constants.FMB_REQUIREMENT
    lanes = sorted(set(UNIT_FOR_REQUIREMENT) | {fmb})
    for lane in lanes:
        # The F&B lane is special: a water-only proposal owns an fmb task but
        # produces no cafeteria order, so only proposals that asked for food can
        # carry the order-level states.
        def owns(spec: Spec, lane: str = lane) -> bool:
            return "fmb" in spec.requirements if lane == fmb else lane in spec.dept_modes

        wanted = ("pending", "preparing", "assigned", "pushback") if lane == fmb \
            else ("pending", "preparing", "assigned")
        having = [spec for spec in inflight if owns(spec)]
        while len(having) < len(wanted):
            candidates = [spec for spec in inflight if not owns(spec)]
            if not candidates:
                break
            spec = rng.choice(candidates)
            if lane not in spec.requirements:
                spec.requirements.append(lane)
            spec.dept_modes[lane] = "pending"
            having.append(spec)
        for position, mode in enumerate(wanted):
            if position < len(having):
                having[position].dept_modes[lane] = mode

    for spec in inflight:
        # Re-assert the invariant the forcing above can break: a proposal whose
        # every lane can terminate would publish itself out of department review.
        if not any(mode in ("pending", "sendback") for mode in spec.dept_modes.values()):
            spec.dept_modes[rng.choice(list(spec.dept_modes))] = "pending"


def _pick_visibility(rng: random.Random, kind: str, categories: list[int], club: str | None, index: int) -> str:
    if kind in ("meeting",):
        return "Internal"
    if club and rng.random() < 0.28:
        return "Club Only"
    if index % 23 == 7:
        return "Private"
    if index % 17 == 3:
        return "Internal"
    return "Public"


# --- Payload ---------------------------------------------------------------
def make_payload(cat: Catalogue, rng: random.Random, ctx: Ctx, spec: Spec) -> dict:
    title, intro, goals, benefits, categories, pax, kind = spec.template
    first = spec.day.isoformat()
    venue_ref, venue_label = spec.venue
    # What the agenda's free-text location column says.
    where = spec.external_location or venue_label
    schedule = []
    for offset in range(spec.days):
        day = (spec.day + timedelta(days=offset)).isoformat()
        start, end = ("18:00", "22:30") if kind in ("concert", "dinner", "screening", "gaming") else ("09:00", "17:30")
        if spec.external_location:
            # Outside University: the address is free text and there is no venue
            # to reference, which is exactly the shape migration 032 converts
            # pre-existing external locations into.
            schedule.append({"date": day, "start": start, "end": end,
                             "locationKind": "outside", "location": spec.external_location})
        else:
            schedule.append({"date": day, "start": start, "end": end,
                             "locationKind": "inside", "venueId": venue_ref})

    payload: dict = {
        "eventTitle": spec.title,
        "shortIntroduction": intro,
        "goals": goals,
        "benefits": benefits,
        "applicantDepartment": ctx.unit_label.get(spec.applicant_unit or "", ""),
        "eventVisibility": spec.visibility,
        # The audience behind "Club Only".
        "eventClubs": (
            [str(ctx.club_ids_by_name[spec.club])]
            if spec.visibility == "Club Only" and spec.club in ctx.club_ids_by_name
            else []
        ),
        "registrationMode": spec.registration_mode,
        "eventFormat": spec.event_format,
        "eventImage": "/assets/events/" + IMAGE_FOR_KIND.get(kind, "campus-after-dark.jpg"),
        "totalPax": pax,
        # Mirrors the proposal form: Max Registered Pax exists for every visibility except Internal.
        "maxPax": int(pax * rng.uniform(1.0, 1.25)) if spec.visibility != "Internal" else None,
        "publicity": rng.choice([
            "Campus screens, the student portal banner and the organiser's Instagram.",
            "Email to all students, poster run in every block, and a push notification a day before.",
            "Society mailing lists plus the weekly What's On digest.",
            "Faculty announcement in class plus the departmental noticeboard.",
        ]),
        "eventCategories": categories[:2],
        "scheduleRows": schedule,
        "selectedRequirements": spec.requirements,
        "requestRows": build_requirement_rows(cat, spec.requirements, first, spec.venue, pax, rng),
    }
    if spec.cost:
        payload["costAmount"] = spec.cost
        payload["bankAccountName"] = "APU Student Activity Fund"
        payload["bankAccountNumber"] = f"5141{rng.randint(10000000, 99999999)}"

    if rng.random() < 0.5:
        payload["agenda"] = [
            {"time": "09:00", "activity": "Registration and refreshments", "location": where,
             "pic": "Organising committee", "notes": "Two desks, split by surname."},
            {"time": "09:30", "activity": "Opening address", "location": where, "pic": "Head of School"},
            {"time": "10:00", "activity": "Main programme", "location": where, "pic": "Programme lead"},
            {"time": "16:30", "activity": "Closing and group photo", "location": where, "pic": "Photography team"},
        ]
    if rng.random() < 0.35:
        payload["importantPeople"] = [
            {"name": rng.choice(["Dr. Ramesh Suppiah", "Ms. Angela Ho", "Encik Zainuddin Mahmud",
                                 "Prof. Lee Chong Wei", "Ms. Farah Nabila"]),
             "type": rng.choice(["VIP", "Speaker", "Partner", "Important Guest"]),
             "organization": rng.choice(["APU", "MDEC", "Maybank", "Intel Malaysia", "Grab"]),
             "designation": rng.choice(["Director", "Senior Manager", "Principal Engineer", "Head of Talent"])},
        ]
    if rng.random() < 0.45:
        payload["guests"] = [
            {"guestType": "Students", "count": int(pax * 0.7), "notes": "Across all four Schools."},
            {"guestType": "APU Staff", "count": max(3, int(pax * 0.1))},
        ]
        if spec.visibility == "Public":
            payload["guests"].append({"guestType": "External Guests", "count": max(2, int(pax * 0.15))})
    if rng.random() < 0.3:
        payload["discussions"] = [
            {"topic": "Wet-weather contingency for the outdoor segment"},
            {"topic": "Crowd flow between the hall and the concourse"},
        ]
    return payload


# --- Driving one proposal ---------------------------------------------------
def _reviewer_for(cur, ctx: Ctx, status: str, spec: Spec) -> Principal:
    if status == "fmb_review":
        return principal_for(cur, ctx.users_by_email["fmb@demo.apu.edu.my"])
    if status == "cfo_review":
        return principal_for(cur, ctx.users_by_email["cfo@demo.apu.edu.my"])
    unit = spec.applicant_unit
    head = ctx.hos_by_school.get(unit or "")
    if head is None:
        row = fetch_one(
            cur,
            """SELECT r.user_id FROM user_unit_roles r
                WHERE r.role_code = 'head-of-school' AND r.archived_at IS NULL
                  AND r.unit_code IN (SELECT unit_code FROM user_unit_roles
                                       WHERE user_id = %s AND unit_code IS NOT NULL)
                LIMIT 1""",
            (spec.applicant_id,),
        )
        if row is None:
            raise SystemExit(f"no HOS can review proposal from user {spec.applicant_id}")
        head = row["user_id"]
    return principal_for(cur, head)


def _walk_stages(cur, ctx: Ctx, rng: random.Random, spec: Spec, clock: Clock, rid: int) -> str:
    applicant = principal_for(cur, spec.applicant_id)
    guard = 0
    while True:
        guard += 1
        if guard > 12:
            raise SystemExit(f"stage walk did not terminate for request {rid}")
        status = status_of(cur, rid)
        if status not in STAGE_ORDER:
            return status
        if spec.outcome == status:
            return status
        reviewer = _reviewer_for(cur, ctx, status, spec)
        clock.tick()
        if spec.outcome == "cancelled" and spec.cancel_at == status:
            wf.cancel(cur, rid, applicant)
            clock.stamp()
            return "cancelled"
        if spec.outcome == "completed_rejected" and status == spec.stall_at:
            wf.reject(cur, rid, reviewer, rng.choice(REJECTION_REASONS))
            clock.stamp()
            return "completed_rejected"
        if spec.outcome == "resubmission_required" and status == spec.stall_at:
            wf.send_back(cur, rid, reviewer, rng.choice(REVIEWER_SEND_BACK))
            clock.stamp()
            return "resubmission_required"
        if spec.resubmit_at == status:
            wf.send_back(cur, rid, reviewer, rng.choice(REVIEWER_SEND_BACK))
            clock.stamp()
            clock.tick()
            wf.applicant_resubmit(cur, rid, applicant,
                                  "Updated the figures and confirmed the venue as requested. Ready for re-review.")
            clock.stamp()
            spec.resubmit_at = None
            continue
        wf.approve(cur, rid, reviewer)
        clock.stamp()


def _work_row_department(cur, ctx: Ctx, rng: random.Random, clock: Clock, rid: int, task: dict,
                         name: str, mode: str, head_id: int) -> None:
    table, pk = wf.constants.TABLE_FOR_REQUIREMENT[name]
    rows = [r["id"] for r in fetch_all(cur, f'SELECT {pk} AS id FROM {table} WHERE request_id = %s ORDER BY {pk}', (rid,))]
    if not rows:
        return
    unit = task["assigned_unit_code"]
    staff_pool = ctx.staff_by_unit.get(unit or "", [])
    if not staff_pool:
        return

    if mode == "sendback":
        clock.tick()
        wf.send_task_back(cur, rid, name, head_id, rng.choice(SEND_BACK_COMMENTS))
        clock.stamp()
        return

    clock.tick()
    low, high = CREW_SIZE.get(name, (1, 1))
    for row_id in rows:
        crew = rng.sample(staff_pool, min(len(staff_pool), rng.randint(low, high)))
        for staff_id in crew:
            wf.assign_to_row(cur, task["request_task_id"], name, row_id, staff_id, head_id)
    clock.stamp()
    if mode == "assigned":
        return

    assignments = wf.row_assignments_for_task(cur, task["request_task_id"])
    first_per_row: dict[int, dict] = {}
    for assignment in assignments:
        first_per_row.setdefault(assignment["row_id"], assignment)

    clock.tick()
    for assignment in first_per_row.values():
        wf.update_row_status(cur, assignment["request_row_assignment_id"], "preparing", assignment["staff_user_id"])
    clock.stamp()
    if mode == "preparing":
        return

    clock.tick()
    for assignment in first_per_row.values():
        wf.update_row_status(cur, assignment["request_row_assignment_id"], "completed", assignment["staff_user_id"])
    clock.stamp()


def _work_fmb(cur, ctx: Ctx, rng: random.Random, clock: Clock, rid: int, task: dict, mode: str) -> None:
    fmb_head = ctx.users_by_email["fmb@demo.apu.edu.my"]
    if mode == "sendback":
        clock.tick()
        wf.send_task_back(cur, rid, "fmb", fmb_head, rng.choice(SEND_BACK_COMMENTS))
        clock.stamp()
        return

    clock.tick()
    wf.approve_task(cur, rid, "fmb", fmb_head)
    clock.stamp()
    if wf.find_task(cur, rid, "fmb")["status"] in wf.constants.TASK_TERMINAL:
        return                                     # water only: approval was the fulfilment

    food = fetch_all(cur, "SELECT request_fmb_id, option_id, pax FROM request_fmb WHERE request_id = %s", (rid,))
    if not food:
        return
    pax = food[0]["pax"] or 30
    outlets = list(CAFETERIAS) if pax >= 150 else [rng.choice(CAFETERIAS)]
    selections: list[int] = []
    clock.tick()
    for outlet in outlets:
        menu = ctx.menu_by_unit.get(outlet)
        if not menu:
            continue
        item = rng.choice(menu)
        selection = wf.create_selection(
            cur, rid, fmb_head,
            cafeteria_unit_code=outlet, fmb_option_id=item["id"],
            quantity=max(5, pax // len(outlets)),
            notes="Delivery to the registration desk thirty minutes before serving.",
        )
        selections.append(selection["id"])
        clock.note_selection(selection["id"], "created_at")
    clock.stamp()
    if mode in ("assigned", "pushback") or not selections:
        if selections and (mode == "pushback" or rng.random() < 0.25):
            # One outlet pushes back and F&B has not answered yet: the order sits
            # in F&B's inbox, not the applicant's - a cafeteria never pushes back
            # to the organiser (see fmb.py's module comment).
            selection_id = selections[-1]
            unit_code = fetch_one(
                cur, "SELECT unit_code FROM request_fmb_selection WHERE request_fmb_selection_id = %s",
                (selection_id,),
            )["unit_code"]
            manager = ctx.cafeteria_manager.get(unit_code)
            if manager:
                clock.tick()
                wf.send_selection_back(cur, selection_id, manager, rng.choice(PUSHBACK_COMMENTS))
                clock.stamp()
        return                                     # sitting in the cafeteria manager's inbox

    for selection_id in selections:
        unit_code = fetch_one(
            cur, "SELECT unit_code FROM request_fmb_selection WHERE request_fmb_selection_id = %s", (selection_id,)
        )["unit_code"]
        manager = ctx.cafeteria_manager.get(unit_code)
        if manager is None:
            continue
        if mode == "complete" and rng.random() < 0.22:
            clock.tick()
            wf.send_selection_back(cur, selection_id, manager, rng.choice(PUSHBACK_COMMENTS))
            clock.stamp()
            clock.tick()
            wf.edit_selection(cur, selection_id, fmb_head, {"quantity": max(5, pax // len(outlets) - 10)})
            clock.stamp()
        clock.tick()
        wf.approve_selection(cur, selection_id, manager)
        clock.note_selection(selection_id, "approved_at")
        clock.stamp()
        if mode == "preparing" and rng.random() < 0.5:
            continue                               # left unclaimed in the shared pool
        staff_pool = ctx.staff_by_unit.get(unit_code, [])
        if not staff_pool:
            continue
        staff_id = rng.choice(staff_pool)
        clock.tick()
        wf.claim_selection(cur, selection_id, staff_id)
        clock.stamp()
        if mode == "preparing":
            continue
        clock.tick()
        wf.mark_selection_ready(cur, selection_id, staff_id)
        clock.note_selection(selection_id, "ready_at")
        clock.stamp()
        clock.tick()
        wf.fulfil_selection(cur, selection_id, staff_id, f"/api/v1/uploads/delivery-{selection_id}.jpg")
        clock.note_selection(selection_id, "delivered_at")
        clock.stamp()


def _work_departments(cur, ctx: Ctx, rng: random.Random, spec: Spec, clock: Clock, rid: int) -> None:
    for task in wf.tasks_for_request(cur, rid):
        if task["stage_code"] != "department_review":
            continue
        name = task["requirement_name"]
        mode = spec.dept_modes.get(name, "pending")
        if mode == "pending":
            continue
        if name == wf.constants.FMB_REQUIREMENT:
            _work_fmb(cur, ctx, rng, clock, rid, task, mode)
        elif name in ROW_ASSIGNABLE:
            head_email = HEAD_EMAIL_FOR_REQUIREMENT.get(name)
            head_id = ctx.users_by_email.get(head_email or "")
            if head_id:
                _work_row_department(cur, ctx, rng, clock, rid, task, name, mode, head_id)


def drive_proposal(cur, ctx: Ctx, cat: Catalogue, rng: random.Random, spec: Spec) -> dict:
    applicant = proposals.load_applicant(cur, spec.applicant_id)
    payload = make_payload(cat, rng, ctx, spec)
    is_draft = spec.outcome == "draft"
    request_id = proposals.create(cur, applicant, payload, draft=is_draft)

    clock = Clock(cur, request_id, spec.submitted_at, spec.deadline, rng, ctx.txn_now)
    clock.created_at = spec.submitted_at - timedelta(hours=rng.randint(4, 120))

    if is_draft:
        touched = clock.created_at + timedelta(hours=rng.randint(1, 60))
        cur.execute(
            "UPDATE request SET created_at = %s, updated_at = %s WHERE request_id = %s",
            (clock.created_at, touched, request_id),
        )
        return {"request_id": request_id, "status": "draft", "spec": spec}

    wf.submit(cur, request_id)
    clock.stamp()
    status = _walk_stages(cur, ctx, rng, spec, clock, request_id)

    # When the reviewers are done and the proposal drops into department review, the organiser starts
    # promoting it - that, not the moment the last crew finishes setting up chairs, is when people
    # actually sign up.
    opened_at = clock.at

    if status == "department_review":
        if spec.outcome == "cancelled":
            clock.tick()
            wf.cancel(cur, request_id, principal_for(cur, spec.applicant_id))
            clock.stamp()
        else:
            _work_departments(cur, ctx, rng, spec, clock, request_id)

    clock.settle()
    return {"request_id": request_id, "status": status_of(cur, request_id), "spec": spec,
            "opened_at": opened_at}


# --- Registrations ----------------------------------------------------------
REASONS_FOR_ATTENDING = [
    "I am on the organising committee for a related society.",
    "This is directly relevant to my final-year project.",
    "I want to meet the employers attending this year.",
    "My lecturer recommended it as preparation for the module assessment.",
    "I attended last year and want to bring two coursemates along.",
    "I am considering this specialisation and want to hear from practitioners.",
]


def seed_registrations(cur, ctx: Ctx, rng: random.Random, published: list[dict]) -> int:
    everyone = [uid for ids in ctx.students_by_school.values() for uid in ids]
    lecturers = [uid for ids in ctx.lecturers_by_school.values() for uid in ids]
    names = {
        r["user_id"]: (r["full_name"], r["email"])
        for r in fetch_all(cur, "SELECT user_id, full_name, email FROM users")
    }
    now = ctx.txn_now
    inserted = 0

    for event in published:
        spec: Spec = event["spec"]
        pool = list(everyone)
        if spec.visibility == "Public":
            pool += ctx.externals + lecturers
        elif spec.visibility == "Internal":
            pool = lecturers + [uid for ids in ctx.staff_by_unit.values() for uid in ids]
        elif spec.visibility == "Club Only":
            pool = [uid for uid in everyone]
        pool = [uid for uid in dict.fromkeys(pool) if uid != spec.applicant_id]
        if not pool:
            continue

        _t, _i, _g, _b, _c, pax, _k = spec.template
        wanted = int(pax * rng.uniform(0.30, 0.85))
        chosen = rng.sample(pool, min(len(pool), max(3, wanted)))

        # Registration opens when the reviewers are done and closes when the event starts (or now, for
        # one still to come).
        opened = event["opened_at"]
        event_start = datetime.combine(spec.day, datetime.min.time()) + timedelta(hours=9)
        closes = min(event_start, now)
        if closes <= opened:
            opened = closes - timedelta(hours=6)
        window = max((closes - opened).total_seconds(), 60.0)
        is_future = spec.day > ctx.today
        manual = spec.registration_mode == "Manual"

        rows = []
        for user_id in chosen:
            full_name, email = names.get(user_id, ("Registrant", f"user{user_id}@apu.edu.my"))
            registered_at = opened + timedelta(seconds=rng.uniform(0, window))
            reason = rng.choice(REASONS_FOR_ATTENDING) if manual else None
            payment_status, proof, proof_name = "not_required", None, None
            decided_by = None
            if manual:
                roll = rng.random()
                if is_future and roll < 0.20:
                    status = "pending_approval"
                elif roll < 0.30:
                    status = "rejected"
                    decided_by = spec.applicant_id
                elif roll < 0.36:
                    status = "cancelled"
                else:
                    status = "registered"
                    decided_by = spec.applicant_id
            else:
                status = "cancelled" if rng.random() < 0.07 else "registered"
            if spec.cost:
                if status == "registered":
                    payment_status = "approved"
                elif status == "pending_approval":
                    payment_status = "pending_review"
                elif status == "rejected":
                    payment_status = "rejected"
                else:
                    payment_status = "pending_review"
                proof = f"/api/v1/uploads/receipt-{event['request_id']}-{user_id}.jpg"
                proof_name = f"receipt-{user_id}.jpg"
            rows.append((event["request_id"], user_id, full_name, email, reason, status,
                         proof, proof_name, payment_status, registered_at, decided_by))

        if rows:
            psycopg2.extras.execute_values(
                cur,
                """INSERT INTO event_registration
                       (request_id, user_id, registrant_name, registrant_email, reason_for_attending,
                        status, payment_proof_url, payment_proof_file_name, payment_status,
                        registered_at, decided_by_user_id)
                   VALUES %s ON CONFLICT DO NOTHING""",
                rows,
            )
            inserted += len(rows)
    return inserted


def seed_engagement(cur, ctx: Ctx, rng: random.Random, published: list[dict]) -> tuple[int, int]:
    """Bookmarks and reminder preferences - the quiet half of the discovery pages."""
    upcoming = [e for e in published if e["spec"].day >= ctx.today]
    everyone = [uid for ids in ctx.students_by_school.values() for uid in ids]
    saved = []
    for event in upcoming:
        for user_id in rng.sample(everyone, min(len(everyone), rng.randint(2, 14))):
            saved.append((user_id, event["request_id"],
                          ctx.txn_now - timedelta(days=rng.randint(0, 40))))
    if saved:
        psycopg2.extras.execute_values(
            cur, "INSERT INTO saved_event (user_id, request_id, saved_at) VALUES %s ON CONFLICT DO NOTHING", saved
        )
    emails = [
        r["email"] for r in fetch_all(
            cur, "SELECT email FROM users WHERE email LIKE %s ORDER BY user_id", ("%@student.apu.edu.my",))
    ]
    prefs = [
        (email, rng.random() < 0.85, rng.random() < 0.9, None, None)
        for email in rng.sample(emails, min(len(emails), 45))
    ]
    if prefs:
        psycopg2.extras.execute_values(
            cur,
            """INSERT INTO notification_preference
                   (email, registration_closing_reminder, event_starting_reminder,
                    registration_closing_status, event_starting_status)
               VALUES %s ON CONFLICT (email) DO NOTHING""",
            prefs,
        )
    return len(saved), len(prefs)


# --- Phase 10: validation ---------------------------------------------------
# Each check is (name, counting SQL, repair SQL or None).
CHECKS: list[tuple[str, str, str | None]] = [
    ("approval recorded before submission",
     """SELECT count(*) AS c FROM workflow_history h JOIN request r ON r.request_id = h.request_id
         WHERE r.submitted_at IS NOT NULL AND h.action <> 'submit' AND h.created_at < r.submitted_at""",
     """UPDATE workflow_history h SET created_at = r.submitted_at + interval '1 minute'
          FROM request r WHERE r.request_id = h.request_id AND r.submitted_at IS NOT NULL
           AND h.action <> 'submit' AND h.created_at < r.submitted_at"""),

    ("proposal submitted before it was created",
     "SELECT count(*) AS c FROM request WHERE submitted_at IS NOT NULL AND submitted_at < created_at",
     "UPDATE request SET created_at = submitted_at - interval '2 hours' "
     "WHERE submitted_at IS NOT NULL AND submitted_at < created_at"),

    ("proposal updated before it was created",
     "SELECT count(*) AS c FROM request WHERE updated_at < created_at",
     "UPDATE request SET updated_at = created_at WHERE updated_at < created_at"),

    ("department task created before the proposal was submitted",
     """SELECT count(*) AS c FROM request_task t JOIN request r ON r.request_id = t.request_id
         WHERE r.submitted_at IS NOT NULL AND t.created_at < r.submitted_at""",
     """UPDATE request_task t SET created_at = r.submitted_at + interval '1 minute'
          FROM request r WHERE r.request_id = t.request_id
           AND r.submitted_at IS NOT NULL AND t.created_at < r.submitted_at"""),

    ("task resolved before it was created",
     "SELECT count(*) AS c FROM request_task WHERE resolved_at IS NOT NULL AND resolved_at < created_at",
     "UPDATE request_task SET resolved_at = created_at + interval '1 hour' "
     "WHERE resolved_at IS NOT NULL AND resolved_at < created_at"),

    ("staff assigned before the task existed",
     """SELECT count(*) AS c FROM request_row_assignment a JOIN request_task t
             ON t.request_task_id = a.request_task_id
         WHERE a.assigned_at < t.created_at""",
     """UPDATE request_row_assignment a SET assigned_at = t.created_at + interval '30 minutes'
          FROM request_task t WHERE t.request_task_id = a.request_task_id AND a.assigned_at < t.created_at"""),

    ("row completed before it was assigned",
     "SELECT count(*) AS c FROM request_row_assignment WHERE resolved_at IS NOT NULL AND resolved_at < assigned_at",
     "UPDATE request_row_assignment SET resolved_at = assigned_at + interval '1 hour' "
     "WHERE resolved_at IS NOT NULL AND resolved_at < assigned_at"),

    ("cafeteria order accepted before it was placed",
     "SELECT count(*) AS c FROM request_fmb_selection WHERE approved_at IS NOT NULL AND created_at IS NOT NULL "
     "AND approved_at < created_at",
     "UPDATE request_fmb_selection SET approved_at = created_at + interval '2 hours' "
     "WHERE approved_at IS NOT NULL AND created_at IS NOT NULL AND approved_at < created_at"),

    ("cafeteria order ready before it was accepted",
     "SELECT count(*) AS c FROM request_fmb_selection WHERE ready_at IS NOT NULL AND approved_at IS NOT NULL "
     "AND ready_at < approved_at",
     "UPDATE request_fmb_selection SET ready_at = approved_at + interval '3 hours' "
     "WHERE ready_at IS NOT NULL AND approved_at IS NOT NULL AND ready_at < approved_at"),

    ("cafeteria order delivered before it was ready",
     "SELECT count(*) AS c FROM request_fmb_selection WHERE delivered_at IS NOT NULL AND ready_at IS NOT NULL "
     "AND delivered_at < ready_at",
     "UPDATE request_fmb_selection SET delivered_at = ready_at + interval '45 minutes' "
     "WHERE delivered_at IS NOT NULL AND ready_at IS NOT NULL AND delivered_at < ready_at"),

    ("registration recorded before the event was approved",
     """SELECT count(*) AS c FROM event_registration er JOIN request r ON r.request_id = er.request_id
         WHERE r.status = 'completed_approved' AND er.registered_at < r.submitted_at""",
     """UPDATE event_registration er SET registered_at = r.updated_at
          FROM request r WHERE r.request_id = er.request_id
           AND r.status = 'completed_approved' AND er.registered_at < r.submitted_at"""),

    ("registration recorded after the event finished",
     """SELECT count(*) AS c FROM event_registration er
         WHERE er.registered_at::date >
               (SELECT max(s."date") + 1 FROM event_schedule s WHERE s.request_id = er.request_id)""",
     # GREATEST, not a bare subtraction: pulling a late registration back to the day before the event
     # pushes it before the proposal was even submitted whenever the event was approved within a day
     # of running, which just trades one broken ordering for another.
     """UPDATE event_registration er
           SET registered_at = GREATEST(
                   (SELECT min(s."date") FROM event_schedule s
                     WHERE s.request_id = er.request_id)::timestamp - interval '18 hours',
                   COALESCE(r.submitted_at, er.registered_at) + interval '1 hour')
          FROM request r
         WHERE r.request_id = er.request_id
           AND er.registered_at::date >
               (SELECT max(s."date") + 1 FROM event_schedule s WHERE s.request_id = er.request_id)"""),

    ("timestamp in the future",
     """SELECT count(*) AS c FROM workflow_history WHERE created_at > now() + interval '1 minute'""",
     "UPDATE workflow_history SET created_at = now() - interval '1 hour' "
     "WHERE created_at > now() + interval '1 minute'"),

    # --- structural rules: reported, never auto-patched ---------------------
    ("published event with an unfinished department task",
     """SELECT count(*) AS c FROM request r
         WHERE r.status = 'completed_approved'
           AND EXISTS (SELECT 1 FROM request_task t WHERE t.request_id = r.request_id
                         AND t.status NOT IN ('completed','cancelled'))""", None),

    ("proposal in department review with no task at all",
     """SELECT count(*) AS c FROM request r
         WHERE r.status = 'department_review'
           AND NOT EXISTS (SELECT 1 FROM request_task t WHERE t.request_id = r.request_id)""", None),

    ("published event with no scheduled date",
     """SELECT count(*) AS c FROM request r
         WHERE r.status = 'completed_approved'
           AND NOT EXISTS (SELECT 1 FROM event_schedule s WHERE s.request_id = r.request_id)""", None),

    ("staff assigned to a row outside the routed department",
     """SELECT count(*) AS c FROM request_row_assignment a
             JOIN request_task t ON t.request_task_id = a.request_task_id
        WHERE t.assigned_unit_code IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM user_unit_roles r
                           WHERE r.user_id = a.staff_user_id AND r.unit_code = t.assigned_unit_code)""", None),

    ("cafeteria order placed against another outlet's menu",
     """SELECT count(*) AS c FROM request_fmb_selection s JOIN fmb_options o ON o.fmb_option_id = s.fmb_option_id
         WHERE o.unit_code <> s.unit_code""", None),

    ("task routed to neither a unit nor a flat role",
     """SELECT count(*) AS c FROM request_task
         WHERE assigned_unit_code IS NULL AND assigned_role NOT IN ('cfo','fmb')""", None),

    ("proposal awaiting HOS/HOD review with no possible reviewer",
     """SELECT count(*) AS c FROM request r
         WHERE r.status = 'hos_hod_review'
           AND NOT EXISTS (
                SELECT 1 FROM user_unit_roles mine
                  JOIN user_unit_roles theirs ON theirs.unit_code = mine.unit_code
                 WHERE mine.user_id = r.applicant_user_id
                   AND theirs.role_code = 'head-of-school'
                   AND theirs.user_id <> r.applicant_user_id)""", None),

    ("confirmed registrations above the organiser's capacity cap",
     """SELECT count(*) AS c FROM request r WHERE r.max_pax IS NOT NULL AND r.max_pax > 0
          AND (SELECT count(*) FROM event_registration er
                WHERE er.request_id = r.request_id AND er.status = 'registered') > r.max_pax""", None),
]


def validate(cur, *, repair: bool) -> list[tuple[str, int, int]]:
    """Run every check. Returns (name, found, repaired) for anything non-zero."""
    findings: list[tuple[str, int, int]] = []
    for name, count_sql, fix_sql in CHECKS:
        found = fetch_one(cur, count_sql)["c"]
        repaired = 0
        if found and fix_sql and repair:
            cur.execute(fix_sql)
            repaired = cur.rowcount
            found = fetch_one(cur, count_sql)["c"]
        if found or repaired:
            findings.append((name, found, repaired))
    return findings


# --- Phase 8: prove every screen has something on it ------------------------
# (role, screen, SQL returning one column `c`).
COVERAGE: list[tuple[str, str, str]] = [
    ("Applicant", "Inbox (changes requested)", """
        SELECT count(*) AS c FROM request r WHERE r.status = 'resubmission_required'
            OR EXISTS (SELECT 1 FROM request_task t WHERE t.request_id = r.request_id
                        AND t.stage_code = 'department_review' AND t.status = 'resubmitted')"""),
    ("Applicant", "Ongoing (in review)", """
        SELECT count(*) AS c FROM request
         WHERE status IN ('submitted','hos_hod_review','fmb_review','cfo_review','department_review')"""),
    ("Applicant", "Drafts", "SELECT count(*) AS c FROM request WHERE status = 'draft'"),
    ("Applicant", "History (approved)", "SELECT count(*) AS c FROM request WHERE status = 'completed_approved'"),
    ("Applicant", "History (rejected)", "SELECT count(*) AS c FROM request WHERE status = 'completed_rejected'"),
    ("Applicant", "History (cancelled)", "SELECT count(*) AS c FROM request WHERE status = 'cancelled'"),
    ("Applicant", "Pending registration approvals", """
        SELECT count(*) AS c FROM event_registration WHERE status = 'pending_approval'"""),

    ("Head of School", "Inbox (HOS/HOD review)",
     "SELECT count(*) AS c FROM request WHERE status = 'hos_hod_review'"),
    ("F&B head", "Inbox (F&B review stage)",
     "SELECT count(*) AS c FROM request WHERE status = 'fmb_review'"),
    ("F&B head", "Inbox (food tasks awaiting decision)", """
        SELECT count(*) AS c FROM request_task WHERE assigned_role = 'fmb' AND status = 'pending'"""),
    ("F&B head", "Inbox (orders pushed back by an outlet)", """
        SELECT count(*) AS c FROM request_fmb_selection WHERE status = 'resubmitted'"""),
    ("CFO", "Inbox (CFO review stage)",
     "SELECT count(*) AS c FROM request WHERE status = 'cfo_review'"),

    ("Cafeteria manager", "Inbox (orders to accept)",
     "SELECT count(*) AS c FROM request_fmb_selection WHERE status = 'pending'"),
    ("Cafeteria manager", "Ongoing (accepted / in the kitchen)", """
        SELECT count(*) AS c FROM request_fmb_selection
         WHERE status IN ('approved','preparing','ready','resubmitted')"""),
    ("Cafeteria manager", "History (delivered / cancelled)", """
        SELECT count(*) AS c FROM request_fmb_selection WHERE status IN ('fulfilled','cancelled')"""),
    ("Cafeteria staff", "Shared pool (unclaimed)",
     "SELECT count(*) AS c FROM request_fmb_selection WHERE status = 'approved'"),
    ("Cafeteria staff", "Claimed (preparing / ready)", """
        SELECT count(*) AS c FROM request_fmb_selection WHERE status IN ('preparing','ready')"""),

    ("Staff", "My tasks - active", """
        SELECT count(*) AS c FROM request_row_assignment WHERE status IN ('assigned','preparing')"""),
    ("Staff", "My tasks - overdue (date passed, not done)", """
        SELECT count(*) AS c FROM request_row_assignment a
          JOIN request_task t ON t.request_task_id = a.request_task_id
          JOIN request r ON r.request_id = t.request_id
         WHERE a.status <> 'completed'
           AND (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) < current_date"""),
    ("Staff", "My tasks - history", """
        SELECT count(*) AS c FROM request_row_assignment WHERE status = 'completed'"""),

    ("Everyone", "Explore - upcoming published events", """
        SELECT count(*) AS c FROM request r
         WHERE r.status = 'completed_approved' AND r.event_visibility IN ('Public','Club Only')
           AND (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) >= current_date"""),
    ("Everyone", "Explore - past published events", """
        SELECT count(*) AS c FROM request r
         WHERE r.status = 'completed_approved' AND r.event_visibility IN ('Public','Club Only')
           AND (SELECT max(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) < current_date"""),
    ("Everyone", "Explore - running today", """
        SELECT count(*) AS c FROM request r
         WHERE r.status = 'completed_approved' AND r.event_visibility IN ('Public','Club Only')
           AND (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) <= current_date
           AND (SELECT max(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) >= current_date"""),
    ("Everyone", "My registrations", "SELECT count(*) AS c FROM event_registration WHERE status = 'registered'"),
    ("Everyone", "Saved events", "SELECT count(*) AS c FROM saved_event"),

    ("Club president", "Inbox (join requests)",
     "SELECT count(*) AS c FROM club_join_requests WHERE status = 'pending'"),
    ("Club president", "History (decided join requests)",
     "SELECT count(*) AS c FROM club_join_requests WHERE status <> 'pending'"),
    ("Club admin", "Inbox (president handovers)",
     "SELECT count(*) AS c FROM club_president_change_requests WHERE status = 'pending'"),
    ("Club admin", "Clubs with no events yet", """
        SELECT count(*) AS c FROM clubs c
         WHERE c.archived_at IS NULL AND c.active
           AND NOT EXISTS (SELECT 1 FROM request r WHERE r.applicant_user_id = c.user_id)"""),
]

DEPARTMENT_BUCKETS = (
    ("Inbox", "t.status = 'pending'"),
    ("Ongoing", "t.status IN ('approved','preparing','resubmitted')"),
    ("History", "t.status IN ('completed','cancelled')"),
)


def coverage(cur) -> int:
    """Print one line per screen. Returns how many came back empty."""
    print("\n" + "=" * 78)
    print("SCREEN COVERAGE")
    print("=" * 78)
    empty = 0
    for role, screen, sql in COVERAGE:
        count = fetch_one(cur, sql)["c"]
        if not count:
            empty += 1
        print(f"  {'EMPTY' if not count else '  ok ':<6} {role:<19} {screen:<44} {count:>5}")

    print("  " + "-" * 74)
    for row in fetch_all(
        cur, "SELECT DISTINCT COALESCE(assigned_unit_code, 'role:' || assigned_role) AS lane "
             "FROM request_task ORDER BY 1"):
        lane = row["lane"]
        where = ("t.assigned_role = %s" if lane.startswith("role:") else "t.assigned_unit_code = %s")
        key = lane.split(":", 1)[1] if lane.startswith("role:") else lane
        counts = []
        for label, clause in DEPARTMENT_BUCKETS:
            count = fetch_one(cur, f"SELECT count(*) AS c FROM request_task t WHERE {where} AND {clause}", (key,))["c"]
            if not count:
                empty += 1
            counts.append((label, count))
        marker = "EMPTY" if any(c == 0 for _, c in counts) else "  ok "
        detail = "  ".join(f"{label}={count}" for label, count in counts)
        print(f"  {marker:<6} {'Department':<19} {lane:<44} {detail}")
    return empty


def summarise(cur) -> None:
    print("\n" + "=" * 78)
    print("DATASET SUMMARY")
    print("=" * 78)
    rows = fetch_all(cur, "SELECT status, count(*) AS c FROM request GROUP BY 1 ORDER BY 1")
    print("\nProposals by status")
    for row in rows:
        print(f"  {row['status']:<26} {row['c']:>5}")

    print("\nPublished events by window")
    for label, clause in (
        ("completed (past)", 'max_day < current_date'),
        ("running now", 'min_day <= current_date AND max_day >= current_date'),
        ("upcoming", 'min_day > current_date'),
    ):
        row = fetch_one(cur, f"""
            SELECT count(*) AS c FROM (
                SELECT r.request_id,
                       (SELECT min(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) AS min_day,
                       (SELECT max(s."date") FROM event_schedule s WHERE s.request_id = r.request_id) AS max_day
                  FROM request r WHERE r.status = 'completed_approved') e
             WHERE {clause}""")
        print(f"  {label:<26} {row['c']:>5}")
    row = fetch_one(cur, """SELECT count(*) AS c FROM request
                             WHERE status = 'completed_approved'
                               AND event_visibility IN ('Public','Club Only')""")
    print(f"  {'guest-visible total':<26} {row['c']:>5}")

    print("\nDepartment tasks by unit and status")
    for row in fetch_all(cur, """
            SELECT COALESCE(t.assigned_unit_code, 'role:' || t.assigned_role) AS lane,
                   t.status, count(*) AS c
              FROM request_task t GROUP BY 1, 2 ORDER BY 1, 2"""):
        print(f"  {row['lane']:<28} {row['status']:<12} {row['c']:>4}")

    print("\nStaff workload (open row assignments)")
    for row in fetch_all(cur, """
            SELECT u.full_name, t.assigned_unit_code AS unit,
                   count(*) FILTER (WHERE a.status = 'assigned')  AS assigned,
                   count(*) FILTER (WHERE a.status = 'preparing') AS preparing,
                   count(*) FILTER (WHERE a.status = 'completed') AS completed
              FROM request_row_assignment a
              JOIN request_task t ON t.request_task_id = a.request_task_id
              JOIN users u ON u.user_id = a.staff_user_id
          GROUP BY 1, 2 ORDER BY 2, 1"""):
        print(f"  {row['full_name']:<22} {row['unit'] or '':<26} "
              f"assigned={row['assigned']:<3} preparing={row['preparing']:<3} completed={row['completed']}")

    print("\nCafeteria orders by outlet and status")
    for row in fetch_all(cur, """
            SELECT s.unit_code, s.status, count(*) AS c
              FROM request_fmb_selection s GROUP BY 1, 2 ORDER BY 1, 2"""):
        print(f"  {row['unit_code']:<34} {row['status']:<12} {row['c']:>4}")

    print("\nRegistrations by status")
    for row in fetch_all(cur, """
            SELECT status, payment_status, count(*) AS c
              FROM event_registration GROUP BY 1, 2 ORDER BY 1, 2"""):
        print(f"  {row['status']:<18} payment={row['payment_status']:<14} {row['c']:>5}")

    print("\nClubs by event volume")
    for row in fetch_all(cur, """
            SELECT c.club_name,
                   (SELECT count(*) FROM club_members m WHERE m.club_id = c.club_id) AS members,
                   (SELECT count(*) FROM request r WHERE r.applicant_user_id = c.user_id) AS proposals
              FROM clubs c WHERE c.archived_at IS NULL AND c.active ORDER BY 3 DESC, 1"""):
        print(f"  {row['club_name']:<36} members={row['members']:<4} proposals={row['proposals']}")

    print("\nOther volumes")
    for table in ("users", "clubs", "club_members", "club_join_requests",
                  "club_president_change_requests", "event_registration", "saved_event",
                  "request_task", "request_row_assignment", "request_fmb_selection",
                  "workflow_history"):
        print(f"  {table:<32} {fetch_one(cur, f'SELECT count(*) AS c FROM {table}')['c']:>6}")


# --- Entry point ------------------------------------------------------------
def run(*, dry_run: bool, seed: int, password: str) -> None:
    rng = random.Random(seed)
    with transaction() as cur:
        high_pax = int(wf.constants.high_pax_threshold(cur))
        cancel_days = wf.constants.cancellation_deadline_days(cur)
        log.info("seed.config", extra={"high_pax": high_pax, "cancel_days": cancel_days})

        ctx = seed_organisation(cur, rng, hash_password(password))
        seed_clubs(cur, ctx, rng)
        club_requests = seed_club_requests(cur, ctx, rng)
        cat = Catalogue(cur)
        print(f"organisation ready: {len(ctx.users_by_email)} accounts, "
              f"{len(ctx.club_presidents)} club presidents, {club_requests} club requests")

        specs = build_specs(cat, ctx, rng, high_pax, cancel_days)
        published: list[dict] = []
        by_status: dict[str, int] = {}
        for number, spec in enumerate(specs, start=1):
            result = drive_proposal(cur, ctx, cat, rng, spec)
            by_status[result["status"]] = by_status.get(result["status"], 0) + 1
            if result["status"] == "completed_approved":
                published.append(result)
            if number % 10 == 0 or number == len(specs):
                print(f"  proposals {number}/{len(specs)}")
        print("  by status: " + ", ".join(f"{k}={v}" for k, v in sorted(by_status.items())))

        registrations = seed_registrations(cur, ctx, rng, published)
        saved, prefs = seed_engagement(cur, ctx, rng, published)
        print(f"  registrations={registrations} saved={saved} reminderPrefs={prefs}")

        findings = validate(cur, repair=True)
        print("\n" + "=" * 78)
        print("VALIDATION")
        print("=" * 78)
        if not findings:
            print("  all checks clean")
        for name, remaining, repaired in findings:
            marker = "FIXED " if repaired and not remaining else "FAIL  "
            print(f"  {marker}{name}: repaired={repaired} remaining={remaining}")

        empty = coverage(cur)
        if empty:
            print(f"\n  {empty} screen(s) came back empty - see the EMPTY rows above.")
        summarise(cur)
        if dry_run:
            raise _Rollback()


class _Rollback(Exception):
    """Raised at the end of a --dry-run so transaction() rolls everything back."""


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed a production-like EMS dataset.")
    parser.add_argument("--dry-run", action="store_true", help="build everything, then roll back")
    parser.add_argument("--seed", type=int, default=20260829, help="RNG seed (same seed, same dataset)")
    parser.add_argument("--password", default=None, help="password for accounts this run creates")
    parser.add_argument("--validate-only", action="store_true", help="run the Phase 10 checks and exit")
    parser.add_argument("--repair", action="store_true",
                        help="with --validate-only, apply the repairs instead of only reporting")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    config.validate()
    init_pool()

    if args.validate_only:
        with transaction() as cur:
            findings = validate(cur, repair=args.repair)
            if not findings:
                print("all checks clean")
            for name, remaining, repaired in findings:
                marker = "FIXED" if repaired and not remaining else "FAIL "
                print(f"  {marker} {name}: repaired={repaired} remaining={remaining}")
            coverage(cur)
            summarise(cur)
        return

    password = args.password or config_demo_password()
    try:
        run(dry_run=args.dry_run, seed=args.seed, password=password)
    except _Rollback:
        print("\n--dry-run: everything above was rolled back.")


def config_demo_password() -> str:
    """New accounts share the existing demo password so the login picker keeps working."""
    import os
    return os.environ.get("DEMO_PASSWORD") or "Demo-EMS-2026"


if __name__ == "__main__":
    main()

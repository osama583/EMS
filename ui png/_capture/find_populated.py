"""Finds demo accounts that actually have rows behind the pages that came back
empty, so those figures can be re-shot against real data instead of an empty
state. Read-only: SELECTs only.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path("C:/Users/natsu/Desktop/Osama/backend")))
os.chdir("C:/Users/natsu/Desktop/Osama/backend")

import psycopg2 as psycopg
from dotenv import load_dotenv

load_dotenv(".env")
DSN = os.environ["DATABASE_URL"]

QUERIES: list[tuple[str, str]] = [
    ("Saved events - who has the most", """
        SELECT u.email, count(*) AS saved
        FROM saved_event s JOIN users u ON u.user_id = s.user_id
        GROUP BY u.email ORDER BY saved DESC LIMIT 5
    """),
    ("Open department tasks by unit and date", """
        SELECT t.assigned_unit_code, count(*) AS open_tasks
        FROM request_task t
        WHERE t.status NOT IN ('approved','completed','cancelled')
        GROUP BY t.assigned_unit_code ORDER BY open_tasks DESC LIMIT 8
    """),
    ("Completed tasks by unit", """
        SELECT t.assigned_unit_code, count(*) AS done
        FROM request_task t
        WHERE t.status IN ('approved','completed')
        GROUP BY t.assigned_unit_code ORDER BY done DESC LIMIT 8
    """),
    ("Pending event registrations - by event owner", """
        SELECT u.email AS organiser, count(*) AS pending
        FROM event_registration r
        JOIN request q ON q.request_id = r.request_id
        JOIN users u ON u.user_id = q.applicant_user_id
        WHERE r.status = 'pending'
        GROUP BY u.email ORDER BY pending DESC LIMIT 5
    """),
    ("Pending club join requests - by club", """
        SELECT c.club_name, u.email AS president, count(*) AS pending
        FROM club_join_requests j
        JOIN clubs c ON c.club_id = j.club_id
        LEFT JOIN users u ON u.user_id = c.user_id
        WHERE j.status = 'pending'
        GROUP BY c.club_name, u.email ORDER BY pending DESC LIMIT 5
    """),
    ("Cafeteria order selections by unit and status", """
        SELECT s.unit_code, s.status, count(*) AS n
        FROM request_fmb_selection s
        GROUP BY s.unit_code, s.status ORDER BY n DESC LIMIT 10
    """),
    ("Task dates that actually have open tasks", """
        SELECT t.assigned_unit_code, e.date, count(*) AS n
        FROM request_task t
        JOIN event_schedule e ON e.request_id = t.request_id
        WHERE t.status NOT IN ('approved','completed','cancelled')
        GROUP BY t.assigned_unit_code, e.date
        ORDER BY n DESC LIMIT 10
    """),
]

with psycopg.connect(DSN) as conn:
    for title, sql in QUERIES:
        print(f"\n=== {title} ===")
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
                cols = [d[0] for d in cur.description]
                rows = cur.fetchall()
                if not rows:
                    print("   (no rows)")
                for row in rows:
                    print("   " + " | ".join(f"{c}={v}" for c, v in zip(cols, row)))
        except Exception as exc:  # keep going; one bad query should not stop the rest
            print(f"   query failed: {str(exc).splitlines()[0][:120]}")
            conn.rollback()

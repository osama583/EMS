"""The approval gate: a department cannot approve while some of the rows it was
asked to fulfil still have nobody - and, for F&B, no cafeteria order - on them.

Approving with rows left over used to be possible from either side (the five
row-assignable departments approve implicitly by assigning; F&B approves
explicitly), and the proposal then sat in that department's inbox with the task
already marked approved and no action left that could move it on.

Every test here works inside a rolled-back transaction, so it can delete and
insert against the real seed without changing it.
"""
from __future__ import annotations

import psycopg2.extras
import pytest

from app.db import fetch_all, fetch_one, get_connection
from app.errors import WorkflowError
from app.services.workflow import tasks
from app.services.workflow.constants import SEL_CANCELLED


@pytest.fixture
def cur():
    """A cursor whose work is always rolled back."""
    with get_connection() as conn:
        cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        try:
            yield cursor
        finally:
            conn.rollback()


def _request_with_several_rows(cur, table: str, pk: str, requirement: str) -> tuple[int, list[int]]:
    """A proposal that asked for more than one of `requirement` - the case the
    gate exists for. Skips rather than fails if the seed has no such proposal:
    the rule is still right, there is just nothing here to try it on."""
    found = fetch_one(
        cur,
        f"""SELECT d.request_id FROM {table} d
             WHERE EXISTS (SELECT 1 FROM request_task t
                             JOIN event_requirements er ON er.requirement_id = t.requirement_id
                            WHERE t.request_id = d.request_id AND er.requirement_name = %s)
             GROUP BY d.request_id HAVING count(*) > 1 LIMIT 1""",
        (requirement,),
    )
    if found is None:
        pytest.skip(f"No proposal in this database asks for more than one {requirement} row.")
    request_id = found["request_id"]
    rows = [
        r[pk]
        for r in fetch_all(cur, f"SELECT {pk} FROM {table} WHERE request_id = %s ORDER BY {pk}", (request_id,))
    ]
    return request_id, rows


def test_staffing_one_row_of_several_does_not_allocate_the_rest(cur):
    request_id, rows = _request_with_several_rows(
        cur, "request_logistics", "request_logistics_id", "logistics"
    )
    task = fetch_one(
        cur,
        """SELECT t.request_task_id FROM request_task t
             JOIN event_requirements er ON er.requirement_id = t.requirement_id
            WHERE t.request_id = %s AND er.requirement_name = 'logistics'""",
        (request_id,),
    )
    staff = fetch_one(cur, "SELECT user_id FROM users ORDER BY user_id LIMIT 1")

    cur.execute(
        "DELETE FROM request_row_assignment WHERE requirement_name = 'logistics' AND row_id = ANY(%s)",
        (rows,),
    )
    assert tasks.unallocated_row_count(cur, request_id, "logistics") == len(rows)

    cur.execute(
        """INSERT INTO request_row_assignment
               (request_task_id, requirement_name, row_id, staff_user_id, assigned_by_user_id)
           VALUES (%s, 'logistics', %s, %s, %s)""",
        (task["request_task_id"], rows[0], staff["user_id"], staff["user_id"]),
    )
    # The bug in one line: one row staffed, the rest still nobody's job.
    assert tasks.unallocated_row_count(cur, request_id, "logistics") == len(rows) - 1

    with pytest.raises(WorkflowError, match="nobody assigned"):
        tasks.assert_work_allocated(cur, request_id, "logistics")


def test_a_fully_staffed_department_may_approve(cur):
    request_id, rows = _request_with_several_rows(
        cur, "request_logistics", "request_logistics_id", "logistics"
    )
    task = fetch_one(
        cur,
        """SELECT t.request_task_id FROM request_task t
             JOIN event_requirements er ON er.requirement_id = t.requirement_id
            WHERE t.request_id = %s AND er.requirement_name = 'logistics'""",
        (request_id,),
    )
    staff = fetch_one(cur, "SELECT user_id FROM users ORDER BY user_id LIMIT 1")
    cur.execute(
        "DELETE FROM request_row_assignment WHERE requirement_name = 'logistics' AND row_id = ANY(%s)",
        (rows,),
    )
    for row_id in rows:
        cur.execute(
            """INSERT INTO request_row_assignment
                   (request_task_id, requirement_name, row_id, staff_user_id, assigned_by_user_id)
               VALUES (%s, 'logistics', %s, %s, %s)""",
            (task["request_task_id"], row_id, staff["user_id"], staff["user_id"]),
        )
    assert tasks.unallocated_row_count(cur, request_id, "logistics") == 0
    tasks.assert_work_allocated(cur, request_id, "logistics")  # does not raise


def test_a_food_row_with_no_live_order_blocks_the_fmb_approval(cur):
    request_id, rows = _request_with_several_rows(cur, "request_fmb", "request_fmb_id", "fmb")
    cur.execute(
        "DELETE FROM request_fmb_selection WHERE request_fmb_id = ANY(%s)", (rows,)
    )
    assert tasks.unallocated_row_count(cur, request_id, "fmb") == len(rows)
    with pytest.raises(WorkflowError, match="no cafeteria order"):
        tasks.assert_work_allocated(cur, request_id, "fmb")


def test_a_cancelled_order_leaves_its_food_row_unfulfilled(cur):
    """The precise failure the fix is for: ordering against ONE row used to make
    the whole request look covered, because every order landed on the first row."""
    request_id, rows = _request_with_several_rows(cur, "request_fmb", "request_fmb_id", "fmb")
    cur.execute("DELETE FROM request_fmb_selection WHERE request_fmb_id = ANY(%s)", (rows,))
    menu_item = fetch_one(cur, "SELECT fmb_option_id, label FROM fmb_options LIMIT 1")
    cafeteria = fetch_one(cur, "SELECT code FROM unit WHERE code LIKE 'cafeteria%%' LIMIT 1")
    if menu_item is None or cafeteria is None:
        pytest.skip("No menu item or cafeteria in this database to place an order with.")

    def place(row_id: int, status: str) -> None:
        cur.execute(
            """INSERT INTO request_fmb_selection
                   (request_fmb_id, unit_code, fmb_option_id, menu_item_label, quantity, status)
               VALUES (%s, %s, %s, %s, 10, %s)""",
            (row_id, cafeteria["code"], menu_item["fmb_option_id"], menu_item["label"], status),
        )

    place(rows[0], "pending")
    assert tasks.unallocated_row_count(cur, request_id, "fmb") == len(rows) - 1

    for row_id in rows[1:]:
        place(row_id, "pending")
    assert tasks.unallocated_row_count(cur, request_id, "fmb") == 0

    # Cancelling a row's only order puts that row back to unfulfilled, which is what it is.
    cur.execute(
        "UPDATE request_fmb_selection SET status = %s WHERE request_fmb_id = %s",
        (SEL_CANCELLED, rows[0]),
    )
    assert tasks.unallocated_row_count(cur, request_id, "fmb") == 1

"""The authenticated actor, resolved from the database on every request.

Roles live in `user_unit_roles`, one row per (user, unit, role). A row with
unit_code NULL is a flat role (cfo, system-admin, ...); a row with a unit_code
is unit-scoped (head-of-school @ school_of_computing).

Deliberately re-read per request rather than carried in the JWT: an admin who
revokes a role expects it to take effect now, not when the actor's access
token happens to expire.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from flask import g

from ..db import query, query_one
from ..errors import Unauthorized

# Heading a unit means holding either head role on it. "Manager" in the workflow
# rules (F&B manager, department manager) resolves to exactly this.
HEAD_ROLE_CODES = ("head-of-school", "head-of-department")


@dataclass(frozen=True)
class Principal:
    user_id: int
    full_name: str
    username: str
    email: str
    is_active: bool
    # (role_code, unit_code | None) pairs, exactly as stored.
    assignments: tuple[tuple[str, str | None], ...] = ()
    profile: dict[str, Any] = field(default_factory=dict)

    @property
    def role_codes(self) -> frozenset[str]:
        return frozenset(role for role, _ in self.assignments)

    @property
    def unit_codes(self) -> frozenset[str]:
        return frozenset(unit for _, unit in self.assignments if unit)

    def has_role(self, *role_codes: str) -> bool:
        return bool(self.role_codes & frozenset(role_codes))

    def has_role_in_unit(self, role_code: str, unit_code: str) -> bool:
        return (role_code, unit_code) in self.assignments

    def units_for_role(self, role_code: str) -> frozenset[str]:
        return frozenset(unit for role, unit in self.assignments if role == role_code and unit)

    def heads_unit(self, unit_code: str | None) -> bool:
        if not unit_code:
            return False
        return any(role in HEAD_ROLE_CODES and unit == unit_code for role, unit in self.assignments)

    @property
    def headed_units(self) -> frozenset[str]:
        return frozenset(unit for role, unit in self.assignments if role in HEAD_ROLE_CODES and unit)

    @property
    def is_admin(self) -> bool:
        return self.has_role("system-admin")

    @property
    def is_external(self) -> bool:
        return self.has_role("external-user")


_USER_SQL = """
    SELECT user_id, full_name, username, email, is_active, archived_at
      FROM users
     WHERE user_id = %s
"""

_ASSIGNMENTS_SQL = """
    SELECT uur.role_code, uur.unit_code
      FROM user_unit_roles uur
      JOIN role r ON r.role_code = uur.role_code
     WHERE uur.user_id = %s
       AND r.archived_at IS NULL
       AND r.is_active
"""


def load_principal(user_id: int) -> Principal:
    row = query_one(_USER_SQL, (user_id,))
    if row is None or row["archived_at"] is not None:
        raise Unauthorized("Your account no longer exists.", code="account_missing")
    if not row["is_active"]:
        raise Unauthorized("Your account has been deactivated.", code="account_inactive")

    assignments = tuple(
        (item["role_code"], item["unit_code"]) for item in query(_ASSIGNMENTS_SQL, (user_id,))
    )
    return Principal(
        user_id=row["user_id"],
        full_name=row["full_name"],
        username=row["username"],
        email=row["email"],
        is_active=row["is_active"],
        assignments=assignments,
    )


def current_principal() -> Principal:
    principal = getattr(g, "principal", None)
    if principal is None:
        raise Unauthorized("Authentication is required.")
    return principal

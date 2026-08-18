"""Request options - the manager-configured dropdown catalogues.

Eleven catalogues live in eleven tables with near-identical shapes. Rather than
eleven near-duplicate blueprints, one generic resource keyed by `kind`:

    GET    /options?kind=logistics        list one catalogue
    GET    /options/{kind}/{id}           one option
    POST   /options/{kind}                create   (owning department head)
    PATCH  /options/{kind}/{id}           update   (owning department head)
    DELETE /options/{kind}/{id}           soft-delete, 7-day window
    POST   /options/{kind}/{id}/restore   undo a soft-delete
    GET    /options/deleted               everything currently in the bin

OWNERSHIP. Each kind belongs to exactly one unit (or, for funding, to the CFO's
flat role). The Logistics head cannot edit the Sound & Light catalogue. That
rule is enforced here, on every write, from the caller's roles.

The table name is never taken from user input: `kind` indexes a fixed registry,
so an unknown kind is a 404 rather than a chance to name an arbitrary table.
"""
from __future__ import annotations

from dataclasses import dataclass

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Forbidden, NotFound
from ..logging_setup import audit
from ..security import require_auth, require_internal
from ..security.principal import current_principal
from ._helpers import body, flag, required

bp = Blueprint("options", __name__, url_prefix="/options")

RETENTION_DAYS = 7


@dataclass(frozen=True)
class Catalogue:
    table: str
    pk: str
    # The unit whose head owns this catalogue, or None when a flat role owns it.
    owner_unit: str | None
    # A flat role that owns it instead (funding is the CFO's).
    owner_role: str | None
    # Columns beyond the common label/description/active set.
    extra_columns: tuple[str, ...] = ()
    # Catalogues not scoped to a requirement have no requirement_id column.
    has_requirement: bool = True


CATALOGUES: dict[str, Catalogue] = {
    "logistics": Catalogue("logistics_options", "logistics_option_id", "logistics_and_facilities", None,
                           ("available_quantity", "quantity_unit", "item_image_url")),
    "transportation": Catalogue("transportation_options", "transportation_option_id", "transport_services", None,
                                ("passenger_capacity", "available_vehicle_count", "instructions", "vehicle_image_url")),
    "photoVideo": Catalogue("media_options", "media_option_id", "photography_services", None),
    "soundLight": Catalogue("sound_light_options", "sound_light_option_id", "a_v_services", None,
                            ("technical_description",)),
    "dietaryInformation": Catalogue("dietary_information_options", "dietary_information_option_id",
                                    "food_beverage_services", None, has_requirement=False),
    "servingUnit": Catalogue("serving_unit_options", "serving_unit_option_id",
                             "food_beverage_services", None, has_requirement=False),
    "campusTourStart": Catalogue("campus_tour_start_options", "campus_tour_start_option_id", "student_services", None,
                                 ("meeting_instructions", "max_group_size")),
    "campusTourType": Catalogue("campus_tour_type_options", "campus_tour_type_option_id", "student_services", None),
    "waterNormal": Catalogue("water_normal_options", "water_normal_option_id", "food_beverage_services", None,
                             ("number_of_bottles", "available_stock", "ordering_delivery_instructions",
                              "logo_branding_requirement")),
    "fundingMain": Catalogue("funding_main_options", "funding_main_option_id", None, "cfo",
                             ("budget_category_finance_code", "purchasing_guidance")),
    "fundingSub": Catalogue("funding_sub_options", "funding_sub_option_id", None, "cfo",
                            ("main_option_id", "finance_procurement_code", "default_unit_purchasing_note"),
                            has_requirement=False),
    # A cafeteria's menu. Owned per-cafeteria by its manager, not by a
    # department head, so it is special-cased in _assert_may_write.
    "fmb": Catalogue("fmb_options", "fmb_option_id", None, None,
                     ("unit_code", "serving_unit_option_id", "dietary_information_option_id",
                      "availability_ordering_notes", "menu_image_url")),
}

# Requirement each catalogue's rows belong to, for the requirement_id column.
REQUIREMENT_FOR_KIND = {
    "logistics": "logistics",
    "transportation": "transportation",
    "photoVideo": "photoVideo",
    "soundLight": "soundLight",
    "campusTourStart": "campusTour",
    "campusTourType": "campusTour",
    "waterNormal": "waterNormal",
    "fundingMain": "fundingPurchase",
    "fmb": "fmb",
}


def _catalogue(kind: str) -> Catalogue:
    catalogue = CATALOGUES.get(kind)
    if catalogue is None:
        raise NotFound("Unknown option kind: " + kind + ".")
    return catalogue


def _assert_may_write(cur, kind: str, catalogue: Catalogue, payload: dict | None = None) -> None:
    """Only the owning department head, the owning cafeteria manager, or an
    admin may change a catalogue."""
    principal = current_principal()
    if principal.is_admin:
        return

    if kind == "fmb":
        # A cafeteria menu belongs to that cafeteria's manager. The unit comes
        # from the row (or the payload on create), never from a role claim.
        unit_code = (payload or {}).get("unitCode")
        managed = principal.units_for_role("cafeteria-manager")
        if unit_code and unit_code in managed:
            return
        if not unit_code and managed:
            return
        raise Forbidden("You do not manage the cafeteria this menu belongs to.")

    if catalogue.owner_unit and catalogue.owner_unit in principal.headed_units:
        return
    if catalogue.owner_role and principal.has_role(catalogue.owner_role):
        return
    raise Forbidden("This option list belongs to another department.")


def _columns(cur, catalogue: Catalogue) -> set[str]:
    return {
        r["column_name"]
        for r in fetch_all(
            cur,
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s",
            (catalogue.table,),
        )
    }


def _requirement_id(cur, kind: str) -> int | None:
    name = REQUIREMENT_FOR_KIND.get(kind)
    if not name:
        return None
    row = fetch_one(
        cur, "SELECT requirement_id FROM event_requirements WHERE requirement_name = %s", (name,)
    )
    return row["requirement_id"] if row else None


# camelCase in, snake_case out - the API speaks the frontend's convention.
def _snake(name: str) -> str:
    return "".join("_" + c.lower() if c.isupper() else c for c in name)


def _writable_values(payload: dict, catalogue: Catalogue, allowed: set[str]) -> dict:
    values: dict[str, object] = {}
    for key, value in payload.items():
        column = _snake(key)
        if column in ("label", "description", "active") or column in catalogue.extra_columns:
            if column in allowed:
                values[column] = value
    return values


@bp.get("")
@require_auth
def list_options():
    kind = request.args.get("kind")
    if not kind:
        raise BadRequest("A ?kind= parameter is required. See /catalog/requirements for the keys.")
    catalogue = _catalogue(kind)

    sql = f"SELECT * FROM {catalogue.table} WHERE archived_at IS NULL"
    params: list = []
    if flag("activeOnly"):
        sql += " AND active"
    # A cafeteria manager's menu view is scoped to their own cafeteria.
    unit_code = request.args.get("unitCode")
    if kind == "fmb" and unit_code:
        sql += " AND unit_code = %s"
        params.append(unit_code)

    rows = query(sql + f" ORDER BY {catalogue.pk}", params)
    return jsonify([{**r, "id": r[catalogue.pk], "kind": kind} for r in rows])


@bp.get("/deleted")
@require_internal
def list_deleted():
    """Everything in the soft-delete bin the caller owns, with days remaining."""
    principal = current_principal()
    out = []
    with transaction() as cur:
        for kind, catalogue in CATALOGUES.items():
            try:
                _assert_may_write(cur, kind, catalogue)
            except Forbidden:
                continue
            rows = fetch_all(
                cur,
                f"SELECT {catalogue.pk} AS id, label, archived_at, "
                f"       %s - EXTRACT(DAY FROM now() - archived_at)::int AS days_remaining "
                f"FROM {catalogue.table} WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
                (RETENTION_DAYS,),
            )
            out.extend({**r, "kind": kind} for r in rows)
    return jsonify(out)


@bp.get("/<kind>/<int:option_id>")
@require_auth
def get_option(kind: str, option_id: int):
    catalogue = _catalogue(kind)
    row = query(
        f"SELECT * FROM {catalogue.table} WHERE {catalogue.pk} = %s AND archived_at IS NULL",
        (option_id,),
    )
    if not row:
        raise NotFound("Option not found.")
    return jsonify({**row[0], "id": row[0][catalogue.pk], "kind": kind})


@bp.post("/<kind>")
@require_internal
def create_option(kind: str):
    catalogue = _catalogue(kind)
    payload = body()
    required(payload, "label")

    with transaction() as cur:
        _assert_may_write(cur, kind, catalogue, payload)
        allowed = _columns(cur, catalogue)
        values = _writable_values(payload, catalogue, allowed)
        values.setdefault("active", True)

        if catalogue.has_requirement and "requirement_id" in allowed:
            requirement_id = _requirement_id(cur, kind)
            if requirement_id is not None:
                values["requirement_id"] = requirement_id

        columns = ", ".join(values)
        placeholders = ", ".join(["%s"] * len(values))
        cur.execute(
            f"INSERT INTO {catalogue.table} ({columns}) VALUES ({placeholders}) RETURNING *",
            list(values.values()),
        )
        row = dict(cur.fetchone())
        audit("options.created", kind=kind, option_id=row[catalogue.pk],
              actor_user_id=current_principal().user_id)
    return jsonify({**row, "id": row[catalogue.pk], "kind": kind}), 201


@bp.patch("/<kind>/<int:option_id>")
@require_internal
def update_option(kind: str, option_id: int):
    catalogue = _catalogue(kind)
    payload = body()
    with transaction() as cur:
        existing = fetch_one(
            cur, f"SELECT * FROM {catalogue.table} WHERE {catalogue.pk} = %s", (option_id,)
        )
        if existing is None:
            raise NotFound("Option not found.")
        _assert_may_write(cur, kind, catalogue, {**existing, **payload})

        values = _writable_values(payload, catalogue, _columns(cur, catalogue))
        if not values:
            raise BadRequest("No updatable fields were supplied.")
        assignments = ", ".join(f"{c} = %s" for c in values)
        cur.execute(
            f"UPDATE {catalogue.table} SET {assignments} WHERE {catalogue.pk} = %s RETURNING *",
            [*values.values(), option_id],
        )
        row = dict(cur.fetchone())
        audit("options.updated", kind=kind, option_id=option_id,
              actor_user_id=current_principal().user_id)
    return jsonify({**row, "id": row[catalogue.pk], "kind": kind})


@bp.delete("/<kind>/<int:option_id>")
@require_internal
def delete_option(kind: str, option_id: int):
    """Soft delete. Submitted proposals store the option LABEL, not its id, so
    removing an option never rewrites history - it only stops new selections."""
    catalogue = _catalogue(kind)
    with transaction() as cur:
        existing = fetch_one(
            cur, f"SELECT * FROM {catalogue.table} WHERE {catalogue.pk} = %s", (option_id,)
        )
        if existing is None:
            raise NotFound("Option not found.")
        _assert_may_write(cur, kind, catalogue, existing)
        cur.execute(
            f"UPDATE {catalogue.table} SET archived_at = now(), active = FALSE WHERE {catalogue.pk} = %s",
            (option_id,),
        )
        audit("options.deleted", kind=kind, option_id=option_id,
              actor_user_id=current_principal().user_id)
    return "", 204


@bp.post("/<kind>/<int:option_id>/restore")
@require_internal
def restore_option(kind: str, option_id: int):
    catalogue = _catalogue(kind)
    with transaction() as cur:
        existing = fetch_one(
            cur, f"SELECT * FROM {catalogue.table} WHERE {catalogue.pk} = %s", (option_id,)
        )
        if existing is None:
            raise NotFound("Option not found.")
        _assert_may_write(cur, kind, catalogue, existing)
        cur.execute(
            f"UPDATE {catalogue.table} SET archived_at = NULL WHERE {catalogue.pk} = %s RETURNING *",
            (option_id,),
        )
        row = dict(cur.fetchone())
        audit("options.restored", kind=kind, option_id=option_id,
              actor_user_id=current_principal().user_id)
    return jsonify({**row, "id": row[catalogue.pk], "kind": kind})

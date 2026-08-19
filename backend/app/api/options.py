"""Request options - the manager-configured dropdown catalogues.

Twelve catalogues live in twelve tables with near-identical shapes. Rather than
twelve near-duplicate blueprints, one generic resource:

    GET    /options?kinds=a,b            list (all catalogues when omitted)
    GET    /options/{id}                 one option
    POST   /options                      create   (kind in the body)
    PUT    /options/{id}                 update
    PATCH  /options/{id}/status          activate / deactivate
    GET    /options/{id}/deletion-check   what a delete would affect
    DELETE /options/{id}                 soft-delete, 7-day window
    POST   /options/{id}/restore         undo a soft-delete
    DELETE /options/{id}/purge           permanent, from the bin only
    GET    /options/deleted/all          everything currently in the bin

IDENTITY. Each table has its own sequence, so the integer 1 names a row in all
twelve of them at once. A bare integer is therefore not an identifier for this
resource - it is a storage detail that happens to be unique only within its
table. The API's id is "{kind}:{n}" ("logistics:1"), which identifies exactly
one row, and lets the twelve tables stay one resource to the client rather than
leaking the partitioning into every URL. Cross-catalogue references carry it
too: a fundingSub's parentId is "fundingMain:5", not an unqualified 5.

SHAPE. Responses are the client's DTO, not the row: camelCase, no snake_case
columns, no archived_at, and no raw sequence numbers. The mapping lives in each
Catalogue's `fields`, so the schema can change without the contract moving.

OWNERSHIP. Each kind belongs to exactly one unit (or, for funding, to the CFO's
flat role). The Logistics head cannot edit the Sound & Light catalogue. That
rule is enforced here, on every write, from the caller's roles.

The table name is never taken from user input: `kind` indexes a fixed registry,
so an unknown kind is a 404 rather than a chance to name an arbitrary table.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from flask import Blueprint, jsonify, request

from ..db import fetch_all, fetch_one, query, transaction
from ..errors import BadRequest, Conflict, Forbidden, NotFound
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
    # Columns beyond the common label/description/active set, as
    # {dtoField: column}. This IS the contract: only these fields are read back
    # and only these may be written, so an added column stays private until it
    # is named here.
    fields: dict[str, str] = field(default_factory=dict)
    # Catalogues not scoped to a requirement have no requirement_id column.
    has_requirement: bool = True
    # DTO fields holding another option's id, as {dtoField: kind of the target}.
    # Stored as a bare integer, exposed as a composite id.
    references: dict[str, str] = field(default_factory=dict)

    @property
    def extra_columns(self) -> tuple[str, ...]:
        return tuple(self.fields.values())


CATALOGUES: dict[str, Catalogue] = {
    "logistics": Catalogue(
        "logistics_options", "logistics_option_id", "logistics_and_facilities", None,
        {"availableQuantity": "available_quantity", "quantityUnit": "quantity_unit",
         "imageDataUrl": "item_image_url"}),
    "transportation": Catalogue(
        "transportation_options", "transportation_option_id", "transport_services", None,
        {"passengerCapacity": "passenger_capacity", "availableVehicles": "available_vehicle_count",
         "instructions": "instructions", "imageDataUrl": "vehicle_image_url"}),
    "photoVideo": Catalogue("media_options", "media_option_id", "photography_services", None),
    "soundLight": Catalogue(
        "sound_light_options", "sound_light_option_id", "a_v_services", None,
        {"setupRequirements": "technical_description"}),
    "dietaryInformation": Catalogue(
        "dietary_information_options", "dietary_information_option_id",
        "food_beverage_services", None, has_requirement=False),
    "servingUnit": Catalogue(
        "serving_unit_options", "serving_unit_option_id",
        "food_beverage_services", None, has_requirement=False),
    "campusTourStart": Catalogue(
        "campus_tour_start_options", "campus_tour_start_option_id", "student_services", None,
        {"meetingInstructions": "meeting_instructions", "maximumGroupSize": "max_group_size"}),
    "campusTourType": Catalogue(
        "campus_tour_type_options", "campus_tour_type_option_id", "student_services", None),
    "waterNormal": Catalogue(
        "water_normal_options", "water_normal_option_id", "food_beverage_services", None,
        {"bottleCount": "number_of_bottles", "availableStock": "available_stock",
         "orderingInstructions": "ordering_delivery_instructions",
         "brandingRequirement": "logo_branding_requirement"}),
    "fundingMain": Catalogue(
        "funding_main_options", "funding_main_option_id", None, "cfo",
        {"financeCode": "budget_category_finance_code",
         "purchasingGuidance": "purchasing_guidance"}),
    "fundingSub": Catalogue(
        "funding_sub_options", "funding_sub_option_id", None, "cfo",
        {"parentId": "main_option_id", "financeCode": "finance_procurement_code",
         "purchasingNote": "default_unit_purchasing_note"},
        has_requirement=False,
        references={"parentId": "fundingMain"}),
    # A cafeteria's menu. Owned per-cafeteria by its manager, not by a
    # department head, so it is special-cased in _assert_may_write.
    "fmb": Catalogue(
        "fmb_options", "fmb_option_id", None, None,
        {"cafeteriaCode": "unit_code", "servingUnitId": "serving_unit_option_id",
         "dietaryInformationId": "dietary_information_option_id",
         "orderingNotes": "availability_ordering_notes", "imageDataUrl": "menu_image_url"},
        references={"servingUnitId": "servingUnit", "dietaryInformationId": "dietaryInformation"}),
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


def _assert_required_present(cur, kind: str, catalogue: Catalogue, values: dict) -> None:
    """Reject a create missing a column the table requires.

    Read from the schema rather than restated here, so the two cannot drift.
    Without this the insert still fails - but as a NOT NULL violation surfacing
    as a 500, which says the server broke when in fact the request was
    incomplete.
    """
    required_columns = {
        r["column_name"]
        for r in fetch_all(
            cur,
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s "
            "  AND is_nullable = 'NO' AND column_default IS NULL",
            (catalogue.table,),
        )
    } - {catalogue.pk, "requirement_id"}

    by_column = {v: k for k, v in {**_BASE_FIELDS, **catalogue.fields}.items()}
    missing = sorted(
        by_column.get(column, column)
        for column in required_columns
        if values.get(column) in (None, "")
    )
    if missing:
        raise BadRequest(
            f"A {kind} option requires: " + ", ".join(missing) + "."
        )


def _requirement_id(cur, kind: str) -> int | None:
    name = REQUIREMENT_FOR_KIND.get(kind)
    if not name:
        return None
    row = fetch_one(
        cur, "SELECT requirement_id FROM event_requirements WHERE requirement_name = %s", (name,)
    )
    return row["requirement_id"] if row else None


# --- Identity -------------------------------------------------------------
def option_id(kind: str, number: int) -> str:
    return f"{kind}:{number}"


def parse_option_id(value: str) -> tuple[str, int]:
    """Split "logistics:1" into its catalogue and row.

    A bare integer is rejected rather than guessed at: it names a row in every
    one of the twelve tables, so accepting it would mean picking one of twelve
    possible records on the caller's behalf.
    """
    kind, _, number = str(value).partition(":")
    if not number:
        raise BadRequest(
            "An option id looks like 'logistics:1'. A bare number is ambiguous - "
            "each catalogue has its own numbering."
        )
    if not number.isdigit():
        raise NotFound("Option not found.")
    _catalogue(kind)
    return kind, int(number)


# --- DTO ------------------------------------------------------------------
_BASE_FIELDS = {"label": "label", "description": "description", "active": "active"}


def to_dto(kind: str, row: dict) -> dict:
    """The client's RequestOption. Only declared fields cross the boundary."""
    catalogue = CATALOGUES[kind]
    dto: dict[str, object] = {"id": option_id(kind, row[catalogue.pk]), "kind": kind}
    for dto_field, column in {**_BASE_FIELDS, **catalogue.fields}.items():
        value = row.get(column)
        if dto_field in catalogue.references and value is not None:
            value = option_id(catalogue.references[dto_field], value)
        dto[dto_field] = value
    return dto


def _writable_values(payload: dict, catalogue: Catalogue, allowed: set[str]) -> dict:
    """Payload fields mapped onto columns.

    Anything not declared in _BASE_FIELDS or the catalogue's own fields is
    dropped, so a client cannot reach a column simply by naming it - including
    the primary key, archived_at, and requirement_id.
    """
    values: dict[str, object] = {}
    for dto_field, column in {**_BASE_FIELDS, **catalogue.fields}.items():
        if dto_field not in payload or column not in allowed:
            continue
        value = payload[dto_field]
        # A reference arrives as a composite id; the column stores the integer.
        if dto_field in catalogue.references and value not in (None, ""):
            target_kind, number = parse_option_id(value)
            expected = catalogue.references[dto_field]
            if target_kind != expected:
                raise BadRequest(f"{dto_field} must be a {expected} option id.")
            value = number
        values[column] = value
    return values


def _requested_kinds() -> list[str]:
    """The catalogues this request is about.

    ?kinds= takes a comma-separated list: the manager pages and the proposal
    form both show several catalogues at once, and one request per catalogue
    would be a round trip each over a remote database. ?kind= stays supported
    for single-catalogue callers, and omitting both means every catalogue -
    which is what the manager page's unfiltered view asks for.

    Every name is validated against CATALOGUES before it reaches a query, so
    the table and column names interpolated below are only ever our own.
    """
    raw = request.args.get("kinds") or request.args.get("kind") or ""
    kinds = [k.strip() for k in raw.split(",") if k.strip()]
    if not kinds:
        return list(CATALOGUES)
    for kind in kinds:
        _catalogue(kind)
    # De-duplicated, preserving the order asked for.
    return list(dict.fromkeys(kinds))


@bp.get("")
@require_auth
def list_options():
    """Rows from one or more catalogues, filtered in the database.

    Each catalogue is its own table with its own columns, so this issues one
    narrow SELECT per requested kind rather than a UNION: a UNION would have to
    flatten every branch onto one column list, discarding exactly the
    kind-specific fields (available_quantity, passenger_capacity, ...) the
    manager pages and the proposal form render.

    Every filter - active, search, cafeteria scope - is applied in SQL, so no
    row crosses the wire only to be discarded here.
    """
    kinds = _requested_kinds()
    active_only = flag("active") or flag("activeOnly")
    search = (request.args.get("search") or "").strip()
    cafeteria_code = request.args.get("cafeteriaCode") or request.args.get("unitCode")

    out: list[dict] = []
    for kind in kinds:
        catalogue = CATALOGUES[kind]
        clauses = ["archived_at IS NULL"]
        params: list = []
        if active_only:
            clauses.append("active")
        if search:
            clauses.append("(label ILIKE %s OR COALESCE(description, '') ILIKE %s)")
            params += [f"%{search}%", f"%{search}%"]
        # Only the cafeteria menu is scoped by unit; the filter would match no
        # column on any other catalogue, so it is skipped rather than applied.
        if cafeteria_code and "unit_code" in catalogue.extra_columns:
            clauses.append("unit_code = %s")
            params.append(cafeteria_code)

        rows = query(
            f"SELECT * FROM {catalogue.table} WHERE " + " AND ".join(clauses) + " ORDER BY label",
            params,
        )
        out += [to_dto(kind, r) for r in rows]
    return jsonify(out)


@bp.get("/deleted/all")
@bp.get("/deleted")
@require_internal
def list_deleted():
    """Everything in the soft-delete bin the caller owns, with days remaining."""
    out = []
    with transaction() as cur:
        for kind, catalogue in CATALOGUES.items():
            try:
                _assert_may_write(cur, kind, catalogue)
            except Forbidden:
                continue
            rows = fetch_all(
                cur,
                f"SELECT *, archived_at AS deleted_at,"
                f"       archived_at + make_interval(days => %s) AS permanent_deletion_at,"
                f"       GREATEST(0, %s - EXTRACT(DAY FROM now() - archived_at)::int)"
                f"           AS days_remaining "
                f"FROM {catalogue.table} WHERE archived_at IS NOT NULL ORDER BY archived_at DESC",
                (RETENTION_DAYS, RETENTION_DAYS),
            )
            out.extend(
                {
                    **to_dto(kind, r),
                    "deletedAt": r["deleted_at"],
                    "permanentDeletionAt": r["permanent_deletion_at"],
                    "daysRemaining": r["days_remaining"],
                }
                for r in rows
            )
    return jsonify(out)


def _load(cur, kind: str, number: int, *, live_only: bool = False) -> dict:
    catalogue = CATALOGUES[kind]
    sql = f"SELECT * FROM {catalogue.table} WHERE {catalogue.pk} = %s"
    if live_only:
        sql += " AND archived_at IS NULL"
    row = fetch_one(cur, sql, (number,))
    if row is None:
        raise NotFound("Option not found.")
    return row


@bp.get("/<option_ref>")
@require_auth
def get_option(option_ref: str):
    kind, number = parse_option_id(option_ref)
    with transaction() as cur:
        row = _load(cur, kind, number, live_only=True)
    return jsonify(to_dto(kind, row))


@bp.post("")
@require_internal
def create_option():
    """Create in the catalogue named by the body's `kind`.

    The kind is a property of the option, not of its location: the client holds
    one RequestOption union and one form, so it posts one resource and says
    which catalogue it belongs to.
    """
    payload = body()
    required(payload, "label")
    kind = payload.get("kind")
    if not kind:
        raise BadRequest("A 'kind' field is required. One of: " + ", ".join(sorted(CATALOGUES)) + ".")
    catalogue = _catalogue(str(kind))

    with transaction() as cur:
        _assert_may_write(cur, str(kind), catalogue, payload)
        allowed = _columns(cur, catalogue)
        values = _writable_values(payload, catalogue, allowed)
        values.setdefault("active", True)

        if catalogue.has_requirement and "requirement_id" in allowed:
            requirement_id = _requirement_id(cur, str(kind))
            if requirement_id is not None:
                values["requirement_id"] = requirement_id

        _assert_required_present(cur, str(kind), catalogue, values)

        columns = ", ".join(values)
        placeholders = ", ".join(["%s"] * len(values))
        cur.execute(
            f"INSERT INTO {catalogue.table} ({columns}) VALUES ({placeholders}) RETURNING *",
            list(values.values()),
        )
        row = dict(cur.fetchone())
        audit("options.created", kind=kind, option_id=row[catalogue.pk],
              actor_user_id=current_principal().user_id)
    return jsonify(to_dto(str(kind), row)), 201


def _apply_update(option_ref: str, payload: dict) -> dict:
    kind, number = parse_option_id(option_ref)
    catalogue = CATALOGUES[kind]
    with transaction() as cur:
        existing = _load(cur, kind, number)
        _assert_may_write(cur, kind, catalogue, {**existing, **payload})

        values = _writable_values(payload, catalogue, _columns(cur, catalogue))
        if not values:
            raise BadRequest("No updatable fields were supplied.")
        assignments = ", ".join(f"{c} = %s" for c in values)
        cur.execute(
            f"UPDATE {catalogue.table} SET {assignments} WHERE {catalogue.pk} = %s RETURNING *",
            [*values.values(), number],
        )
        row = dict(cur.fetchone())
        audit("options.updated", kind=kind, option_id=number,
              actor_user_id=current_principal().user_id)
    return to_dto(kind, row)


@bp.put("/<option_ref>")
@require_internal
def replace_option(option_ref: str):
    return jsonify(_apply_update(option_ref, body()))


@bp.patch("/<option_ref>")
@require_internal
def update_option(option_ref: str):
    return jsonify(_apply_update(option_ref, body()))


@bp.patch("/<option_ref>/status")
@require_internal
def set_option_status(option_ref: str):
    payload = body()
    if "active" not in payload:
        raise BadRequest("An 'active' field is required.")
    return jsonify(_apply_update(option_ref, {"active": bool(payload["active"])}))


def _dependents(cur, kind: str, number: int) -> list[str]:
    """Other options that point at this one.

    Proposals are deliberately not counted: a submitted proposal stores the
    option's LABEL, not its id, so archiving an option never rewrites history.
    """
    blockers: list[str] = []
    for other_kind, other in CATALOGUES.items():
        for dto_field, target_kind in other.references.items():
            if target_kind != kind:
                continue
            column = other.fields[dto_field]
            used = fetch_one(
                cur,
                f"SELECT count(*) AS c FROM {other.table} "
                f"WHERE {column} = %s AND archived_at IS NULL",
                (number,),
            )["c"]
            if used:
                blockers.append(f"{used} {other_kind} option(s) reference this one")
    return blockers


@bp.get("/<option_ref>/deletion-check")
@require_internal
def option_deletion_check(option_ref: str):
    kind, number = parse_option_id(option_ref)
    with transaction() as cur:
        row = _load(cur, kind, number)
        _assert_may_write(cur, kind, CATALOGUES[kind], row)
        blockers = _dependents(cur, kind, number)
    return jsonify(
        {"canDelete": not blockers, "blockingReasons": blockers, "entityLabel": row["label"]}
    )


@bp.delete("/<option_ref>")
@require_internal
def delete_option(option_ref: str):
    """Soft delete. Submitted proposals store the option LABEL, not its id, so
    removing an option never rewrites history - it only stops new selections."""
    kind, number = parse_option_id(option_ref)
    catalogue = CATALOGUES[kind]
    with transaction() as cur:
        existing = _load(cur, kind, number)
        _assert_may_write(cur, kind, catalogue, existing)
        blockers = _dependents(cur, kind, number)
        if blockers:
            raise Conflict(blockers[0] + ". Repoint or remove those first.")
        cur.execute(
            f"UPDATE {catalogue.table} SET archived_at = now(), active = FALSE "
            f"WHERE {catalogue.pk} = %s RETURNING *",
            (number,),
        )
        row = dict(cur.fetchone())
        audit("options.deleted", kind=kind, option_id=number,
              actor_user_id=current_principal().user_id)
    return jsonify(to_dto(kind, row))


@bp.post("/<option_ref>/restore")
@require_internal
def restore_option(option_ref: str):
    kind, number = parse_option_id(option_ref)
    catalogue = CATALOGUES[kind]
    with transaction() as cur:
        existing = _load(cur, kind, number)
        _assert_may_write(cur, kind, catalogue, existing)
        cur.execute(
            f"UPDATE {catalogue.table} SET archived_at = NULL WHERE {catalogue.pk} = %s RETURNING *",
            (number,),
        )
        row = dict(cur.fetchone())
        audit("options.restored", kind=kind, option_id=number,
              actor_user_id=current_principal().user_id)
    return jsonify(to_dto(kind, row))


@bp.delete("/<option_ref>/purge")
@require_internal
def purge_option(option_ref: str):
    """Permanent, and only for a row already in the bin."""
    kind, number = parse_option_id(option_ref)
    catalogue = CATALOGUES[kind]
    with transaction() as cur:
        row = fetch_one(
            cur,
            f"SELECT * FROM {catalogue.table} "
            f"WHERE {catalogue.pk} = %s AND archived_at IS NOT NULL",
            (number,),
        )
        if row is None:
            raise NotFound("No deleted option with that id.")
        _assert_may_write(cur, kind, catalogue, row)
        blockers = _dependents(cur, kind, number)
        if blockers:
            raise Conflict(blockers[0] + ". It cannot be purged.")
        cur.execute(f"DELETE FROM {catalogue.table} WHERE {catalogue.pk} = %s", (number,))
        audit("options.purged", kind=kind, option_id=number,
              actor_user_id=current_principal().user_id)
    return "", 204


@bp.get("/logistics/<int:option_id>/availability")
@require_auth
def logistics_availability(option_id: int):
    """How many of this item remain free for a date/time window.

    Computed server-side by subtracting quantities already committed to
    overlapping bookings on live proposals. Cancelled and rejected proposals do
    not hold stock.
    """
    from flask import request as flask_request

    date = flask_request.args.get("date")
    start = flask_request.args.get("start")
    end = flask_request.args.get("end")
    if not (date and start and end):
        raise BadRequest("date, start and end query parameters are required.")

    with transaction() as cur:
        option = fetch_one(
            cur,
            "SELECT logistics_option_id, label, available_quantity, quantity_unit "
            "FROM logistics_options WHERE logistics_option_id = %s AND archived_at IS NULL",
            (option_id,),
        )
        if option is None:
            raise NotFound("Logistics item not found.")

        committed = fetch_one(
            cur,
            '''SELECT COALESCE(sum(rl.quantity), 0) AS total
                 FROM request_logistics rl
                 JOIN request r ON r.request_id = rl.request_id
                WHERE rl.option_id = %s
                  AND rl."date" = %s
                  AND r.status NOT IN ('draft', 'cancelled', 'completed_rejected')
                  AND rl.start_time < %s AND rl.end_time > %s''',
            (option_id, date, end, start),
        )["total"]

    total = option["available_quantity"] or 0
    return jsonify(
        {
            "optionId": option["logistics_option_id"],
            "label": option["label"],
            "unit": option["quantity_unit"],
            "totalQuantity": total,
            "committedQuantity": int(committed),
            "availableQuantity": max(0, total - int(committed)),
        }
    )

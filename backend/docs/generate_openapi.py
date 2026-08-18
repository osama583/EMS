"""Generate docs/openapi.json from the live Flask app.

Generated rather than hand-written, so the spec cannot drift from the routes.
Path, method, path parameters and auth requirement come from the URL map and the
decorators; summaries and descriptions come from each view's docstring.

    python -m docs.generate_openapi
"""
from __future__ import annotations

import json
import pathlib
import re
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from app import API_PREFIX, create_app  # noqa: E402

OUT = pathlib.Path(__file__).resolve().parent / "openapi.json"

# Flask converter -> (OpenAPI type, format)
CONVERTERS = {"int": ("integer", "int64"), "string": ("string", None), "path": ("string", None)}

TAGS = [
    {"name": "auth", "description": "Login, token refresh, and the current user."},
    {"name": "proposals", "description": "Event proposals and every review decision on them."},
    {"name": "tasks", "description": "Department fulfilment tasks and staff assignment."},
    {"name": "cafeteria_orders", "description": "F&B cafeteria orders and the shared staff pool."},
    {"name": "catalog", "description": "Reference data: config, categories, formats, units."},
    {"name": "options", "description": "Manager-configured dropdown catalogues."},
    {"name": "admin", "description": "Users, roles, units, and page visibility. Admin only."},
    {"name": "events", "description": "Published event discovery and registration."},
    {"name": "clubs", "description": "Club directory, membership, and join requests."},
]

ERROR_SCHEMA = {
    "type": "object",
    "properties": {
        "error": {
            "type": "object",
            "properties": {
                "code": {"type": "string", "example": "not_found"},
                "message": {"type": "string", "description": "Safe to show a user."},
                "request_id": {"type": "string", "description": "Correlates with server logs."},
                "details": {"type": "object", "additionalProperties": True},
            },
            "required": ["code", "message"],
        }
    },
}


def _split_docstring(doc: str | None) -> tuple[str, str]:
    if not doc:
        return "", ""
    lines = [ln.strip() for ln in doc.strip().splitlines()]
    summary = lines[0]
    body = "\n".join(lines[1:]).strip()
    return summary, body


def _parameters(rule) -> list[dict]:
    params = []
    for name in rule.arguments:
        converter = re.search(rf"<(\w+):{name}>", str(rule))
        kind = converter.group(1) if converter else "string"
        type_name, fmt = CONVERTERS.get(kind, ("string", None))
        schema = {"type": type_name}
        if fmt:
            schema["format"] = fmt
        params.append(
            {"name": name, "in": "path", "required": True, "schema": schema}
        )
    return params


def _responses(methods: set[str], secured: bool) -> dict:
    error = {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}}
    success_code = "201" if "POST" in methods else "200"
    responses = {
        success_code: {"description": "Success."},
        "400": {"description": "Malformed request.", **error},
        "422": {"description": "Validation failed.", **error},
        "429": {"description": "Rate limit exceeded.", **error},
        "500": {"description": "Unexpected error.", **error},
    }
    if "DELETE" in methods:
        responses = {"204": {"description": "Deleted."}, **responses}
        responses.pop("200", None)
    if secured:
        responses["401"] = {"description": "Missing or invalid token.", **error}
        responses["403"] = {"description": "Authenticated, but not permitted.", **error}
        responses["404"] = {"description": "Not found, or not visible to you.", **error}
        responses["409"] = {"description": "Not allowed in the resource's current state.", **error}
    return responses


def build() -> dict:
    app = create_app(validate_config=False)
    paths: dict[str, dict] = {}

    for rule in app.url_map.iter_rules():
        if rule.endpoint == "static" or not str(rule).startswith(API_PREFIX):
            continue
        view = app.view_functions[rule.endpoint]
        secured = bool(getattr(view, "__auth_required__", False))
        blueprint = rule.endpoint.split(".")[0]
        summary, description = _split_docstring(view.__doc__)

        # {var} rather than Flask's <converter:var>.
        path = re.sub(r"<(?:\w+:)?(\w+)>", r"{\1}", str(rule))
        entry = paths.setdefault(path, {})

        for method in sorted(rule.methods - {"HEAD", "OPTIONS"}):
            operation: dict = {
                "tags": [blueprint],
                "operationId": rule.endpoint.replace(".", "_") + "_" + method.lower(),
                "summary": summary or rule.endpoint,
                "responses": _responses({method}, secured),
            }
            if description:
                operation["description"] = description
            params = _parameters(rule)
            if params:
                operation["parameters"] = params
            if method in ("POST", "PUT", "PATCH"):
                operation["requestBody"] = {
                    "required": method != "PATCH",
                    "content": {"application/json": {"schema": {"type": "object"}}},
                }
            if secured:
                operation["security"] = [{"bearerAuth": []}]
                required_roles = getattr(view, "__required_roles__", None)
                if required_roles:
                    operation["x-required-roles"] = list(required_roles)
            else:
                operation["security"] = []
            entry[method.lower()] = operation

    return {
        "openapi": "3.0.3",
        "info": {
            "title": "APU EMS API",
            "version": "1.0.0",
            "description": (
                "REST API for the APU Event Management System.\n\n"
                "The backend owns the proposal workflow state machine and every "
                "authorisation decision. Clients send actions and render what comes back; "
                "no permission rule is evaluated in the browser.\n\n"
                "**Authentication.** `POST /auth/login` returns a short-lived access token "
                "and a longer-lived refresh token. Send the access token as "
                "`Authorization: Bearer <token>`. On 401 with code `token_expired`, "
                "call `POST /auth/refresh`.\n\n"
                "**Errors.** Every failure returns the same envelope: "
                "`{\"error\": {\"code\", \"message\", \"request_id\"}}`. `message` is safe to "
                "display; `request_id` correlates with server logs.\n\n"
                "**Rate limits.** 300 requests/minute overall, 10/minute on auth endpoints, "
                "keyed per authenticated user and falling back to client IP."
            ),
            "license": {"name": "Proprietary"},
        },
        "servers": [
            {"url": "http://localhost:5000" + API_PREFIX, "description": "Local development"},
        ],
        "tags": TAGS,
        "components": {
            "securitySchemes": {
                "bearerAuth": {"type": "http", "scheme": "bearer", "bearerFormat": "JWT"}
            },
            "schemas": {"Error": ERROR_SCHEMA},
        },
        "paths": dict(sorted(paths.items())),
    }


def main() -> None:
    spec = build()
    OUT.write_text(json.dumps(spec, indent=2) + "\n", encoding="utf-8")
    operations = sum(len(methods) for methods in spec["paths"].values())
    secured = sum(
        1
        for methods in spec["paths"].values()
        for op in methods.values()
        if op.get("security")
    )
    print(f"Wrote {OUT.relative_to(pathlib.Path.cwd())}")
    print(f"  {len(spec['paths'])} paths, {operations} operations ({secured} requiring auth)")


if __name__ == "__main__":
    main()

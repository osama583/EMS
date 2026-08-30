"""Render the section 4.6 sample-code listings as print-quality PNGs.

Pygments highlights the excerpt to standalone HTML (no CDN, no network), then
Playwright shoots each card at 2x. Keeping the same source-of-truth line ranges
here means re-running the script picks up any later edit to the real files.
"""
from __future__ import annotations

import json
from pathlib import Path

from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import get_lexer_for_filename

REPO = Path("C:/Users/natsu/Desktop/Osama")
OUT = REPO / "ui png" / "Sample Codes"
BUILD = REPO / "ui png" / "_capture" / "_code_html"

# (figure id, title shown in the report, path, first line, last line, caption)
LISTINGS = [
    ("4.6.01", "auth.py", "backend/app/api/auth.py", 56, 111,
     "Sign-in: credential verification and JWT access/refresh token issuance."),
    ("4.6.02", "login.ts", "fyp-ui/src/app/features/auth/login/login.ts", 126, 176,
     "The Angular sign-in component: client-side validation and the login call."),
    ("4.6.03", "auth.guards.ts", "fyp-ui/src/app/core/auth/auth.guards.ts", 1, 76,
     "Route guards that gate every internal page on authentication and role."),
    ("4.6.04", "auth.interceptor.ts", "fyp-ui/src/app/core/auth/auth.interceptor.ts", 31, 84,
     "Attaches the bearer token to API calls and refreshes it on expiry."),
    ("4.6.05", "role-navigation.ts", "fyp-ui/src/app/core/auth/role-navigation.ts", 20, 60,
     "Builds each role's menu from server-issued grants; the client decides nothing."),
    ("4.6.06", "event-proposal.ts", "fyp-ui/src/app/features/internal/pages/event-proposal/event-proposal.ts", 1150, 1200,
     "Step navigation for the six-step proposal form, validating on each move."),
    ("4.6.07", "stages.py", "backend/app/services/workflow/stages.py", 123, 216,
     "The proposal workflow state machine: submit, approve and reject transitions."),
    ("4.6.08", "authorization.py", "backend/app/services/workflow/authorization.py", 147, 207,
     "Server-side authorisation: the actor comes from the JWT, never the request body."),
    ("4.6.09", "tasks.py", "backend/app/services/workflow/tasks.py", 48, 113,
     "Fan-out of an approved proposal into one task per responsible department."),
    ("4.6.10", "escalation.py", "backend/app/services/workflow/escalation.py", 211, 271,
     "Detects tasks that have passed their deadline and marks them overdue."),
    ("4.6.11", "sql_guard.py", "backend/app/ai/sql_guard.py", 181, 250,
     "Guardrails validating every AI-generated SQL statement before execution."),
    ("4.6.12", "scope.py", "backend/app/services/dashboard/scope.py", 208, 284,
     "Scopes dashboard metrics to what the signed-in role is allowed to see."),
]

PAGE = """<!doctype html>
<html><head><meta charset="utf-8"><style>
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; padding: 28px; background: #eef1f6;
         font-family: "Segoe UI", Arial, sans-serif; }}
  .card {{ width: 1180px; background: #fff; border: 1px solid #d3dae6;
           border-radius: 10px; overflow: hidden; }}
  .bar {{ display: flex; align-items: baseline; gap: 12px; padding: 13px 20px;
          background: #1f2a3c; color: #fff; }}
  .bar .id {{ font-weight: 700; font-size: 15px; letter-spacing: .3px; }}
  .bar .name {{ font-family: Consolas, monospace; font-size: 15px; color: #9fd0ff; }}
  .bar .lines {{ margin-left: auto; font-size: 12.5px; color: #b9c4d6; }}
  .cap {{ padding: 11px 20px; font-size: 13.5px; color: #33405a;
          background: #f6f8fc; border-bottom: 1px solid #e2e8f2; }}
  .code {{ padding: 16px 20px 20px; }}
  .highlight pre {{ margin: 0; font-family: Consolas, "Courier New", monospace;
                    font-size: 13px; line-height: 1.62; white-space: pre-wrap;
                    word-break: break-word; }}
  .linenos {{ color: #98a3b6; padding-right: 14px; user-select: none; }}
  table.highlighttable {{ border-collapse: collapse; }}
  td.linenos {{ vertical-align: top; }}
  td.code {{ vertical-align: top; padding: 0; }}
  {pygments_css}
</style></head>
<body><div class="card">
  <div class="bar"><span class="id">{fid}</span>
    <span class="name">{name}</span>
    <span class="lines">{path} &nbsp;|&nbsp; lines {start}-{end}</span></div>
  <div class="cap">{caption}</div>
  <div class="code">{body}</div>
</div></body></html>
"""


def main() -> None:
    BUILD.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    formatter = HtmlFormatter(style="friendly", linenos="table", linenostart=1)
    css = formatter.get_style_defs(".highlight")

    jobs = []
    for fid, name, rel, start, end, caption in LISTINGS:
        source = REPO / rel
        lines = source.read_text(encoding="utf-8").splitlines()
        if end > len(lines):
            raise SystemExit(f"{rel}: requested line {end} but file has {len(lines)}")
        excerpt = "\n".join(lines[start - 1:end])
        lexer = get_lexer_for_filename(source.name)
        fmt = HtmlFormatter(style="friendly", linenos="table", linenostart=start)
        body = highlight(excerpt, lexer, fmt)
        html = PAGE.format(pygments_css=css, fid=fid, name=name, path=rel,
                           start=start, end=end, caption=caption, body=body)
        target = BUILD / f"{fid}.html"
        target.write_text(html, encoding="utf-8")
        jobs.append({"id": fid, "name": name, "html": str(target),
                     "png": str(OUT / f"{fid} {name}.png")})

    (BUILD / "jobs.json").write_text(json.dumps(jobs, indent=2), encoding="utf-8")
    print(f"generated {len(jobs)} code figures -> {BUILD}")


if __name__ == "__main__":
    main()

# -*- coding: utf-8 -*-
"""Render the Appendix F security listings in the same style as the 4.6 figures.

Each image is a navy header (label, file path, line range), a description strip,
then the source with line numbers and syntax highlighting on white - the layout
the twelve existing Sample Code figures already use, so the appendix reads as a
continuation rather than as a different document.

Run with the backend venv, which carries pygments and Pillow:
    backend/.venv/Scripts/python.exe .fypwork/make_appendix_code.py
"""
from __future__ import annotations

import html
import pathlib
import subprocess
import sys

from pygments import highlight
from pygments.formatters import HtmlFormatter
from pygments.lexers import PythonLexer

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / ".fypwork" / "appendix_code"
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"

# (label, repo-relative path, first line, last line, description strip)
LISTINGS = [
    ("F.1", "backend/app/security/passwords.py", 16, 41,
     "Password hashing with a configurable bcrypt cost factor."),
    ("F.2", "backend/app/security/tokens.py", 28, 63,
     "Access and refresh tokens separated by a verified type claim."),
    ("F.3", "backend/app/security/decorators.py", 32, 76,
     "Authenticating a request and loading its roles from the database."),
    ("F.4", "backend/app/security/principal.py", 27, 55,
     "Authority held as a role within an organisational unit."),
    ("F.5", "backend/app/services/identity.py", 95, 148,
     "Resolving which pages a caller may open, from the grant tables."),
    ("F.6", "backend/app/db.py", 61, 96,
     "Pooled access with every value bound as a query parameter."),
    ("F.7", "backend/app/__init__.py", 59, 68,
     "Cross-origin access restricted to an explicit origin list."),
    ("F.8", "backend/app/__init__.py", 94, 109,
     "Security headers applied uniformly to every response."),
    ("F.9", "backend/app/errors.py", 82, 118,
     "Returning a user-safe error while logging the internal detail."),
    ("F.10", "backend/app/api/auth.py", 170, 195,
     "Password reset without disclosing whether an account exists."),
]

CSS = """
html,body{margin:0;padding:0;background:#fff;}
body{font-family:"Segoe UI",Arial,sans-serif;}
.wrap{width:1180px;border:1px solid #d7dde5;border-radius:6px;overflow:hidden;}
.hd{background:#1b2a41;color:#fff;padding:11px 18px;display:flex;
    justify-content:space-between;align-items:center;font-size:15px;}
.hd .lbl{font-weight:700;}
.hd .lbl span{font-family:Consolas,"Courier New",monospace;font-weight:400;
              color:#a8c4e6;margin-left:10px;}
.hd .src{font-size:12.5px;color:#c3d3e8;font-family:Consolas,"Courier New",monospace;}
.desc{background:#f2f5f9;border-bottom:1px solid #dde3ea;color:#20344d;
      padding:10px 18px;font-size:13.5px;}
table.code{border-collapse:collapse;width:100%;background:#fff;}
td.ln{background:#f0f2f5;color:#8b95a3;text-align:right;padding:0 11px;width:1%;
      font-family:Consolas,"Courier New",monospace;font-size:12.5px;
      user-select:none;border-right:1px solid #e2e6ec;}
td.cd{padding:0 0 0 14px;font-family:Consolas,"Courier New",monospace;font-size:12.5px;
      white-space:pre;color:#1f2933;}
tr{height:21px;}
"""


def render_html(label, path, start, end, desc) -> str:
    source = (ROOT / path).read_text(encoding="utf-8").splitlines()[start - 1:end]
    body = "\n".join(source)

    formatter = HtmlFormatter(nowrap=True, style="default")
    marked = highlight(body, PythonLexer(), formatter).rstrip("\n").split("\n")
    # highlight() can fold a trailing blank line; pad so numbering stays aligned
    while len(marked) < len(source):
        marked.append("")

    rows = "".join(
        f'<tr><td class="ln">{start + i}</td><td class="cd">{line or "&nbsp;"}</td></tr>'
        for i, line in enumerate(marked))

    return f"""<!doctype html><html><head><meta charset="utf-8">
<style>{CSS}
{formatter.get_style_defs('.cd')}</style></head><body>
<div class="wrap">
  <div class="hd">
    <div class="lbl">{label}<span>{html.escape(pathlib.Path(path).name)}</span></div>
    <div class="src">{html.escape(path)} | lines {start}-{end}</div>
  </div>
  <div class="desc">{html.escape(desc)}</div>
  <table class="code">{rows}</table>
</div></body></html>"""


def shoot(html_path: pathlib.Path, png_path: pathlib.Path) -> tuple[int, int]:
    from PIL import Image

    uri = "file:///" + str(html_path).replace("\\", "/")
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
                    f"--user-data-dir={pathlib.Path.home()}/.code-chrome",
                    "--force-device-scale-factor=2", "--window-size=1200,2000",
                    f"--screenshot={png_path}", uri], check=True, capture_output=True)

    im = Image.open(png_path).convert("RGB")
    px, (w, h) = im.load(), im.size
    white = (255, 255, 255)

    def blank_row(y):
        return all(px[x, y] == white for x in range(0, w, 3))

    def blank_col(x):
        return all(px[x, y] == white for y in range(0, h, 3))

    bottom = h
    while bottom > 1 and blank_row(bottom - 1):
        bottom -= 1
    right = w
    while right > 1 and blank_col(right - 1):
        right -= 1
    im.crop((0, 0, right + 2, bottom + 2)).save(png_path)
    return Image.open(png_path).size


def main() -> int:
    OUT.mkdir(exist_ok=True)
    for label, path, start, end, desc in LISTINGS:
        stem = OUT / f"{label.replace('.', '_')}"
        html_file = stem.with_suffix(".html")
        png_file = stem.with_suffix(".png")
        html_file.write_text(render_html(label, path, start, end, desc), encoding="utf-8")
        size = shoot(html_file, png_file)
        print(f"  {label:5s} {png_file.name:10s} {size[0]}x{size[1]}  {end - start + 1} lines  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

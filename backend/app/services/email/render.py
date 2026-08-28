"""Builds the final HTML for an email from the shared design in
`templates/*.html`. The visual design lives only in those files — this module
never hardcodes a color or a layout, only assembles the pieces and escapes
untrusted text.
"""
from __future__ import annotations

from html import escape
from pathlib import Path

_TEMPLATES_DIR = Path(__file__).parent / "templates"

_SHELL = (_TEMPLATES_DIR / "_shell.html").read_text(encoding="utf-8")
_BUTTON = (_TEMPLATES_DIR / "_button.html").read_text(encoding="utf-8")


def escape_name(text: str) -> str:
    """Escape one dynamic value (a name, title, reference, etc.) for
    interpolation into an f-string passed to paragraph(). Every value that
    came from the database and is being dropped into running prose must go
    through this first — paragraph() itself does not escape, since it also
    has to accept pre-built fragments containing real <strong> tags."""
    return escape(str(text))


def paragraph(text: str) -> str:
    """One body paragraph, inserted as-is — the caller is responsible for
    escaping any dynamic value first, via escape_name() or bold()."""
    return f'<p style="margin:0 0 14px;">{text}</p>'


def bold(text: str) -> str:
    return f"<strong>{escape(str(text))}</strong>"


def mask_email(email: str) -> str:
    """jo***@domain.com — keep the first 2 characters of the local part,
    mask the rest, keep the domain in full. New formatting convention (no
    existing precedent in this codebase); adjust here if the design changes."""
    local, _, domain = str(email).partition("@")
    if not domain:
        return "***"
    visible = local[:2]
    return f"{visible}{'*' * max(len(local) - len(visible), 3)}@{domain}"


def quote(text: str) -> str:
    """A reviewer/rejection comment, set off from paragraph text."""
    return (
        '<div style="border-left:3px solid #ffc64a; padding:2px 0 2px 14px; '
        'margin:4px 0 16px; color:#5f6d7f; font-style:italic;">'
        f"{escape(str(text))}</div>"
    )

def detail_block(rows: list[tuple[str, str]]) -> str:
    """The dark-navy structured-facts block (schedule, credentials, etc).
    `rows` is a list of (label, value) pairs, both escaped and rendered as
    plain white text — never a real link, and wrapped so mail clients (Gmail
    in particular) don't auto-linkify anything that looks like an email
    address or number sequence (e.g. a password or code) into a clickable
    blue link on their own."""
    row_html = "".join(
        '<tr>'
        f'<td style="padding:3px 0; color:#ffffff; width:90px; vertical-align:top;">{escape(str(label))}</td>'
        f'<td style="padding:3px 0; color:#ffffff; font-weight:600;">{_no_autolink(str(value))}</td>'
        '</tr>'
        for label, value in rows
    )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="background-color:#07182c; border-radius:8px; margin:4px 0 16px;">'
        '<tr><td style="padding:14px 16px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
        'style="font-size:13px; font-family:Roboto,Arial,Helvetica,sans-serif;">'
        f"{row_html}</table></td></tr></table>"
    )


def _no_autolink(raw_text: str) -> str:
    """Break up a value so mail clients' automatic email/URL/phone detection
    (Gmail, Outlook, Apple Mail each run their own, independently of any HTML
    we send) never sees one unbroken run of text to pattern-match against.
    A zero-width space after '@' alone isn't enough — a bare domain like
    "example.com" still autolinks on its own. Wrapping every character in
    its own <span> defeats every detector without changing what's displayed
    or what gets copy-pasted (adjacent same-styled spans copy back together
    as plain text in every mail client tested). Escapes each character AFTER
    splitting, so a literal '&' in a password becomes one escaped "&amp;"
    span rather than four separate spans that would break the entity apart."""
    return "".join(
        f'<span style="color:#ffffff !important; text-decoration:none !important;">{escape(ch)}</span>'
        for ch in raw_text
    )


def render(
    *,
    subject: str,
    preheader: str,
    body_paragraphs: list[str],
    cta_label: str | None = None,
    cta_link: str | None = None,
) -> str:
    """Assemble the full HTML document for one email.

    `body_paragraphs` are already-built HTML fragments (use paragraph(),
    quote(), detail_block() above) — this function only escapes `subject`
    and `preheader`, and wires the optional CTA button.
    """
    cta_html = ""
    if cta_label and cta_link:
        cta_html = _BUTTON.replace("{{cta_label}}", escape(cta_label)).replace("{{cta_link}}", escape(cta_link, quote=True))

    html = _SHELL
    html = html.replace("{{subject}}", escape(subject))
    html = html.replace("{{preheader}}", escape(preheader))
    html = html.replace("{{body_html}}", "".join(body_paragraphs))
    html = html.replace("{{cta_html}}", cta_html)
    return html

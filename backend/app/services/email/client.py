"""Low-level SMTP send (e.g. Gmail). Nothing else in this codebase should
import `smtplib`/`email.mime` for outgoing mail — go through `send()`.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.image import MIMEImage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import make_msgid, parseaddr
from pathlib import Path

from ...config import config

logger = logging.getLogger(__name__)

# The header logo travels INSIDE the message rather than being fetched from a
# URL. A remote <img> would need a publicly reachable https host - which a
# localhost deployment does not have - and Gmail/Outlook proxy or block remote
# images anyway, both of which showed up as a broken-image icon in the header.
#
# An embedded part has none of those problems: the bytes are already in the
# message, so it renders offline, on localhost, and with remote images turned
# off. The template references it by Content-ID (`src="cid:apu-logo"`), so this
# constant and the one in _shell.html must stay in step.
_LOGO_CID = "apu-logo"
_LOGO_PATH = Path(__file__).parent / "assets" / "apu-logo-only.png"


def _logo_part() -> MIMEImage | None:
    """The logo as a MIME part, or None if the asset is missing.

    A missing file must not stop the email: the header falls back to the
    <img>'s alt text, which is a far better outcome than not sending at all.
    """
    try:
        image = MIMEImage(_LOGO_PATH.read_bytes(), _subtype="png")
    except (OSError, ValueError) as exc:
        logger.warning("email.logo_unavailable", extra={"reason": str(exc)})
        return None
    # Angle brackets are required by RFC 2392; the cid: URL in the HTML omits
    # them, which is why the two spellings differ.
    image.add_header("Content-ID", f"<{_LOGO_CID}>")
    image.add_header("Content-Disposition", "inline", filename="apu-logo.png")
    return image


def send(*, to: str | list[str], subject: str, html: str) -> bool:
    """Send one email over SMTP. Returns True if the server accepted it.

    Never raises: a broken email send must not fail the request that
    triggered it (e.g. approving a proposal shouldn't 500 because the SMTP
    server is down). Failures are logged instead.
    """
    if not config.smtp_host:
        logger.info("email.skipped_no_smtp_host", extra={"subject": subject, "to": to})
        return False
    if not config.email_from:
        logger.warning("email.skipped_no_sender", extra={"subject": subject, "to": to})
        return False

    recipients = [to] if isinstance(to, str) else list(to)
    all_recipients = list(recipients) + list(config.email_cc)

    # multipart/related wrapping multipart/alternative: "related" is what binds
    # the HTML to the images it references by cid, and "alternative" stays the
    # inner part so a text-only client still has somewhere to look.
    message = MIMEMultipart("related")
    message["Subject"] = subject
    message["From"] = config.email_from
    message["To"] = ", ".join(recipients)
    if config.email_cc:
        message["Cc"] = ", ".join(config.email_cc)
    message["Message-ID"] = make_msgid()

    alternative = MIMEMultipart("alternative")
    alternative.attach(MIMEText(html, "html"))
    message.attach(alternative)

    logo = _logo_part()
    if logo is not None:
        message.attach(logo)

    try:
        with smtplib.SMTP(config.smtp_host, config.smtp_port, timeout=10) as server:
            server.starttls()
            if config.smtp_username:
                server.login(config.smtp_username, config.smtp_password)
            # Envelope sender must be a bare address ("user@domain"), not the
            # "Display Name <user@domain>" form used in the From header.
            envelope_from = parseaddr(config.email_from)[1] or config.email_from
            server.sendmail(envelope_from, all_recipients, message.as_string())
        logger.info("email.sent", extra={"subject": subject, "to": recipients})
        return True
    except smtplib.SMTPException as exc:
        logger.error("email.failed", extra={"subject": subject, "to": recipients, "reason": str(exc)})
        return False
    except OSError as exc:
        logger.error("email.failed", extra={"subject": subject, "to": recipients, "reason": str(exc)})
        return False

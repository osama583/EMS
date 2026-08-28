"""Low-level SMTP send (e.g. Gmail). Nothing else in this codebase should
import `smtplib`/`email.mime` for outgoing mail — go through `send()`.
"""
from __future__ import annotations

import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import parseaddr

from ...config import config

logger = logging.getLogger(__name__)


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

    message = MIMEMultipart("alternative")
    message["Subject"] = subject
    message["From"] = config.email_from
    message["To"] = ", ".join(recipients)
    if config.email_cc:
        message["Cc"] = ", ".join(config.email_cc)
    message.attach(MIMEText(html, "html"))

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

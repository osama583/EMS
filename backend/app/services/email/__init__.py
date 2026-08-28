"""Email notifications.

One place for the whole system: `client.send()` is the only code that talks
to the SMTP server, `render.py` builds the shared HTML shell, and
`notifications.py` has one function per notification type
(`proposal_rejected(...)`, `account_created(...)`, etc). Callers everywhere
else just import from `app.services.email` and call the notification
function for what happened — they never touch HTML or SMTP directly.
"""
from __future__ import annotations

from . import notifications

__all__ = ["notifications"]

"""Transactional email sender (best-effort, SMTP).

Sends candidate-facing emails (exam links, interview invites + schedules) via the
SMTP relay configured in settings (`smtp_*` / `email_from`). In the demo tier this
is Resend used as an SMTP relay (see .env.example); in local dev it points at a
catch-all like MailHog (localhost:1025).

Uses the stdlib ``smtplib`` run in a worker thread (``asyncio.to_thread``) so we
add no new dependency and never block the event loop. Sending is BEST-EFFORT: any
failure is logged and swallowed (returns False) so a flaky mail relay can never
fail an HR action or a candidate's exam submission.
"""

from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage
from email.utils import formataddr

import structlog

from app.config import settings

log = structlog.get_logger(__name__)


def _send_sync(msg: EmailMessage) -> None:
    """Blocking SMTP send (runs in a worker thread)."""
    if settings.smtp_port == 465:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_user:
                smtp.login(settings.smtp_user, settings.smtp_password)
            smtp.send_message(msg)
        return
    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
        if settings.smtp_use_tls:
            smtp.starttls()
        if settings.smtp_user:
            smtp.login(settings.smtp_user, settings.smtp_password)
        smtp.send_message(msg)


async def send_email(
    *, to: str, subject: str, html: str, text: str | None = None
) -> bool:
    """Send one email. Returns True on success, False (logged) on any failure.

    Never raises — callers treat email as best-effort and must not fail their
    request if delivery fails.
    """
    if not to or "@" not in to:
        log.warning("email.skip_invalid_recipient", to=to)
        return False

    msg = EmailMessage()
    msg["From"] = formataddr((settings.email_from_name, settings.email_from))
    msg["To"] = to
    msg["Subject"] = subject
    # Plain-text fallback first, then the HTML alternative.
    msg.set_content(text or _strip_html(html))
    msg.add_alternative(html, subtype="html")

    try:
        await asyncio.to_thread(_send_sync, msg)
        log.info("email.sent", to=to, subject=subject)
        return True
    except Exception as exc:  # noqa: BLE001 - smtplib raises many types; best-effort
        log.warning("email.send_failed", to=to, subject=subject, error=str(exc))
        return False


def _strip_html(html: str) -> str:
    """Crude HTML→text fallback for the plain-text part (no external dep)."""
    import re

    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return text.strip()

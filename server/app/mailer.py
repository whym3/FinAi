"""Outgoing email. Returns False when SMTP is not configured so the caller can show the link instead."""
import logging
import smtplib
from email.message import EmailMessage

from .config import settings

log = logging.getLogger('pravah.mail')


def configured() -> bool:
    return bool(settings.smtp_host)


def send(to: str, subject: str, body: str) -> bool:
    if not configured():
        return False
    msg = EmailMessage()
    msg['From'], msg['To'], msg['Subject'] = settings.smtp_from, to, subject
    msg.set_content(body)
    try:
        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as s:
            s.starttls()
            if settings.smtp_user:
                s.login(settings.smtp_user, settings.smtp_password)
            s.send_message(msg)
        return True
    except Exception as e:  # the link is still shown to the admin
        log.warning('email to %s failed: %s', to, e)
        return False

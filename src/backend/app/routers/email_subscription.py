"""
T13910: subscriber email opt-out. Public: the link's token IS the credential.

GET  /api/email/unsubscribe?token=...  -- the link in every subscriber email
POST /api/email/unsubscribe?token=...  -- RFC 8058 one-click (List-Unsubscribe-Post)
POST /api/email/resubscribe?token=...  -- the "subscribe again" button on the page

The opt-out lives on users.email_opted_out_at (Postgres), which is what
scripts/email_subscribers.py filters on. Each page is a tiny self-contained
HTML document: the API serves it so the link works with no session and no SPA.

GET mutates on purpose (owner's call: one click unsubscribes). Tradeoff: a mail
scanner that prefetches links (Outlook SafeLinks, Proofpoint) can opt a user out
unseen; the page's "subscribe again" button is the recovery. Pages send no
Referer so the token never leaks to the outbound "Open ReelBallers" link.
"""

import logging

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app.services.auth_db import set_email_opt_out_by_token
from app.services.email import _html_escape

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/email", tags=["email"])


def _page(title: str, message: str, form_html: str = "", status_code: int = 200) -> HTMLResponse:
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<meta name="referrer" content="no-referrer">
<title>{title} - ReelBallers</title>
</head>
<body style="margin:0;padding:48px 16px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;border-top:4px solid #7c3aed;">
  <h1 style="color:#111827;font-size:22px;margin:0 0 12px 0;">{title}</h1>
  <p style="color:#374151;font-size:16px;line-height:24px;margin:0 0 20px 0;">{message}</p>
  {form_html}
  <p style="margin:24px 0 0 0;font-size:14px;"><a href="https://app.reelballers.com" style="color:#6d28d9;">Open ReelBallers</a></p>
</div>
</body>
</html>"""
    return HTMLResponse(html, status_code=status_code)


def _not_found() -> HTMLResponse:
    return _page(
        "Link not recognized",
        "This unsubscribe link is not valid. Reply to any of our emails and we will remove you by hand.",
        status_code=404,
    )


def _unsubscribed_page(token: str, email: str) -> HTMLResponse:
    form = (
        f'<form method="post" action="/api/email/resubscribe?token={_html_escape(token)}">'
        '<button type="submit" style="padding:10px 20px;background:#ffffff;color:#6d28d9;'
        'border:1px solid #6d28d9;border-radius:6px;font-size:14px;cursor:pointer;">'
        "Unsubscribed by mistake? Subscribe again</button></form>"
    )
    return _page(
        "You are unsubscribed",
        f"{_html_escape(email)} will no longer get ReelBallers update emails. "
        "Account emails (sign-in codes, shares) still arrive.",
        form,
    )


@router.get("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe_link(token: str = Query(...)):
    row = set_email_opt_out_by_token(token, True)
    if not row:
        return _not_found()
    return _unsubscribed_page(token, row["email"])


@router.post("/unsubscribe", response_class=HTMLResponse)
async def unsubscribe_one_click(token: str = Query(...)):
    """RFC 8058: mail clients POST `List-Unsubscribe=One-Click` here. The body
    carries nothing we need; the token in the URL identifies the user."""
    row = set_email_opt_out_by_token(token, True)
    if not row:
        return _not_found()
    return _unsubscribed_page(token, row["email"])


@router.post("/resubscribe", response_class=HTMLResponse)
async def resubscribe(token: str = Query(...)):
    row = set_email_opt_out_by_token(token, False)
    if not row:
        return _not_found()
    return _page(
        "You are subscribed again",
        f"{_html_escape(row['email'])} will get ReelBallers update emails again.",
    )

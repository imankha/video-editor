"""
Email service — sends transactional emails via Resend API.

Used by the OTP auth flow (T401) to send 6-digit verification codes.
"""

import logging
import os

import httpx

from app.utils.retry import retry_async_call, TIER_1

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
FROM_ADDRESS = "Reel Ballers <noreply@reelballers.com>"


async def send_otp_email(to_email: str, code: str) -> None:
    """Send a 6-digit OTP code to the given email address via Resend."""
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        raise ValueError("RESEND_API_KEY not configured")

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 400px; margin: 0 auto; padding: 32px;">
      <h2 style="color: #ffffff; margin-bottom: 8px;">Your verification code</h2>
      <div style="font-size: 36px; font-weight: bold; letter-spacing: 8px; color: #3b82f6; padding: 24px 0;">
        {code}
      </div>
      <p style="color: #9ca3af; font-size: 14px;">
        Enter this code in the app to sign in. It expires in 10 minutes.
      </p>
      <hr style="border: none; border-top: 1px solid #374151; margin: 24px 0;" />
      <p style="color: #6b7280; font-size: 12px;">
        If you didn't request this code, you can safely ignore this email.
      </p>
    </div>
    """

    async def _send():
        async with httpx.AsyncClient(timeout=10.0) as client:
            return await client.post(
                RESEND_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "from": FROM_ADDRESS,
                    "to": [to_email],
                    "subject": f"Your verification code: {code}",
                    "html": html_body,
                },
            )

    resp = await retry_async_call(_send, operation="resend_otp", **TIER_1)
    if resp.status_code not in (200, 201):
        logger.error(f"[Email] Resend API error: {resp.status_code} {resp.text}")
        raise RuntimeError(f"Failed to send email: {resp.status_code}")

    logger.info(f"[Email] OTP sent to {to_email}")


async def send_problem_report_email(
    to_emails: list[str],
    reporter_email: str | None,
    user_agent: str,
    page_url: str,
    logs: list[dict],
    description: str | None = None,
    screenshot: str | None = None,
    build: str | None = None,
) -> None:
    """Send a problem report (client console logs) to admin emails via Resend.

    T1650: "Report a problem" button. Each log entry is {level, message, ts}.
    """
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        raise ValueError("RESEND_API_KEY not configured")

    log_rows = "\n".join(
        f'<tr style="border-bottom:1px solid #374151">'
        f'<td style="padding:4px 8px;color:{"#f87171" if entry.get("level") == "error" else "#fbbf24"};font-size:12px">{entry.get("level", "?")}</td>'
        f'<td style="padding:4px 8px;color:#9ca3af;font-size:11px;white-space:nowrap">{entry.get("ts", "")}</td>'
        f'<td style="padding:4px 8px;color:#e5e7eb;font-size:12px;font-family:monospace;word-break:break-all">{_html_escape(entry.get("message", ""))}</td>'
        f'</tr>'
        for entry in logs[-100:]  # cap at 100 even if client sends more
    )

    # User description section
    description_html = ""
    if description:
        description_html = f"""
      <div style="margin-bottom:16px;padding:12px;background:#111827;border-radius:6px;border-left:3px solid #3b82f6">
        <div style="color:#9ca3af;font-size:11px;margin-bottom:4px">User description:</div>
        <div style="color:#e5e7eb;font-size:14px;white-space:pre-wrap">{_html_escape(description[:2000])}</div>
      </div>"""

    # Screenshot section (inline base64 image)
    screenshot_html = ""
    if screenshot and screenshot.startswith("data:image/"):
        screenshot_html = f"""
      <div style="margin-bottom:16px">
        <div style="color:#9ca3af;font-size:11px;margin-bottom:4px">Screenshot:</div>
        <img src="{screenshot}" style="max-width:100%;border-radius:6px;border:1px solid #374151" />
      </div>"""

    # Email subject includes description preview if available
    subject_preview = ""
    if description:
        preview = description[:60].replace("\n", " ")
        if len(description) > 60:
            preview += "..."
        subject_preview = f" - {preview}"

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 700px; margin: 0 auto; padding: 24px; background: #1f2937; color: #e5e7eb;">
      <h2 style="color: #f87171; margin-bottom: 16px;">Problem Report</h2>
      <table style="margin-bottom: 16px; font-size: 13px;">
        <tr><td style="color:#9ca3af;padding-right:12px">Reporter:</td><td style="color:#e5e7eb">{_html_escape(reporter_email or '(not logged in)')}</td></tr>
        <tr><td style="color:#9ca3af;padding-right:12px">Page:</td><td style="color:#e5e7eb">{_html_escape(page_url)}</td></tr>
        <tr><td style="color:#9ca3af;padding-right:12px">Browser:</td><td style="color:#e5e7eb;font-size:11px">{_html_escape(user_agent)}</td></tr>
        <tr><td style="color:#9ca3af;padding-right:12px">Time:</td><td style="color:#e5e7eb">{_html_escape(logs[-1]["ts"] if logs else "N/A")}</td></tr>
        <tr><td style="color:#9ca3af;padding-right:12px">Build:</td><td style="color:#e5e7eb;font-family:monospace;font-size:12px">{_html_escape(build or 'unknown')}</td></tr>
      </table>
      {description_html}
      {screenshot_html}
      <h3 style="color:#fbbf24;margin-bottom:8px">Console Logs ({len(logs)} entries)</h3>
      <table style="width:100%;border-collapse:collapse;background:#111827;border-radius:4px">
        <tr style="border-bottom:2px solid #374151">
          <th style="padding:6px 8px;text-align:left;color:#9ca3af;font-size:11px">Level</th>
          <th style="padding:6px 8px;text-align:left;color:#9ca3af;font-size:11px">Time</th>
          <th style="padding:6px 8px;text-align:left;color:#9ca3af;font-size:11px">Message</th>
        </tr>
        {log_rows or '<tr><td colspan="3" style="padding:12px;color:#6b7280;text-align:center">No logs captured</td></tr>'}
      </table>
    </div>
    """

    async def _send():
        async with httpx.AsyncClient(timeout=10.0) as client:
            return await client.post(
                RESEND_API_URL,
                headers={"Authorization": f"Bearer {api_key}"},
                json={
                    "from": FROM_ADDRESS,
                    "to": to_emails,
                    "subject": f"Problem Report: {reporter_email or 'anonymous'}{subject_preview}",
                    "html": html_body,
                },
            )

    resp = await retry_async_call(_send, operation="resend_problem_report", **TIER_1)
    if resp.status_code not in (200, 201):
        logger.error(f"[Email] Problem report send failed: {resp.status_code} {resp.text}")
        raise RuntimeError(f"Failed to send problem report: {resp.status_code}")

    logger.info(f"[Email] Problem report sent to {to_emails} from {reporter_email or 'anonymous'}")


def _html_escape(s: str) -> str:
    """Minimal HTML escape for email content."""
    return (s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )

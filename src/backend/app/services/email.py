"""
Email service — sends transactional emails via Resend API.

Used by the OTP auth flow (T401) to send 6-digit verification codes.
"""

import base64
import logging
import os

import httpx

from app.utils.retry import retry_async_call, TIER_1

logger = logging.getLogger(__name__)

RESEND_API_URL = "https://api.resend.com/emails"
FROM_ADDRESS = "Reel Ballers <noreply@reelballers.com>"

# T1740: CAN-SPAM compliant footer for all emails (used by OTP + bug reports)
_CAN_SPAM_FOOTER = """
<p style="color: #6b7280; font-size: 11px; margin-top: 16px; text-align: center;">
  Reel Ballers<br/>
  <a href="https://app.reelballers.com/privacy" style="color: #6b7280;">Privacy Policy</a>
  &nbsp;|&nbsp;
  <a href="https://app.reelballers.com/terms" style="color: #6b7280;">Terms of Service</a>
</p>
"""

_FONT_STACK = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"


def _build_share_email(
    heading: str,
    game_name: str,
    cta_url: str | None,
    cta_text: str,
    footer_reason: str,
    is_first_touch: bool,
    preheader: str = "",
) -> str:
    heading = _html_escape(heading)
    game_name = _html_escape(game_name)
    footer_reason = _html_escape(footer_reason)
    preheader = _html_escape(preheader)

    preheader_html = ""
    if preheader:
        preheader_html = (
            f'<div style="display:none;font-size:1px;line-height:1px;max-height:0px;'
            f'max-width:0px;opacity:0;overflow:hidden;">{preheader}</div>'
        )

    cta_html = ""
    if cta_url:
        cta_html = (
            f'<a href="{_html_escape(cta_url)}" style="display:inline-block;'
            f"min-width:200px;height:50px;line-height:50px;padding:0 32px;"
            f"background:#6d28d9;color:#ffffff;text-decoration:none;"
            f"border-radius:6px;font-weight:700;font-size:16px;"
            f'font-family:{_FONT_STACK};text-align:center;">'
            f"{_html_escape(cta_text)}</a>"
        )

    trust_html = ""
    if is_first_touch:
        trust_html = (
            '<p style="color:#4b5563;font-size:14px;line-height:22px;margin:24px 0 0 0;">'
            "No account needed to watch.</p>"
            '<p style="color:#4b5563;font-size:14px;line-height:22px;margin:8px 0 0 0;">'
            "Reel Ballers helps soccer parents create and share game highlights.</p>"
        )

    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<title>{heading}</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:{_FONT_STACK};">
{preheader_html}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;">
  <tr><td style="height:4px;background:#7c3aed;font-size:0;line-height:0;">&nbsp;</td></tr>
  <tr><td style="padding:24px 32px 0 32px;text-align:center;">
    <a href="https://reelballers.com" style="text-decoration:none;">
      <table role="presentation" width="56" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr><td style="text-align:left;color:#111827;font-size:14px;font-weight:700;font-family:{_FONT_STACK};line-height:1;">Reel</td></tr>
        <tr><td style="text-align:center;padding:4px 0;"><img src="https://app.reelballers.com/icon-email.png" width="40" height="40" alt="Reel Ballers" style="display:block;width:40px;height:40px;border:0;margin:0 auto;"></td></tr>
        <tr><td style="text-align:right;color:#111827;font-size:14px;font-weight:700;font-family:{_FONT_STACK};line-height:1;">Ballers</td></tr>
      </table>
    </a>
  </td></tr>
  <tr><td style="padding:20px 32px 32px 32px;">
    <p style="color:#111827;font-size:24px;line-height:32px;font-weight:700;margin:0 0 8px 0;">{heading}</p>
    <p style="color:#1f2937;font-size:20px;line-height:28px;font-weight:600;margin:0 0 24px 0;">{game_name}</p>
    <div style="text-align:center;margin:0 0 8px 0;">{cta_html}</div>
    {trust_html}
  </td></tr>
  <tr><td style="padding:0 32px;"><hr style="border:none;border-top:1px solid #e5e7eb;margin:0;"></td></tr>
  <tr><td style="padding:24px 32px;">
    <p style="color:#4b5563;font-size:13px;line-height:20px;margin:0 0 8px 0;">
      Sent via <a href="https://reelballers.com" style="color:#6d28d9;text-decoration:none;">Reel Ballers</a>
    </p>
    <p style="color:#4b5563;font-size:13px;line-height:20px;margin:0 0 16px 0;">{footer_reason}</p>
    <p style="color:#6b7280;font-size:12px;line-height:18px;margin:0;">
      <a href="https://app.reelballers.com/privacy" style="color:#6b7280;text-decoration:underline;">Privacy Policy</a>
      &nbsp;&middot;&nbsp;
      <a href="https://app.reelballers.com/terms" style="color:#6b7280;text-decoration:underline;">Terms of Service</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>"""


def _resolve_sender_name(sharer_email: str) -> str:
    local_part = sharer_email.split("@")[0] if "@" in sharer_email else sharer_email
    name = local_part.replace(".", " ").replace("_", " ").replace("-", " ")
    return name.title()


def _is_existing_user(email: str) -> bool:
    from .pg import get_pg
    with get_pg() as conn:
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM users WHERE email = %s", (email.lower().strip(),))
        return cur.fetchone() is not None


def _sanitize_from_name(name: str) -> str:
    return name.replace("<", "").replace(">", "").replace('"', "")


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
      {_CAN_SPAM_FOOTER}
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


def _format_editor_context_html(ctx: dict) -> str:
    """Format editor context snapshot as an HTML section for the problem report email."""
    rows = []
    mode = ctx.get("mode", "unknown")
    rows.append(f"<tr><td style='color:#9ca3af;padding-right:12px'>Mode:</td><td style='color:#60a5fa;font-weight:bold'>{_html_escape(mode)}</td></tr>")

    if ctx.get("game"):
        g = ctx["game"]
        rows.append(f"<tr><td style='color:#9ca3af;padding-right:12px'>Game:</td><td style='color:#e5e7eb'>#{g.get('id')} {_html_escape(str(g.get('name', '')))}</td></tr>")

    if ctx.get("project"):
        p = ctx["project"]
        rows.append(f"<tr><td style='color:#9ca3af;padding-right:12px'>Project:</td><td style='color:#e5e7eb'>#{p.get('id')} ({p.get('clipCount', 0)} clips, selected={p.get('selectedClipId')})</td></tr>")

    v = ctx.get("video", {})
    if v.get("duration"):
        rows.append(f"<tr><td style='color:#9ca3af;padding-right:12px'>Video:</td><td style='color:#e5e7eb'>time={v.get('currentTime')}s / {v.get('duration')}s playing={v.get('isPlaying')}</td></tr>")

    if ctx.get("framing"):
        f = ctx["framing"]
        rows.append(f"<tr><td style='color:#9ca3af;padding-right:12px'>Framing:</td><td style='color:#e5e7eb'>clipId={f.get('currentClipId')} changed={f.get('changedSinceExport')}</td></tr>")

    if ctx.get("overlay"):
        o = ctx["overlay"]
        rows.append(f"<tr><td style='color:#9ca3af;padding-right:12px'>Overlay:</td><td style='color:#e5e7eb'>effect={o.get('effectType')} changed={o.get('changedSinceExport')}</td></tr>")

    table_rows = "\n".join(rows)

    # Annotate clips table — the most valuable debugging data
    annotate_html = ""
    if ctx.get("annotate"):
        a = ctx["annotate"]
        clip_rows = ""
        for c in a.get("clips", []):
            selected = " style='background:#1e3a5f'" if c.get("i") is not None and a.get("selectedRegionId") else ""
            clip_rows += f"<tr{selected}><td style='padding:2px 8px'>{c.get('i', 0) + 1}</td><td style='padding:2px 8px'>{c.get('start')}s</td><td style='padding:2px 8px'>{c.get('end')}s</td><td style='padding:2px 8px'>{c.get('rating')}</td><td style='padding:2px 8px'>{c.get('seq')}</td></tr>"
        annotate_html = f"""
      <div style="margin-top:8px">
        <div style="color:#9ca3af;font-size:11px;margin-bottom:4px">Annotate: {a.get('clipCount', 0)} clips, selected={a.get('selectedRegionId')}</div>
        <table style="font-size:11px;font-family:monospace;border-collapse:collapse;color:#e5e7eb">
          <tr style="color:#9ca3af"><th style="padding:2px 8px;text-align:left">#</th><th style="padding:2px 8px;text-align:left">Start</th><th style="padding:2px 8px;text-align:left">End</th><th style="padding:2px 8px;text-align:left">Rating</th><th style="padding:2px 8px;text-align:left">Seq</th></tr>
          {clip_rows}
        </table>
      </div>"""

    return f"""
      <div style="margin-bottom:16px;padding:12px;background:#111827;border-radius:6px;border-left:3px solid #a855f7">
        <div style="color:#a855f7;font-size:11px;font-weight:bold;margin-bottom:8px">EDITOR CONTEXT</div>
        <table style="font-size:13px">{table_rows}</table>
        {annotate_html}
      </div>"""


def format_log_text(logs: list[dict]) -> str:
    """Format console log entries into deduplicated plain text.

    Used by report_problem to upload to R2, and by the legacy email path.
    """
    deduped = []
    prev_key = None
    repeat_count = 0
    for entry in logs[-200:]:
        key = (entry.get("level"), entry.get("message"))
        if key == prev_key:
            repeat_count += 1
            continue
        if repeat_count > 0:
            deduped.append({"_repeat": repeat_count})
        prev_key = key
        repeat_count = 0
        deduped.append(entry)
    if repeat_count > 0:
        deduped.append({"_repeat": repeat_count})
    if len([e for e in deduped if "level" in e]) > 50:
        deduped = [e for e in deduped if e.get("level") != "info"]
    log_lines = []
    for entry in deduped:
        if "_repeat" in entry:
            n = entry["_repeat"]
            log_lines.append(f"         ... repeated {n} more time{'s' if n > 1 else ''}")
        else:
            level = entry.get("level", "?").upper().ljust(5)
            ts = entry.get("ts", "")
            msg = entry.get("message", "")
            log_lines.append(f"[{level}] {ts}  {msg}")
    return "\n".join(log_lines) if log_lines else "(no logs captured)"


async def send_problem_report_email(
    to_emails: list[str],
    reporter_email: str | None,
    user_agent: str,
    page_url: str,
    logs: list[dict],
    description: str | None = None,
    screenshot: str | None = None,
    build: str | None = None,
    actions: list[dict] | None = None,
    editor_context: dict | None = None,
) -> None:
    """Send a problem report (client console logs) to admin emails via Resend.

    T1650: "Report a problem" button. Each log entry is {level, message, ts}.
    Legacy path -- report_problem now uses send_bug_notification_email instead.
    """
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        raise ValueError("RESEND_API_KEY not configured")

    log_text = format_log_text(logs)
    log_attachment_b64 = base64.b64encode(log_text.encode("utf-8")).decode("ascii")

    # Editor context section — inline in the email for quick debugging
    context_html = ""
    if editor_context:
        context_html = _format_editor_context_html(editor_context)

    # Action breadcrumbs attachment
    actions_attachment = None
    if actions:
        action_lines = []
        for entry in actions[-50:]:
            ts = entry.get("ts", "")
            action = entry.get("action", "?")
            detail = entry.get("detail", {})
            detail_str = ", ".join(f"{k}={v}" for k, v in detail.items()) if detail else ""
            action_lines.append(f"{ts}  {action}  {detail_str}")
        actions_text = "\n".join(action_lines) if action_lines else "(no actions captured)"
        actions_attachment = {
            "filename": "action-breadcrumbs.txt",
            "content": base64.b64encode(actions_text.encode("utf-8")).decode("ascii"),
        }

    # User description section
    description_html = ""
    if description:
        description_html = f"""
      <div style="margin-bottom:16px;padding:12px;background:#111827;border-radius:6px;border-left:3px solid #3b82f6">
        <div style="color:#9ca3af;font-size:11px;margin-bottom:4px">User description:</div>
        <div style="color:#e5e7eb;font-size:14px;white-space:pre-wrap">{_html_escape(description[:2000])}</div>
      </div>"""

    # Screenshot: attach as image file, reference via cid: for inline display
    # (Gmail strips data: URLs from emails, so inline base64 won't render)
    screenshot_html = ""
    screenshot_attachment = None
    if screenshot and screenshot.startswith("data:image/"):
        # Strip the data URL prefix to get raw base64
        # Format: data:image/jpeg;base64,/9j/4AAQ...
        _header, screenshot_b64 = screenshot.split(",", 1)
        screenshot_attachment = {
            "filename": "screenshot.jpg",
            "content": screenshot_b64,
        }
        screenshot_html = ""

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
      {context_html}
    </div>
    """

    attachments = [{"filename": "console-logs.txt", "content": log_attachment_b64}]
    if actions_attachment:
        attachments.append(actions_attachment)
    if screenshot_attachment:
        attachments.append(screenshot_attachment)

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
                    "attachments": attachments,
                },
            )

    resp = await retry_async_call(_send, operation="resend_problem_report", **TIER_1)
    if resp.status_code not in (200, 201):
        logger.error(f"[Email] Problem report send failed: {resp.status_code} {resp.text}")
        raise RuntimeError(f"Failed to send problem report: {resp.status_code}")

    logger.info(f"[Email] Problem report sent to {to_emails} from {reporter_email or 'anonymous'}")


async def send_bug_notification_email(
    to_emails: list[str],
    bug_id: int,
    reporter_email: str | None,
    description: str | None = None,
    mode: str | None = None,
) -> None:
    """Send a lightweight bug notification email (no attachments). All data is in Postgres + R2."""
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        raise ValueError("RESEND_API_KEY not configured")

    desc_preview = ""
    if description:
        preview = description[:80].replace("\n", " ")
        if len(description) > 80:
            preview += "..."
        desc_preview = f" - {preview}"

    subject = f"Bug #{bug_id}{desc_preview}"

    description_html = ""
    if description:
        description_html = f"""
      <div style="margin-bottom:16px;padding:12px;background:#111827;border-radius:6px;border-left:3px solid #3b82f6">
        <div style="color:#e5e7eb;font-size:14px;white-space:pre-wrap">{_html_escape(description[:2000])}</div>
      </div>"""

    html_body = f"""
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background: #1f2937; color: #e5e7eb;">
      <h2 style="color: #f87171; margin-bottom: 16px;">Bug #{bug_id}</h2>
      <table style="margin-bottom: 16px; font-size: 13px;">
        <tr><td style="color:#9ca3af;padding-right:12px">Reporter:</td><td style="color:#e5e7eb">{_html_escape(reporter_email or '(anonymous)')}</td></tr>
        <tr><td style="color:#9ca3af;padding-right:12px">Mode:</td><td style="color:#e5e7eb">{_html_escape(mode or 'unknown')}</td></tr>
      </table>
      {description_html}
      <p style="color:#6b7280;font-size:12px;margin-top:16px">Full details available in the admin task board.</p>
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
                    "subject": subject,
                    "html": html_body,
                },
            )

    resp = await retry_async_call(_send, operation="resend_bug_notification", **TIER_1)
    if resp.status_code not in (200, 201):
        logger.error(f"[Email] Bug notification send failed: {resp.status_code} {resp.text}")
        raise RuntimeError(f"Failed to send bug notification: {resp.status_code}")

    logger.info(f"[Email] Bug #{bug_id} notification sent to {to_emails}")


DOMAIN_MAP = {
    "production": "app.reelballers.com",
    "staging": "reel-ballers-staging.pages.dev",
    "dev": "localhost:5173",
}


def _get_share_url(share_token: str, share_type: str = "video") -> str:
    from app.storage import APP_ENV
    domain = DOMAIN_MAP.get(APP_ENV, "localhost:5173")
    scheme = "http" if "localhost" in domain else "https"
    if share_type == "game":
        return f"{scheme}://{domain}/shared/teammate/{share_token}"
    if share_type == "collection":
        return f"{scheme}://{domain}/shared/collection/{share_token}"
    return f"{scheme}://{domain}/shared/{share_token}"


async def send_collection_share_email(
    recipient_email: str,
    sharer_email: str,
    share_token: str,
    collection_title: str,
    sender_name: str = "",
    is_first_touch: bool = True,
) -> bool:
    """Send a collection share link (T3620). Models send_share_email; the link
    is a LIVE collection that always shows the sharer's current reels."""
    api_key = os.getenv("RESEND_API_KEY")
    share_url = _get_share_url(share_token, share_type="collection")

    if not api_key:
        logger.warning(
            f"[Email] DEV MODE -- collection share email to {recipient_email} "
            f"for '{collection_title}'. Share URL: {share_url}"
        )
        return True

    display_name = sender_name or sharer_email
    safe_title = collection_title or "Highlights"

    if is_first_touch:
        subject = f"{display_name} shared a highlight collection with you"
        heading = f"{display_name} shared {safe_title}"
        preheader = f"Watch now -- always the latest reels from {display_name}."
    else:
        subject = f"New shared collection: {safe_title}"
        heading = f"{display_name} shared {safe_title}"
        preheader = safe_title

    from_address = f"{_sanitize_from_name(display_name)} via Reel Ballers <noreply@reelballers.com>"

    html_body = _build_share_email(
        heading=heading,
        game_name=safe_title,
        cta_url=share_url,
        cta_text="Watch Highlights",
        footer_reason=f"{display_name} shared a collection with you",
        is_first_touch=is_first_touch,
        preheader=preheader,
    )

    try:
        async def _send():
            async with httpx.AsyncClient(timeout=10.0) as client:
                return await client.post(
                    RESEND_API_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "from": from_address,
                        "to": [recipient_email],
                        "subject": subject,
                        "html": html_body,
                    },
                )

        resp = await retry_async_call(_send, operation="resend_collection_share", **TIER_1)
        if resp.status_code not in (200, 201):
            logger.error(f"[Email] Collection share email failed: {resp.status_code} {resp.text}")
            return False
        logger.info(f"[Email] Collection share email sent to {recipient_email}")
        return True
    except Exception as e:
        logger.error(f"[Email] Collection share email to {recipient_email} failed: {e}")
        return False


async def send_share_email(
    recipient_email: str,
    sharer_email: str,
    share_token: str,
    video_name: str,
    sender_name: str = "",
    is_first_touch: bool = True,
) -> bool:
    api_key = os.getenv("RESEND_API_KEY")
    share_url = _get_share_url(share_token)

    if not api_key:
        logger.warning(
            f"[Email] DEV MODE -- share email to {recipient_email} "
            f"for '{video_name}'. Share URL: {share_url}"
        )
        return True

    display_name = sender_name or sharer_email
    safe_video = video_name or "Untitled"

    if is_first_touch:
        subject = f"{display_name} shared a highlight reel with you"
        heading = f"{display_name} shared a highlight reel"
        preheader = f"Watch now -- {display_name} thought you'd want to see this."
    else:
        subject = f"New shared reel: {safe_video}"
        heading = f"{display_name} shared a highlight reel"
        preheader = safe_video

    from_address = f"{_sanitize_from_name(display_name)} via Reel Ballers <noreply@reelballers.com>"

    html_body = _build_share_email(
        heading=heading,
        game_name=safe_video,
        cta_url=share_url,
        cta_text="Watch Reel",
        footer_reason=f"{display_name} shared a video with you",
        is_first_touch=is_first_touch,
        preheader=preheader,
    )

    try:
        async def _send():
            async with httpx.AsyncClient(timeout=10.0) as client:
                return await client.post(
                    RESEND_API_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "from": from_address,
                        "to": [recipient_email],
                        "subject": subject,
                        "html": html_body,
                    },
                )

        resp = await retry_async_call(_send, operation="resend_share", **TIER_1)
        if resp.status_code not in (200, 201):
            logger.error(f"[Email] Share email failed: {resp.status_code} {resp.text}")
            return False
        logger.info(f"[Email] Share email sent to {recipient_email}")
        return True
    except Exception as e:
        logger.error(f"[Email] Share email to {recipient_email} failed: {e}")
        return False


async def send_teammate_share_email(
    recipient_email: str,
    sharer_email: str,
    tag_name: str,
    game_name: str,
    clip_count: int,
    share_token: str | None = None,
    sender_name: str = "",
    is_first_touch: bool = True,
) -> bool:
    api_key = os.getenv("RESEND_API_KEY")
    if not api_key:
        share_url = _get_share_url(share_token, "game") if share_token else "(no token)"
        logger.warning(
            f"[Email] DEV MODE -- teammate share email to {recipient_email} "
            f"for tag '{tag_name}' on '{game_name}' ({clip_count} clips). "
            f"Share URL: {share_url}"
        )
        return True

    clip_text = f"{clip_count} clip{'' if clip_count == 1 else 's'}" if clip_count > 0 else "clips"
    share_url = _get_share_url(share_token, "game") if share_token else None
    display_name = sender_name or sharer_email
    safe_game = game_name or "Untitled Game"

    if is_first_touch:
        subject = f"{display_name} tagged {tag_name} in a highlight from {safe_game}"
        heading = f"{display_name} clipped highlights from"
        preheader = f"Watch {tag_name}'s highlight -- {display_name} thought you'd want to see this."
    else:
        subject = f"New clip: {tag_name} tagged in {safe_game}"
        heading = f"{display_name} tagged {tag_name} in {clip_text} from"
        preheader = f"{clip_text} from {safe_game}"

    from_address = f"{_sanitize_from_name(display_name)} via Reel Ballers <noreply@reelballers.com>"

    html_body = _build_share_email(
        heading=heading,
        game_name=safe_game,
        cta_url=share_url,
        cta_text="Watch Clips",
        footer_reason=f"{display_name} shared game clips with you",
        is_first_touch=is_first_touch,
        preheader=preheader,
    )

    try:
        async def _send():
            async with httpx.AsyncClient(timeout=10.0) as client:
                return await client.post(
                    RESEND_API_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "from": from_address,
                        "to": [recipient_email],
                        "subject": subject,
                        "html": html_body,
                    },
                )

        resp = await retry_async_call(_send, operation="resend_teammate_share", **TIER_1)
        if resp.status_code not in (200, 201):
            logger.error(f"[Email] Teammate share email failed: {resp.status_code} {resp.text}")
            return False
        logger.info(f"[Email] Teammate share email sent to {recipient_email} for tag '{tag_name}'")
        return True
    except Exception as e:
        logger.error(f"[Email] Teammate share email to {recipient_email} failed: {e}")
        return False


async def send_game_share_email(
    recipient_email: str,
    sharer_email: str,
    game_name: str,
    share_token: str | None = None,
    sender_name: str = "",
    is_first_touch: bool = True,
) -> bool:
    api_key = os.getenv("RESEND_API_KEY")
    share_url = _get_share_url(share_token, "game") if share_token else None

    if not api_key:
        logger.warning(
            f"[Email] DEV MODE -- game share email to {recipient_email} "
            f"for '{game_name}'. Share URL: {share_url or '(no token)'}"
        )
        return True

    display_name = sender_name or sharer_email
    safe_game = game_name or "Untitled Game"

    if is_first_touch:
        subject = f"{display_name} shared game footage with you"
        heading = f"{display_name} shared a game with you"
        preheader = f"Watch {safe_game} -- no account needed."
    else:
        subject = f"{display_name} shared {safe_game} with you"
        heading = f"{display_name} shared a game with you"
        preheader = safe_game

    from_address = f"{_sanitize_from_name(display_name)} via Reel Ballers <noreply@reelballers.com>"

    html_body = _build_share_email(
        heading=heading,
        game_name=safe_game,
        cta_url=share_url,
        cta_text="View Game",
        footer_reason=f"{display_name} shared game footage with you",
        is_first_touch=is_first_touch,
        preheader=preheader,
    )

    try:
        async def _send():
            async with httpx.AsyncClient(timeout=10.0) as client:
                return await client.post(
                    RESEND_API_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "from": from_address,
                        "to": [recipient_email],
                        "subject": subject,
                        "html": html_body,
                    },
                )

        resp = await retry_async_call(_send, operation="resend_game_share", **TIER_1)
        if resp.status_code not in (200, 201):
            logger.error(f"[Email] Game share email failed: {resp.status_code} {resp.text}")
            return False
        logger.info(f"[Email] Game share email sent to {recipient_email} for '{game_name}'")
        return True
    except Exception as e:
        logger.error(f"[Email] Game share email to {recipient_email} failed: {e}")
        return False


async def send_playback_share_email(
    recipient_email: str,
    sharer_email: str,
    game_name: str,
    share_token: str | None = None,
    sender_name: str = "",
    is_first_touch: bool = True,
) -> bool:
    api_key = os.getenv("RESEND_API_KEY")
    share_url = _get_share_url(share_token, "game") if share_token else None

    if not api_key:
        logger.warning(
            f"[Email] DEV MODE -- playback share email to {recipient_email} "
            f"for '{game_name}'. Share URL: {share_url or '(no token)'}"
        )
        return True

    display_name = sender_name or sharer_email
    safe_game = game_name or "Untitled Game"

    if is_first_touch:
        subject = f"{display_name} shared game annotations with you"
        heading = f"{display_name} shared annotations from"
        preheader = f"Watch annotated clips from {safe_game} -- no account needed."
    else:
        subject = f"{display_name} shared annotations from {safe_game}"
        heading = f"{display_name} shared annotations from"
        preheader = f"Annotated clips from {safe_game}"

    from_address = f"{_sanitize_from_name(display_name)} via Reel Ballers <noreply@reelballers.com>"

    html_body = _build_share_email(
        heading=heading,
        game_name=safe_game,
        cta_url=share_url,
        cta_text="Watch Annotations",
        footer_reason=f"{display_name} shared game annotations with you",
        is_first_touch=is_first_touch,
        preheader=preheader,
    )

    try:
        async def _send():
            async with httpx.AsyncClient(timeout=10.0) as client:
                return await client.post(
                    RESEND_API_URL,
                    headers={"Authorization": f"Bearer {api_key}"},
                    json={
                        "from": from_address,
                        "to": [recipient_email],
                        "subject": subject,
                        "html": html_body,
                    },
                )

        resp = await retry_async_call(_send, operation="resend_playback_share", **TIER_1)
        if resp.status_code not in (200, 201):
            logger.error(f"[Email] Playback share email failed: {resp.status_code} {resp.text}")
            return False
        logger.info(f"[Email] Playback share email sent to {recipient_email} for '{game_name}'")
        return True
    except Exception as e:
        logger.error(f"[Email] Playback share email to {recipient_email} failed: {e}")
        return False


def _html_escape(s: str) -> str:
    """Minimal HTML escape for email content."""
    return (s
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )

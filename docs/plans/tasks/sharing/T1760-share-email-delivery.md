# T1760: Share Email Delivery

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-05-01

## Problem

After creating a share record (T1750), the recipient has no way to discover the shared video unless the sharer manually copies and sends the link. An email notification makes sharing feel complete.

## Solution

Send a share invitation email when a share is created. Reuse the existing Resend integration.

## Context

### What Already Exists

- **Resend integration** in `src/backend/app/services/email.py`:
  - `send_otp_email()` — sends OTP codes
  - `send_problem_report_email()` — sends problem reports
  - From address: `Reel Ballers <noreply@reelballers.com>`
  - API key already configured via env var
- **Share creation endpoint** at `POST /api/gallery/{video_id}/share` in `src/backend/app/routers/shares.py`
  - Returns `ShareCreateResponse` with list of `{ share_token, recipient_email, is_existing_user }`
  - Already handles both empty recipients (public link) and named recipients
- **Share link format**: `https://{APP_DOMAIN}/shared/{share_token}`
  - `APP_DOMAIN` is derived from `APP_ENV`: prod → `reelballers.com`, staging → `staging.reelballers.com`, dev → `localhost:5173`
- **Sharer identity**: `get_user_by_id(user_id)` returns `{ email, ... }` from auth.sqlite
- **No video thumbnails exist** — final_videos table has filename, name, duration but no thumbnail

### Relevant Files

- Modify: `src/backend/app/services/email.py` — Add `send_share_email()` function
- Modify: `src/backend/app/routers/shares.py` — Call `send_share_email()` after creating shares
- The email should NOT be sent for public link self-shares (where recipient_email = sharer email and is_public=true)

### Related Tasks
- Depends on: T1750 (share model + endpoints must exist)
- Related: T1650 (Report a Problem — same Resend pattern)

### Technical Notes

- **Fire-and-forget**: Share record is created regardless of email delivery. Email send runs in background (`asyncio.to_thread` or just catch-and-log). Log failures but don't block the response.
- **Don't email for public self-shares**: When `recipient_emails` is empty and `is_public=true`, the backend creates a share with the sharer's own email — don't send an email for this case.
- **Email template**: Simple HTML with:
  - Subject: `"{sharer_name} shared a video with you on Reel Ballers"`
  - Body: Video name, sharer email, CTA button linking to `/shared/{share_token}`
  - No thumbnail (none available)
- **APP_DOMAIN mapping** for link construction:
  ```python
  DOMAIN_MAP = {
      'production': 'reelballers.com',
      'staging': 'staging.reelballers.com',
      'development': 'localhost:5173',
  }
  ```

## Implementation

### Steps
1. [ ] Add `send_share_email(recipient_email, sharer_email, share_token, video_name)` to `email.py`
2. [ ] Design email template (HTML) — subject, video name, CTA button
3. [ ] Wire `create_share` endpoint to call `send_share_email` per recipient (skip self-shares)
4. [ ] Add APP_DOMAIN mapping for link construction
5. [ ] Test email delivery (Resend test mode or staging)

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Creating a share sends an email to each recipient
- [ ] Email contains clickable link to `/shared/{shareToken}`
- [ ] Email includes sharer email and video name
- [ ] No email sent for public self-shares (empty recipient list + is_public=true)
- [ ] Email failure does not block share creation (fire-and-forget with logging)
- [ ] Email not sent for already-revoked shares

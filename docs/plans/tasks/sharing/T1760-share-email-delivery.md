# T1760: Share Email Delivery

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

After creating a share record (T1750), the recipient needs to receive an email with a link. No email template or send-on-share logic exists.

## Solution

Create a share invitation email template and trigger it when a share is created. Reuse the existing Resend client from T1650 ("Report a Problem").

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/email_utils.py` - Resend email sending, add share email function
- `src/backend/app/routers/gallery.py` - POST share endpoint triggers email after creating record

### Related Tasks
- Depends on: T1750 (share model + endpoints must exist)
- Related: T1650 (Report a Problem — same Resend integration)

### Technical Notes

- Resend API key already configured in backend
- Email should include: sharer's name/email, video thumbnail if available, clear CTA button linking to `/shared/{shareToken}`
- Link format: `https://{APP_DOMAIN}/shared/{shareToken}`
- Fire-and-forget is acceptable — share record is created regardless of email delivery. Log email failures.

## Implementation

### Steps
1. [ ] Add `send_share_email(recipient_email, sharer_email, share_token, video_title)` to email_utils.py
2. [ ] Design email template (HTML) with CTA button
3. [ ] Wire POST share endpoint to call send_share_email after creating record
4. [ ] Test email delivery (Resend test mode or staging)

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Creating a share sends an email to the recipient
- [ ] Email contains a clickable link to `/shared/{shareToken}`
- [ ] Email includes sharer identity (name or email)
- [ ] Email failure does not block share creation (fire-and-forget with logging)

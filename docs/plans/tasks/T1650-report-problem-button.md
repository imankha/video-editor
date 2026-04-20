# T1650: Report a Problem Button

**Status:** TESTING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-04-20
**Updated:** 2026-04-20

## Problem

When users hit login failures or other errors, we have no visibility into what happened on the client side. Backend logs help but can't capture frontend-only issues (GIS load failures, cookie blocking, JS errors, browser quirks). Currently the only option is asking users to open DevTools and paste console output -- unrealistic for non-technical users.

## Solution

Add a "Report a problem" button visible during auth flows (and optionally elsewhere). On click, send accumulated browser console errors/warnings + user agent + context to all admin emails via Resend.

### Design

1. **Client-side log ring buffer** -- capture all `console.error` and `console.warn` calls into a capped in-memory array (~100 entries). Each entry: `{level, message, timestamp}`. Installed early in app boot (before auth).

2. **"Report a problem" button** -- shown on:
   - AuthGateModal (below OTP form)
   - AuthErrorBanner (next to dismiss)
   - Optionally: a global help menu item for authenticated users

3. **POST /api/auth/report-problem** -- receives `{logs, userAgent, url, email?}`, sends formatted email to all admins (query `admin_users` table). Uses existing Resend integration.

4. **Auth-specific enrichment** -- auth flow logs (from googleAuth.js, sessionInit.js, OtpAuthForm) should be captured with structured prefixes so they're easy to spot in the report.

## Context

### Relevant Files
- `src/frontend/src/utils/clientLogger.js` -- NEW: ring buffer + console.error/warn interceptor
- `src/frontend/src/components/ReportProblemButton.jsx` -- NEW: button component
- `src/frontend/src/components/AuthGateModal.jsx` -- Add report button
- `src/frontend/src/components/AuthErrorBanner.jsx` -- Add report button
- `src/frontend/index.html` -- Install logger early (before React)
- `src/backend/app/routers/auth.py` -- New POST endpoint
- `src/backend/app/services/email.py` -- New `send_problem_report_email` function
- `src/backend/app/services/auth_db.py` -- Query admin_users for recipient list

### Related Tasks
- Benefits from: auth-robustness branch (just landed improved logging)
- Related to: T1510 (admin impersonation -- another support debugging tool)

### Technical Notes
- Ring buffer must be installed before React mounts (in index.html or early in main.jsx) to capture boot errors
- Admin email list comes from `admin_users` table (currently contains imankh@gmail.com)
- Rate limit the endpoint (max 3 reports per email per hour) to prevent abuse
- No PII beyond email (which is voluntary) and user agent
- Logs are ephemeral (in-memory only, lost on page refresh) -- this is intentional

## Implementation

### Steps
1. [ ] Create `clientLogger.js` ring buffer with console.error/warn interception
2. [ ] Install logger in index.html (before React) or top of main.jsx
3. [ ] Create `ReportProblemButton.jsx` component
4. [ ] Add button to AuthGateModal and AuthErrorBanner
5. [ ] Add `get_admin_emails()` helper to auth_db.py
6. [ ] Add `send_problem_report_email()` to email.py
7. [ ] Add POST `/api/auth/report-problem` endpoint with rate limiting
8. [ ] Backend import check + frontend build check

## Acceptance Criteria

- [ ] Console errors and warnings are captured in ring buffer (max 100 entries)
- [ ] "Report a problem" button visible on auth modal and error banner
- [ ] Clicking button sends report email to all admin_users
- [ ] Email contains: logs, user agent, URL, timestamp, user email (if known)
- [ ] Rate limited: max 3 reports per session per hour
- [ ] Report confirmation shown to user ("Report sent, we'll look into it")
- [ ] Backend logs the report submission

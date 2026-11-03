# T14510: Sign-in code email heading may be invisible

**Status:** TODO
**Impact:** 8
**Complexity:** 2
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

The sign-in (OTP) email's heading "Your verification code" is styled `color: #ffffff` inside a
container that sets no background. In light-mode mail clients (Gmail web, Apple Mail light) the
heading is white on white. The grey body text and the `#3b82f6` code colour also assume a dark
background the email never sets. Sign-in is the first thing a new parent does.

Found by the 2026-11-03 copy audit ([copy-vocabulary/audit/E-landing-backend.md](copy-vocabulary/audit/E-landing-backend.md) D4).

## Solution

First confirm: render the HTML (or send a test to a light-mode client) and screenshot it. If it
is unreadable, either set an explicit dark background on the container (matching the other
transactional emails) or switch the heading to dark text. Match the styling of the other emails
in `email.py`.

## Context

### Relevant Files
- `src/backend/app/services/email.py` (~line 510-520: OTP `html_body`)
- Backend test for the OTP email body, if any (grep `verification code` in `src/backend/tests`)

### Technical Notes
- Copy rules from the email module docstring apply (no em dashes).
- Do not send real email from tests (see `scripts/test_share_emails.py` warning in memory).

## Implementation

1. [ ] Render the current HTML and record whether the heading is visible on white
2. [ ] Failing test: the OTP HTML either sets a container background or uses a non-white heading colour
3. [ ] Fix the styling; render again and screenshot light and dark clients
4. [ ] Explicit lint (ruff)

## Acceptance Criteria

- [ ] Heading and code are readable in a light-mode client and a dark-mode client (screenshots)
- [ ] Styling matches the other transactional emails
- [ ] Tests pass

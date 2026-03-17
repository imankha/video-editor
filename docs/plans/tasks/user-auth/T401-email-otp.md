# T401: Email OTP Auth

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-03-12
**Updated:** 2026-03-12

## Problem

Not everyone will use Google. ~60% of our demographic (men in late 40s) defaults to email-based flows. Email OTP (type a 6-digit code in-app) has ~85%+ success rate vs ~75-80% for magic links, because the user never leaves the app.

## Solution

Wire the email input + OTP entry screens in the auth modal (from T400) to real backend endpoints. Backend generates a 6-digit code, sends it via Resend (~$0.001/email), and verifies it. On success, same outcome as Google OAuth — email stored in per-user SQLite, session created.

## Context

### Relevant Files
- `src/frontend/src/components/AuthGateModal.jsx` - From T400: wire email/OTP screens to real API
- `src/backend/app/routers/auth.py` - Add send-otp + verify-otp endpoints
- `src/backend/app/services/email.py` - NEW: Resend HTTP client
- `src/backend/app/database.py` - Add otp_codes table to per-user SQLite

### Related Tasks
- Depends on: T400 (modal UI + auth infrastructure exists)
- Blocks: T515 (free credits granted on first email verify)

### Technical Notes

**POST /api/auth/send-otp**
```
Request:  { email: "user@example.com" }
Response: { success: true }

Backend:
1. Generate random 6-digit code (cryptographically secure)
2. Store in per-user SQLite otp_codes table (expires in 10 minutes)
3. Invalidate any existing codes for this user
4. Send via Resend API
5. Rate limit: max 3 codes per user per hour (tracked in SQLite)
```

**POST /api/auth/verify-otp**
```
Request:  { email: "user@example.com", code: "123456" }
Response: { success: true }

Backend:
1. Look up code in otp_codes table
2. Check not expired, not used
3. Mark as used
4. Store email in auth_profile (same table Google uses)
5. Create session (same as Google flow)
6. Set session cookie
```

**Per-user SQLite OTP table:**
```sql
CREATE TABLE IF NOT EXISTS otp_codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    attempts INTEGER DEFAULT 0,        -- track failed attempts
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Why OTP storage in per-user SQLite works:**
- We know the user from their guest cookie (X-User-ID)
- OTP is scoped to their session — they entered email, we sent code to that email
- We're verifying THEIR code in THEIR database
- No cross-user lookup needed (that's T405's job)

**Resend integration:**
```python
async def send_otp_email(to_email: str, code: str):
    async with httpx.AsyncClient() as client:
        await client.post(
            "https://api.resend.com/emails",
            headers={"Authorization": f"Bearer {RESEND_API_KEY}"},
            json={
                "from": "Reel Ballers <noreply@reelballers.com>",
                "to": [to_email],
                "subject": f"Your code: {code}",
                "html": f"<p>Your Reel Ballers verification code is: <strong>{code}</strong></p><p>Expires in 10 minutes.</p>",
            },
        )
```

**Frontend changes to AuthGateModal:**
- "Send Code" → POST /api/auth/send-otp → transition to OTP entry screen
- 6 digit inputs with auto-advance on type
- "Verify" → POST /api/auth/verify-otp → on success, same flow as Google
- Error states: invalid code (inline), expired (show resend), rate limited (show wait time)
- "Resend" → POST /api/auth/send-otp again
- "Change email" → back to email input screen

**Security:**
- Codes are 6 random digits (100,000 possibilities)
- Max 5 verification attempts per code (prevent brute force)
- Max 3 codes per user per hour (prevent spam)
- 10-minute expiry

## Implementation

### Steps
1. [ ] Add otp_codes table to per-user SQLite schema
2. [ ] Create email.py with Resend HTTP client
3. [ ] Add POST /api/auth/send-otp with rate limiting
4. [ ] Add POST /api/auth/verify-otp with attempt tracking
5. [ ] Wire AuthGateModal "Send Code" to real API
6. [ ] Wire AuthGateModal "Verify" to real API
7. [ ] Handle error states in modal (invalid, expired, rate limit)
8. [ ] Add RESEND_API_KEY to env vars + staging secrets
9. [ ] Test: send code → receive email → enter code → authenticated
10. [ ] Test: wrong code → error → retry → success
11. [ ] Test: expired code → resend → new code works
12. [ ] Test: rate limiting blocks after 3 sends/hour

## Acceptance Criteria

- [ ] Real email sent via Resend with 6-digit code
- [ ] Code validates correctly within 10-minute window
- [ ] Expired/used codes rejected with clear message
- [ ] Wrong code shows inline error, user can retry (max 5 attempts)
- [ ] Rate limiting prevents abuse (3 sends/hour per user)
- [ ] On success: same outcome as Google (session cookie, isAuthenticated, action proceeds)
- [ ] "Resend" sends a new code
- [ ] "Change email" returns to email input

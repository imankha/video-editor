# T1740 Kickoff Prompt: Privacy & Regulatory Compliance

## Task

Implement T1740. Read the task file: `docs/plans/tasks/T1740-privacy-compliance.md`

This is a pre-launch compliance task. The app (Reelballers) lets parents/coaches upload youth sports game footage containing minors. Before launch we must comply with COPPA, CCPA/CPRA, CalOPPA, FTC Act, and CAN-SPAM. The task spans legal document drafts, frontend pages/UI, backend API endpoints, and email template changes.

**Scope for this session:** Phase 2 (Technical Implementation) is the primary deliverable. Phase 1 (Legal Documents) should be drafted as markdown files for attorney review. Phase 3 (Process & Documentation) is out of scope for this session.

## What Needs to Change

### 1. Legal Document Drafts (Markdown files for attorney review)

**Create:** `docs/legal/privacy-policy.md`

Draft a privacy policy that satisfies CalOPPA + CCPA/CPRA + COPPA + FTC Act. Must include:
- Categories of PI collected: email, Google profile picture URL, Google ID, session tokens, video files (containing identifiable minors), usage data (Cloudflare Web Analytics), payment info (via Stripe, not stored directly)
- Third-party service providers who receive data:
  - **Cloudflare R2** -- video/file storage (bucket: `reel-ballers-users`)
  - **Modal** -- GPU video processing (receives user files from R2 temporarily)
  - **Fly.io** -- application hosting
  - **Resend** -- transactional email (OTP codes, share notifications)
  - **Google** -- OAuth identity (Google ID, email, profile picture)
  - **Stripe** -- payment processing (credit card data handled entirely by Stripe)
  - **Cloudflare Web Analytics** -- privacy-first analytics (no cookies, no PII tracking)
- Consumer rights: access, delete, correct, opt-out of sale/sharing, limit sensitive PI
- How to exercise rights: web form (in-app Account Settings) + email (privacy@reelballers.com)
- COPPA section: app is for parents/coaches (18+); children are data subjects in videos but do not create accounts; no biometric data extraction (framing is manual crop only)
- Data retention: games expire after 30 days (aligns with storage credits T1580); account data retained until deletion request; processing artifacts auto-deleted after export
- Do Not Track signal response: Cloudflare Web Analytics does not use cookies or track across sites, so DNT is effectively honored by default
- Effective date, update notification process
- Operator contact: Reelballers (physical address TBD by attorney), privacy@reelballers.com

**Create:** `docs/legal/terms-of-service.md`

Draft terms of service. Must include:
- User represents they are 18+ and have authority to upload content (parent/guardian of depicted minors)
- User responsibility for content legality
- Acceptable use policy
- Content ownership: user retains ownership; license grant to process/store/display
- Limitation of liability
- Dispute resolution (venue in California)
- DMCA takedown procedure

**Create:** `docs/legal/data-retention-policy.md`

Draft data retention and deletion policy:
- Video retention: 30-day game expiry per storage credits system
- Account data: deleted within 45 days of request (CCPA deadline)
- R2 objects: 14-day grace period before permanent deletion (existing `r2_grace_deletions` table)
- Modal GPU intermediates: auto-deleted after function execution (confirm with Modal docs)
- Backups: R2 is the only storage layer; no separate backups

### 2. Privacy Policy & ToS Pages in the App

**File:** `src/frontend/src/App.jsx`

The app uses Zustand `editorMode` for navigation (not React Router). There is one special URL-based route: `/shared/:token` detected via `window.location.pathname` at line 275-278.

Add similar URL-based routing for `/privacy` and `/terms`:

```jsx
// Around line 275, alongside the /shared/ detection:
const [legalPage, setLegalPage] = useState(() => {
  const path = window.location.pathname;
  if (path === '/privacy') return 'privacy';
  if (path === '/terms') return 'terms';
  return null;
});
```

Then in the render, before the auth gate:
```jsx
if (legalPage === 'privacy') return <PrivacyPolicy onClose={() => { setLegalPage(null); window.history.replaceState({}, '', '/'); }} />;
if (legalPage === 'terms') return <TermsOfService onClose={() => { setLegalPage(null); window.history.replaceState({}, '', '/'); }} />;
```

These pages must be accessible **without authentication** (CalOPPA requirement).

**Create:** `src/frontend/src/components/PrivacyPolicy.jsx`

Full-page component rendering the privacy policy content. Design:
- Full-screen scrollable page with dark background (matches app theme)
- Back/Close button to return to app
- Last updated date displayed prominently
- Table of contents with anchor links for each section
- Import content from a constants file or render inline (attorney will finalize text)

**Create:** `src/frontend/src/components/TermsOfService.jsx`

Same layout pattern as PrivacyPolicy.

### 3. Footer with Legal Links

**File:** `src/frontend/src/App.jsx`

The main app currently has **no footer**. Add a minimal footer at the bottom of the main app shell with:
- "Privacy Policy" link -> `/privacy`
- "Terms of Service" link -> `/terms`
- "Do Not Sell or Share My Personal Information" link -> opens privacy rights section in Account Settings (or scrolls to it)

The footer should be unobtrusive -- a single line below the main content, similar styling to how the landing page footer works (gray text on dark bg).

**File:** `src/landing/src/App.tsx`

The landing page has a minimal footer at lines 189-192 (just copyright). Expand it to include:
- Privacy Policy link
- Terms of Service link
- "Do Not Sell or Share My Personal Information" link
- Copyright line (existing)

For the landing page, privacy/terms links should point to `https://app.reelballers.com/privacy` (or wherever the app is hosted) since the landing page is a separate Vite project deployed to `reelballers.com`. Alternatively, render the legal pages on the landing page itself -- check with the user on preferred approach.

### 4. Age Verification Gate at Signup

**File:** `src/frontend/src/components/AuthGateModal.jsx` (or wherever the auth flow renders)

The current auth flow: user clicks Google One Tap or enters email for OTP -> account auto-created on first login (`_find_or_create_user()` in auth.py line 221).

Add an age confirmation step **after** authentication but **before** first use:

1. After successful Google/OTP auth, check if user is new (no profile exists yet)
2. Show a confirmation screen: "By continuing, you confirm that you are 18 years of age or older and agree to our [Privacy Policy](/privacy) and [Terms of Service](/terms)."
3. Checkbox or "I Confirm" button required to proceed
4. Store consent timestamp in the user record

**File:** `src/backend/app/routers/auth.py`

In the `POST /api/auth/init` endpoint (called after login), add:
- Accept an optional `age_confirmed: bool` and `accepted_terms_version: str` parameter
- If first-time user and no confirmation on record, return `{ needs_age_confirmation: true }` so frontend knows to show the gate
- Store in auth.sqlite: `terms_accepted_at`, `terms_version`, `age_confirmed_at`

**File:** `src/backend/app/services/auth_db.py`

Add columns to `users` table (via migration or CREATE TABLE IF NOT EXISTS pattern the app already uses):
- `terms_accepted_at TEXT` -- when they accepted
- `terms_version TEXT` -- which version (e.g., "2026-05-01")
- `age_confirmed_at TEXT` -- when they confirmed 18+

### 5. Consumer Rights in Account Settings

**File:** `src/frontend/src/components/AccountSettings.jsx`

Currently shows: avatar, email, Google link status, credit balance, Sign Out button (lines 1-104).

Add a "Your Privacy Rights" section below the credit balance:

```jsx
{/* Privacy Rights */}
<div className="border-t border-gray-700 pt-4 space-y-2">
  <h3 className="text-sm font-medium text-gray-400">Your Privacy Rights</h3>

  {/* Download My Data */}
  <button onClick={handleDownloadData} className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-white/10 rounded-lg transition-colors text-left">
    <Download size={16} className="text-gray-400" />
    <span className="text-sm text-gray-300">Download My Data</span>
  </button>

  {/* Delete My Account */}
  <button onClick={() => setShowDeleteConfirm(true)} className="w-full flex items-center gap-2 px-3 py-2 bg-white/5 hover:bg-red-900/20 rounded-lg transition-colors text-left">
    <Trash2 size={16} className="text-red-400" />
    <span className="text-sm text-red-300">Delete My Account</span>
  </button>

  {/* Do Not Sell toggle */}
  <div className="flex items-center justify-between px-3 py-2 bg-white/5 rounded-lg">
    <span className="text-sm text-gray-300">Do Not Sell or Share</span>
    <span className="text-xs text-green-400">Active</span>
    {/* We don't sell data, so this is always on -- but must be present per CCPA */}
  </div>

  <p className="text-xs text-gray-500">
    Questions? Contact <a href="mailto:privacy@reelballers.com" className="text-blue-400 hover:underline">privacy@reelballers.com</a>
  </p>
</div>
```

### 6. Data Export Endpoint (Backend)

**Create or extend:** `src/backend/app/routers/privacy.py`

New router with consumer rights endpoints:

```python
@router.post("/export-data")
async def export_user_data():
    """CCPA: Download all personal data as a ZIP file.

    Collects: auth record, user.sqlite, profile.sqlite(s), list of R2 objects.
    Does NOT include raw video files (too large) -- includes metadata + presigned URLs.
    45-day fulfillment deadline per CCPA.
    """
```

Implementation:
1. Read user row from auth.sqlite (email, created_at, last_seen_at, google_id presence)
2. Read user.sqlite (credits, transactions, settings, stripe customer ID)
3. For each profile: read profile.sqlite (games, clips, projects, exports -- metadata only)
4. List R2 objects under `{env}/users/{user_id}/` (keys + sizes, not content)
5. Package as JSON (not ZIP -- simpler, and the data is all structured). Include presigned URLs for any video files so user can download them separately.
6. Return as downloadable JSON file

```python
@router.delete("/delete-account")
async def delete_account():
    """CCPA: Full account deletion.

    Deletes: auth record, sessions, user.sqlite, all profile.sqlite(s),
    all R2 objects under user prefix, Stripe customer link.
    Preserves: nothing. This is permanent.
    """
```

Implementation:
1. Delete all R2 objects under `{env}/users/{user_id}/` (use existing R2 delete patterns)
2. Delete local user folder `user_data/{user_id}/`
3. Delete user row from auth.sqlite (cascades sessions, otp_codes)
4. Clear session cookie
5. Return confirmation

**Important:** The existing `DELETE /api/auth/user` endpoint (auth.py line 153-173) only deletes the local folder -- it does NOT delete R2 objects or auth DB records. The new `/delete-account` endpoint must do the complete deletion. Reference the `scripts/reset-test-user.py` script for the full deletion footprint, but adapt it for API use.

**File:** `src/backend/app/main.py`

Register the new router:
```python
from app.routers import privacy
app.include_router(privacy.router, prefix="/api/privacy", tags=["privacy"])
```

### 7. CAN-SPAM Compliance for Emails

**File:** `src/backend/app/services/email.py`

All three email types (OTP, problem report, share notification) need:

1. **Physical mailing address** in the footer (required by CAN-SPAM). Add to all HTML email templates:
   ```html
   <p style="color: #6b7280; font-size: 11px; margin-top: 16px;">
     Reel Ballers, [Physical Address TBD]<br/>
     <a href="https://app.reelballers.com/privacy" style="color: #6b7280;">Privacy Policy</a>
   </p>
   ```

2. **Unsubscribe mechanism** -- technically, transactional emails (OTP, share notifications triggered by user action) are exempt from CAN-SPAM's unsubscribe requirement. But best practice is to include an unsubscribe link on share emails since they could be viewed as commercial. OTP emails are definitively transactional and do not need unsubscribe.

3. For the share email (`send_share_email`, line 201-255), add an unsubscribe footer:
   ```html
   <p style="color: #6b7280; font-size: 11px;">
     You received this because {sharer_email} shared a video with you on Reel Ballers.<br/>
     <a href="https://app.reelballers.com/privacy" style="color: #6b7280;">Privacy Policy</a> |
     Reel Ballers, [Physical Address TBD]
   </p>
   ```

Note: share emails go to recipients who may not have accounts. Unsubscribe for non-users could simply be: "Reply STOP to opt out." Or: since these are one-off shares (not recurring), they may not need a formal unsubscribe flow.

### 8. Cookie/Tracking Consent

**Current tracking:** Cloudflare Web Analytics only (beacon script in `src/landing/index.html` line 10, and `src/frontend/src/utils/analytics.js`). Cloudflare Web Analytics is privacy-first -- no cookies, no cross-site tracking, no PII collection.

**Session cookie:** `rb_session` (httponly, 30-day max age) -- this is a strictly necessary functional cookie, exempt from consent requirements.

**Assessment:** No cookie consent banner is needed because:
- Cloudflare Web Analytics does not set cookies
- `rb_session` is a strictly necessary authentication cookie
- No third-party tracking pixels, Google Analytics, or advertising cookies

**Action:** Add a note in the privacy policy disclosing:
- Session cookie (`rb_session`) -- functional, authentication only
- Cloudflare Web Analytics -- privacy-preserving, cookieless analytics
- No advertising or tracking cookies

If the user decides to add any marketing/analytics cookies in the future, a consent banner will be needed at that point.

### 9. Global Privacy Control (GPC) Signal

**File:** `src/backend/app/main.py` or middleware

Per CCPA/CPRA, the app must honor the GPC browser signal (`Sec-GPC: 1` header). Since we don't sell or share data, honoring GPC means: do nothing differently (we already comply). But we should:

1. Log when GPC is detected (for compliance records)
2. Confirm in the privacy policy that GPC is honored

Add middleware or a check in the auth flow:
```python
gpc_header = request.headers.get("Sec-GPC", "0")
if gpc_header == "1":
    logger.debug(f"[Privacy] GPC signal detected for user {user_id}")
```

## Current State of Key Code

### App routing (App.jsx, ~line 275-278)

```jsx
const [sharedToken, setSharedToken] = useState(() => {
    const match = window.location.pathname.match(/^\/shared\/([a-f0-9-]+)$/i);
    return match ? match[1] : null;
});
```
No React Router. URL-based routes are detected via pathname regex in `useState` initializers. Privacy/terms routes should follow the same pattern.

### Account Settings (AccountSettings.jsx, full file)

Modal panel with: avatar, email, Google link status, credit balance, Sign Out. 104 lines total. The privacy rights section should be added between credit balance (line 87) and the Sign Out button (line 89).

### Auth flow (auth.py)

- `_find_or_create_user()` (line 221) -- auto-creates user on first login
- `POST /api/auth/init` -- called after login to set up user profile/DB
- No age verification or terms acceptance currently
- `DELETE /api/auth/user` (line 153-173) -- deletes local folder only, NOT R2 or auth DB

### Email service (email.py)

Three email functions, none with CAN-SPAM compliance:
- `send_otp_email()` -- OTP codes (transactional, exempt from most CAN-SPAM)
- `send_problem_report_email()` -- bug reports to admin (internal, exempt)
- `send_share_email()` -- video share notifications (gray area -- user-triggered but goes to non-users)

### Landing page footer (src/landing/src/App.tsx, lines 189-192)

```tsx
<footer className="container mx-auto px-4 py-8 text-center text-gray-500">
    <p>&copy; {new Date().getFullYear()} ReelBallers. All rights reserved.</p>
</footer>
```

### Data deletion footprint (from reset-test-user.py)

Complete user data to delete:
- Auth DB: `users` row, `sessions`, `credit_transactions`
- Local: `user_data/{user_id}/` folder
- R2: all objects under `{env}/users/{user_id}/`
- User DB tables: `raw_clips`, `projects`, `working_clips`, `working_videos`, `final_videos`, `export_jobs`, `achievements`, `before_after_tracks`, `pending_uploads`

### User table schema (auth_db.py)

```sql
CREATE TABLE IF NOT EXISTS users (
    user_id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    google_id TEXT UNIQUE,
    verified_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    last_seen_at TEXT,
    credit_summary INTEGER DEFAULT 0,
    picture_url TEXT
)
```
Missing: `terms_accepted_at`, `terms_version`, `age_confirmed_at`.

## Implementation Checklist

### Phase 1: Legal Drafts (~3 files, no code)
1. [ ] Draft `docs/legal/privacy-policy.md` covering CalOPPA + CCPA/CPRA + COPPA + FTC Act
2. [ ] Draft `docs/legal/terms-of-service.md`
3. [ ] Draft `docs/legal/data-retention-policy.md`

### Phase 2: Frontend Pages (~4 new components, ~3 modified files)
4. [ ] Create `PrivacyPolicy.jsx` -- full-page privacy policy component
5. [ ] Create `TermsOfService.jsx` -- full-page terms component
6. [ ] Add `/privacy` and `/terms` URL detection in `App.jsx` (unauthenticated access)
7. [ ] Expand landing page footer with legal links (`src/landing/src/App.tsx`)
8. [ ] Add footer with legal links to main app (`App.jsx`)

### Phase 3: Age Verification & Terms Acceptance (~2 files)
9. [ ] Add `terms_accepted_at`, `terms_version`, `age_confirmed_at` columns to `users` table in `auth_db.py`
10. [ ] Add age/terms confirmation gate in frontend auth flow (after login, before first use)
11. [ ] Update `POST /api/auth/init` to check/store terms acceptance

### Phase 4: Consumer Rights (~3 files)
12. [ ] Create `src/backend/app/routers/privacy.py` with `POST /export-data` and `DELETE /delete-account`
13. [ ] Register privacy router in `main.py`
14. [ ] Add privacy rights section to `AccountSettings.jsx` (Download Data, Delete Account, Do Not Sell)

### Phase 5: Email Compliance (~1 file)
15. [ ] Add physical address + privacy link footer to all email templates in `email.py`

### Phase 6: Verification (~0 lines, just reading)
16. [ ] Confirm no cookie consent banner needed (only functional cookie + cookieless analytics)
17. [ ] Confirm GPC is effectively honored (we don't sell/share data)
18. [ ] Confirm auto-navigate/shared routes still work after routing changes

## Classification

```
## Task Classification: T1740

**Stack Layers:** Frontend, Backend
**Files Affected:** ~10 files (3 new legal docs, 4 new components, 3 modified)
**LOC Estimate:** ~400 lines (legal docs are bulk; code is ~150 lines)
**Test Scope:** Backend (privacy endpoints), Frontend E2E (routing, account deletion flow)

### Agent Workflow
| Agent | Include | Justification |
|-------|---------|---------------|
| Code Expert | Yes | Cross-layer, 10+ files, needs to understand auth flow and R2 deletion patterns |
| Architect | Yes | New privacy router, new URL routing pattern, auth flow modification, needs design review |
| Tester | Yes | New API endpoints need backend tests; routing needs E2E verification |
| Reviewer | Yes | Compliance-critical, auth flow changes, data deletion (high corruption risk) |

### Skipped Stages
None - full workflow
```

## Acceptance Criteria

- [ ] Privacy policy published at `/privacy`, accessible without login
- [ ] Terms of service published at `/terms`, accessible without login
- [ ] Age verification gate (18+ confirmation) at account creation
- [ ] Terms acceptance recorded with timestamp and version
- [ ] Consumer rights in Account Settings: Download Data + Delete Account + Do Not Sell
- [ ] `POST /api/privacy/export-data` returns all user data as downloadable JSON
- [ ] `DELETE /api/privacy/delete-account` fully removes user (auth DB + R2 + local)
- [ ] "Do Not Sell or Share" link in footer of app and landing page
- [ ] Physical address + privacy link in email footers
- [ ] GPC signal acknowledged (logged when detected)
- [ ] Landing page footer includes Privacy, Terms, Do Not Sell links
- [ ] Main app footer includes Privacy, Terms, Do Not Sell links
- [ ] All legal documents marked "DRAFT -- Requires attorney review before launch"

## Important Notes

- **Attorney review required:** All legal documents are drafts. Mark them clearly as "DRAFT - For Attorney Review" at the top. Do not publish to production without legal review.
- **Physical address TBD:** Use a placeholder `[PHYSICAL ADDRESS]` in email footers and legal docs. The user will provide the actual address.
- **No cookie consent banner needed now:** Cloudflare Web Analytics is cookieless. `rb_session` is a strictly necessary functional cookie. Revisit if marketing cookies are added.
- **Data export excludes video files:** Video files can be multi-GB. The export includes metadata and presigned download URLs, not raw bytes.
- **Delete is destructive and permanent:** The delete-account endpoint should require explicit confirmation (the frontend should show a "type DELETE to confirm" dialog).
- **R2 grace deletion:** Consider using the existing 14-day `r2_grace_deletions` pattern for account deletion so the user has a recovery window, or make deletion immediate per user request. Check with the user.

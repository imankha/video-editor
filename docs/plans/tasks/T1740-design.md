# T1740 Design: Privacy & Regulatory Compliance

## Current State

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend (App.jsx)                                          │
│                                                              │
│  URL Detection: /shared/:token only                          │
│  Auth Gate: isCheckingSession → blocks render                │
│  No footer, no legal pages, no age verification              │
│                                                              │
│  AccountSettings: avatar, email, Google link, credits, logout│
│  No privacy rights section                                   │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Backend (auth.py)                                           │
│                                                              │
│  DELETE /api/auth/user: only deletes local folder            │
│  _reset_test_account(): full deletion (local + R2 + auth DB)│
│  No terms acceptance columns in users table                  │
│  No privacy/consumer-rights endpoints                        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Email (email.py)                                            │
│                                                              │
│  send_otp_email(): no CAN-SPAM footer                        │
│  send_share_email(): no CAN-SPAM footer, no physical address │
│  send_problem_report_email(): internal, no changes needed    │
└─────────────────────────────────────────────────────────────┘
```

## Target State

```
┌─────────────────────────────────────────────────────────────┐
│  Frontend                                                    │
│                                                              │
│  URL Detection: /shared/:token, /privacy, /terms             │
│  Legal pages render BEFORE auth gate (publicly accessible)   │
│  Footer: Privacy | Terms | Do Not Sell (on ProjectsScreen)   │
│  AccountSettings: + Privacy Rights section                   │
│  Auth flow: + Age/Terms confirmation gate for new users      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Backend                                                     │
│                                                              │
│  New router: /api/privacy                                    │
│    POST /export-data → JSON download of all user data        │
│    DELETE /delete-account → full deletion (R2 + auth + local)│
│                                                              │
│  auth_db: + terms_accepted_at, terms_version, age_confirmed  │
│  POST /api/auth/init: returns needs_age_confirmation flag    │
│  POST /api/auth/accept-terms: stores consent                 │
│  GPC middleware: logs Sec-GPC header                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Email                                                       │
│                                                              │
│  All templates: + physical address + privacy policy link     │
│  share email: + "why you received this" disclosure           │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Legal Documents (docs/legal/)                               │
│                                                              │
│  privacy-policy.md   — DRAFT for attorney review             │
│  terms-of-service.md — DRAFT for attorney review             │
│  data-retention-policy.md — DRAFT for attorney review        │
└─────────────────────────────────────────────────────────────┘
```

## Implementation Plan

### Phase 1: Legal Document Drafts (3 new files, no code changes)

**Files:**
- `docs/legal/privacy-policy.md` — CalOPPA + CCPA/CPRA + COPPA + FTC Act
- `docs/legal/terms-of-service.md` — Usage terms, liability, DMCA
- `docs/legal/data-retention-policy.md` — Retention periods, deletion procedures

All marked "DRAFT — For Attorney Review" at the top. Placeholder `[PHYSICAL ADDRESS]` for mailing address.

### Phase 2: Frontend Legal Pages (2 new components + App.jsx changes)

**New files:**
- `src/frontend/src/components/PrivacyPolicy.jsx`
- `src/frontend/src/components/TermsOfService.jsx`

**Design decisions:**
- Content rendered inline (not imported from a constants file) — attorney will finalize text directly in these components
- Full-screen scrollable page, dark bg (`bg-gray-900`), max-w-3xl centered
- "Back to app" button top-left
- Table of contents with scroll-to-section anchor links
- Last updated date prominent at top

**App.jsx changes (around line 275):**

```jsx
// Add alongside sharedToken detection:
const [legalPage] = useState(() => {
  const path = window.location.pathname;
  if (path === '/privacy') return 'privacy';
  if (path === '/terms') return 'terms';
  return null;
});
```

Then in the render, **before** `if (isCheckingSession) return null` (line 493):

```jsx
if (legalPage === 'privacy') return <PrivacyPolicy />;
if (legalPage === 'terms') return <TermsOfService />;
```

These pages have no "close" button that navigates back to `/` — they're standalone public pages. If users want to go to the app, they navigate directly. This matches CalOPPA's requirement that the policy be at a stable URL.

### Phase 3: Footer with Legal Links

**App.jsx** — Add a minimal footer inside the ProjectsScreen wrapper (line 512, inside `<div className="min-h-screen bg-gray-900">`):

```jsx
<footer className="text-center py-6 text-xs text-gray-500 space-x-4">
  <a href="/privacy" className="hover:text-gray-300">Privacy Policy</a>
  <span>|</span>
  <a href="/terms" className="hover:text-gray-300">Terms of Service</a>
  <span>|</span>
  <button onClick={openPrivacyRights} className="hover:text-gray-300">
    Do Not Sell or Share My Personal Information
  </button>
</footer>
```

Only shown on ProjectsScreen (the "home" view) — not inside editor screens.

**Landing page** (`src/landing/src/App.tsx` line 189-192) — Expand footer:

```tsx
<footer className="container mx-auto px-4 py-8 text-center text-gray-500 space-y-2">
  <div className="flex items-center justify-center gap-4 text-sm">
    <a href="https://app.reelballers.com/privacy" className="hover:text-gray-300">Privacy Policy</a>
    <span>|</span>
    <a href="https://app.reelballers.com/terms" className="hover:text-gray-300">Terms of Service</a>
    <span>|</span>
    <a href="https://app.reelballers.com/privacy#your-rights" className="hover:text-gray-300">Do Not Sell or Share</a>
  </div>
  <p>&copy; {new Date().getFullYear()} ReelBallers. All rights reserved.</p>
</footer>
```

### Phase 4: Age Verification & Terms Acceptance

**Backend — auth_db.py:** Add columns via idempotent ALTER TABLE pattern (same as `credit_summary`, `picture_url`):

```python
for col, default in [
    ("terms_accepted_at", "TEXT"),
    ("terms_version", "TEXT"),
    ("age_confirmed_at", "TEXT"),
]:
    try:
        db.execute(f"ALTER TABLE users ADD COLUMN {col} {default}")
    except sqlite3.OperationalError:
        pass
```

**Backend — auth.py:** New endpoint `POST /api/auth/accept-terms`:

```python
@router.post("/accept-terms")
async def accept_terms(request: Request):
    """Store age confirmation and terms acceptance for new users."""
    user_id = get_current_user_id()
    body = await request.json()
    version = body.get("terms_version", "2026-05-07")
    now = datetime.utcnow().isoformat()

    with get_auth_db() as db:
        db.execute("""
            UPDATE users SET terms_accepted_at = ?, terms_version = ?, age_confirmed_at = ?
            WHERE user_id = ?
        """, (now, version, now, user_id))
        db.commit()
    sync_auth_db_to_r2()
    return {"accepted": True}
```

**Backend — modify `GET /api/auth/whoami`:** Add `needs_age_confirmation` field:

```python
@router.get("/whoami")
async def whoami():
    user_id = get_current_user_id()
    with get_auth_db() as db:
        row = db.execute("SELECT terms_accepted_at FROM users WHERE user_id = ?", (user_id,)).fetchone()
    needs_confirmation = row and not row["terms_accepted_at"]
    return {"user_id": user_id, "needs_age_confirmation": needs_confirmation}
```

**Frontend — authStore:** After session check, if `needs_age_confirmation` is true, show confirmation modal. New state: `needsAgeConfirmation`. The modal renders:
- "By continuing, you confirm you are 18+ and agree to our Privacy Policy and Terms of Service"
- "I Confirm" button → calls `POST /api/auth/accept-terms` → clears gate

### Phase 5: Consumer Rights (Backend + Frontend)

**New file:** `src/backend/app/routers/privacy.py`

```python
router = APIRouter(prefix="/api/privacy", tags=["privacy"])

@router.post("/export-data")
async def export_user_data(request: Request, response: Response):
    """CCPA data export: returns all user data as downloadable JSON."""
    # 1. Auth record from auth.sqlite
    # 2. User DB data (credits, transactions, settings)
    # 3. Profile DB metadata (games, clips, projects - not video bytes)
    # 4. R2 object listing with presigned download URLs
    # Returns: application/json attachment

@router.delete("/delete-account")
async def delete_account(request: Request, response: Response):
    """CCPA full deletion. Pattern: _reset_test_account() adapted for API use."""
    # 1. Delete R2 objects under {env}/users/{user_id}/
    # 2. Delete local user_data/{user_id}/ folder
    # 3. Delete from auth DB (users + sessions)
    # 4. Sync auth DB to R2
    # 5. Clear session cookie
    # Returns: {"deleted": true}
```

**Register in main.py:**
```python
from app.routers.privacy import router as privacy_router
app.include_router(privacy_router)
```

**AccountSettings.jsx** — Add privacy rights section between credits and logout:
- Download My Data button → `POST /api/privacy/export-data` → triggers file download
- Delete My Account button → confirmation dialog ("type DELETE to confirm") → `DELETE /api/privacy/delete-account`
- Do Not Sell or Share → static "Active" badge (we don't sell data)
- Contact email link

### Phase 6: Email Compliance

**email.py** — Add a shared footer constant:

```python
CAN_SPAM_FOOTER = """
<p style="color: #6b7280; font-size: 11px; margin-top: 16px; text-align: center;">
  Reel Ballers, [PHYSICAL ADDRESS]<br/>
  <a href="https://app.reelballers.com/privacy" style="color: #6b7280;">Privacy Policy</a>
</p>
"""
```

Append to `send_otp_email()` and `send_share_email()` HTML bodies. The share email additionally gets a "why you received this" line.

`send_problem_report_email()` is internal (sent to admin) — exempt, no changes.

### Phase 7: GPC Signal Logging

**main.py** — Add lightweight middleware:

```python
@app.middleware("http")
async def gpc_signal_middleware(request: Request, call_next):
    if request.headers.get("Sec-GPC") == "1":
        logger.debug(f"[Privacy] GPC signal detected: {request.url.path}")
    return await call_next(request)
```

No behavioral change needed (we don't sell/share data).

## Risks & Decisions

| Item | Decision | Rationale |
|------|----------|-----------|
| Account deletion: immediate vs grace period? | **Immediate** | CCPA says "delete upon request." The 14-day R2 grace pattern is for game expiry, not account deletion. Users who delete mean it. |
| Landing page legal links: host on landing or app? | **Link to app** (`app.reelballers.com/privacy`) | Single source of truth. Landing page is a separate Vite project — duplicating legal content creates drift risk. |
| Age gate: checkbox vs button? | **Button** ("I Confirm, I am 18+") | Simpler UX, single click. A checkbox + submit is two actions for the same thing. |
| Legal page navigation: close button vs standalone? | **Standalone** (no close) | These are public URLs. Users arriving from Google shouldn't see a "close" button with nowhere to go. Link to homepage instead. |
| Data export format: ZIP vs JSON? | **JSON** | All data is structured. Video files are too large to include — provide presigned URLs instead. JSON is simpler to generate and inspect. |
| Terms version format? | **Date string** (`"2026-05-07"`) | Simple, sortable, no need for semver on legal docs. |

## Open Questions for User

1. **Landing page legal pages:** Should the landing page link to `app.reelballers.com/privacy`, or should we render separate legal pages on the landing site too? (I'm defaulting to linking to the app.)

2. **R2 grace deletion for accounts:** The design uses immediate deletion. Do you want a 14-day recovery window instead? (Users would see "Your account is scheduled for deletion in 14 days. Cancel?" — more complex but safer.)

3. **"Do Not Sell" footer link behavior:** Should it open Account Settings (requires login), or scroll to the privacy rights section on the privacy policy page (accessible without login)?

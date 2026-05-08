# T1740 Part 2: Privacy Policy Considerations & Corrections

**Read first:** `docs/plans/tasks/T1740-privacy-compliance-kickoff-prompt.md`

This document overrides specific sections of the main kickoff prompt based on product and legal decisions made during planning. Apply these changes when implementing T1740.

---

## Already Implemented (Do NOT Rebuild)

A previous session already implemented significant portions of T1740. These files exist and are functional — do not recreate them:

| File | What It Does | Status |
|------|-------------|--------|
| `src/backend/app/routers/privacy.py` | `POST /export-data` and `DELETE /delete-account` endpoints | Done, keep as-is |
| `src/frontend/src/components/PrivacyPolicy.jsx` | Privacy policy page component | Done, needs content update |
| `src/frontend/src/components/TermsOfService.jsx` | Terms of service page component | Done, needs content update |
| `src/frontend/src/components/AgeConfirmationModal.jsx` | Blocking "I am 18+" modal | **Must be replaced** (see Override 1) |
| `src/backend/app/routers/auth.py:147-176` | `GET /whoami` + `POST /accept-terms` endpoints | **Must be modified** (see Override 1) |
| `src/backend/app/routers/auth.py:374-380` | `/me` returns `needs_age_confirmation` flag | **Must be modified** (see Override 1) |
| `src/backend/app/services/auth_db.py:199` | Idempotent ALTER TABLE for 3 privacy columns | **Must be modified** (see Override 1) |
| `src/frontend/src/stores/authStore.js:21` | `needsAgeConfirmation` state field | **Must be modified** (see Override 1) |
| `src/frontend/src/utils/sessionInit.js:209-211` | Sets `needsAgeConfirmation` from `/me` response | **Must be modified** (see Override 1) |
| `src/frontend/src/App.jsx:22,552` | Imports and renders `AgeConfirmationModal` | **Must be modified** (see Override 1) |
| `scripts/migrate_t1740_privacy.py` | Migration script adding 3 columns to auth DB | **Must be modified** (see Override 1) |
| `docs/plans/tasks/T1740-design.md` | Design document | **Must be updated** to reflect overrides |

---

## Override 1: Replace Age Verification Gate with Passive Consent

**Problem:** The current implementation has a blocking full-screen modal (`AgeConfirmationModal.jsx`) that forces users to click "I Confirm, I am 18+" before using the app. This is unnecessary friction — our users are parents and coaches by definition. COPPA applies to children *in* the videos, not to account holders. Since children don't create accounts, age-gating doesn't apply.

**Goal:** Replace with a non-blocking passive consent line. Keep `terms_accepted_at` and `terms_version` columns (useful for compliance records). Remove `age_confirmed_at` (dead column).

### Changes Required

#### A. Migration Script

**File:** `scripts/migrate_t1740_privacy.py`

Remove `age_confirmed_at` from `NEW_COLUMNS`. Keep the other two:

```python
# BEFORE (line 25-29):
NEW_COLUMNS = [
    "terms_accepted_at TEXT",
    "terms_version TEXT",
    "age_confirmed_at TEXT",
]

# AFTER:
NEW_COLUMNS = [
    "terms_accepted_at TEXT",
    "terms_version TEXT",
]
```

Update the module docstring (lines 2-4) to remove the age_confirmed_at mention.

#### B. Auth DB Init

**File:** `src/backend/app/services/auth_db.py` (~line 198-202)

Remove `age_confirmed_at` from the idempotent ALTER TABLE loop:

```python
# BEFORE:
# T1740: privacy compliance — terms acceptance and age confirmation
for col in ("terms_accepted_at TEXT", "terms_version TEXT", "age_confirmed_at TEXT"):

# AFTER:
# T1740: privacy compliance — terms acceptance tracking
for col in ("terms_accepted_at TEXT", "terms_version TEXT"):
```

#### C. Accept-Terms Endpoint

**File:** `src/backend/app/routers/auth.py` (~line 161-176)

Remove `age_confirmed_at` from the UPDATE statement. Keep `terms_accepted_at` and `terms_version` — the passive consent line still records acceptance:

```python
# BEFORE (line 163-172):
@router.post("/accept-terms")
async def accept_terms(request: Request):
    """Store age confirmation and terms acceptance for the current user."""
    user_id = get_current_user_id()
    body = await request.json()
    version = body.get("terms_version", "2026-05-07")
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        db.execute(
            "UPDATE users SET terms_accepted_at = ?, terms_version = ?, age_confirmed_at = ? WHERE user_id = ?",
            (now, version, now, user_id),
        )

# AFTER:
@router.post("/accept-terms")
async def accept_terms(request: Request):
    """Record terms acceptance for the current user (passive consent)."""
    user_id = get_current_user_id()
    body = await request.json()
    version = body.get("terms_version", "2026-05-07")
    now = datetime.utcnow().isoformat()
    with get_auth_db() as db:
        db.execute(
            "UPDATE users SET terms_accepted_at = ?, terms_version = ? WHERE user_id = ?",
            (now, version, user_id),
        )
```

#### D. Whoami Endpoint

**File:** `src/backend/app/routers/auth.py` (~line 147-158)

Rename the response field from `needs_age_confirmation` to `needs_terms_acceptance`:

```python
# BEFORE:
@router.get("/whoami")
async def whoami():
    """Return the current user ID and terms acceptance status."""
    user_id = get_current_user_id()
    needs_confirmation = False
    with get_auth_db() as db:
        row = db.execute(
            "SELECT terms_accepted_at FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row and not row["terms_accepted_at"]:
            needs_confirmation = True
    return {"user_id": user_id, "needs_age_confirmation": needs_confirmation}

# AFTER:
@router.get("/whoami")
async def whoami():
    """Return the current user ID and terms acceptance status."""
    user_id = get_current_user_id()
    needs_terms = False
    with get_auth_db() as db:
        row = db.execute(
            "SELECT terms_accepted_at FROM users WHERE user_id = ?", (user_id,)
        ).fetchone()
        if row and not row["terms_accepted_at"]:
            needs_terms = True
    return {"user_id": user_id, "needs_terms_acceptance": needs_terms}
```

#### E. /me Endpoint

**File:** `src/backend/app/routers/auth.py` (~line 375-380)

Rename the field to match:

```python
# BEFORE:
needs_age_confirmation = False
# ...
needs_age_confirmation = not user_record.get("terms_accepted_at")

# AFTER:
needs_terms_acceptance = False
# ...
needs_terms_acceptance = not user_record.get("terms_accepted_at")
```

Also update the return dict further down in the same endpoint to use `needs_terms_acceptance` instead of `needs_age_confirmation`.

#### F. Frontend Auth Store

**File:** `src/frontend/src/stores/authStore.js` (~line 21)

Rename the state field:

```javascript
// BEFORE:
needsAgeConfirmation: false,  // T1740: Age/terms gate for new users

// AFTER:
needsTermsAcceptance: false,  // T1740: Passive terms acceptance for new users
```

#### G. Session Init

**File:** `src/frontend/src/utils/sessionInit.js` (~line 209-211)

Update to match the renamed backend field and store field:

```javascript
// BEFORE:
if (meData.needs_age_confirmation) {
    useAuthStore.setState({ needsAgeConfirmation: true });
}

// AFTER:
if (meData.needs_terms_acceptance) {
    useAuthStore.setState({ needsTermsAcceptance: true });
}
```

#### H. Replace AgeConfirmationModal with Passive Consent

**File:** `src/frontend/src/components/AgeConfirmationModal.jsx`

Replace the entire blocking modal with a non-blocking inline consent banner. Rename the file to `TermsConsentBanner.jsx`:

**Delete:** `src/frontend/src/components/AgeConfirmationModal.jsx`

**Create:** `src/frontend/src/components/TermsConsentBanner.jsx`

The banner should:
- Show as a small bar at the top or bottom of the app (NOT a full-screen blocking modal)
- Display: "By continuing, you agree to our [Privacy Policy](/privacy) and [Terms of Service](/terms)."
- Auto-dismiss after the user performs any action (navigates, clicks anything substantive)
- Call `POST /api/auth/accept-terms` in the background when dismissed
- Set `useAuthStore.setState({ needsTermsAcceptance: false })` after the API call

Alternatively, skip the banner entirely and just:
1. Show the consent text on the auth gate (below Google/OTP buttons in the login screen)
2. Fire `POST /api/auth/accept-terms` automatically on first successful login
3. This way there is zero additional UI friction — the act of logging in constitutes acceptance

**Recommendation:** The second approach (consent text on login screen, auto-accept on first login) is the least friction. The text "By continuing, you agree to our Privacy Policy and Terms of Service" should appear below the sign-in buttons in the auth gate modal. The `POST /accept-terms` call fires once after the first successful `/api/auth/init`.

#### I. App.jsx

**File:** `src/frontend/src/App.jsx` (~line 22, 552)

Update the import and render:

```jsx
// BEFORE (line 22):
import { AgeConfirmationModal } from './components/AgeConfirmationModal';

// AFTER (if using banner approach):
import { TermsConsentBanner } from './components/TermsConsentBanner';

// BEFORE (line 552):
<AgeConfirmationModal />

// AFTER:
<TermsConsentBanner />
```

Or if using the login-screen approach, remove both the import and the render entirely — the consent text lives inside the auth gate component instead.

#### J. Data Export Endpoint

**File:** `src/backend/app/routers/privacy.py` (~line 59)

Remove the `terms_accepted_at` reference from the export, or keep it (it's accurate data the user might want). Keeping it is fine — it shows when they accepted terms.

No changes required to `privacy.py` for this override.

---

## Override 2: Future-Proof Privacy Policy for Game Matching & Community Features

The privacy policy draft must include forward-looking language that covers features we plan to build later — specifically, detecting that two users uploaded videos of the same game and enabling shared/collaborative experiences around that match.

**Why:** Videos uploaded today (before any matching feature exists) should be usable for matching later without requiring retroactive consent. The privacy policy's "data use" categories must be broad enough to cover this from day one.

### Language for "How We Use Your Information" section

Include a category like:

> **Video content:** We use video you upload for processing, enhancement, and export as you direct. We may also analyze video metadata and content to identify games across multiple users' uploads, enabling shared viewing experiences and collaborative features in the future. This analysis may include comparing video characteristics (timing, location, visual similarity) to determine whether separate uploads depict the same game.

### Language for "Information We Collect" section

Under video data:

> **Video files and metadata:** Video files you upload, along with derived metadata such as duration, resolution, frame rate, file hashes, and game identification signals. Video files contain visual depictions of individuals, including minors participating in sporting events.

### Language for "Sharing Your Information" section

> **With other users (future feature):** We may introduce features that allow users who recorded the same game to share or access each other's uploads. If we do, we will provide you with controls to opt in or out of such sharing, and we will notify you before enabling any sharing of your content. We will never share your video with other users without your explicit consent at the time of sharing.

**Key legal mechanism:** The privacy policy describes *categories* of use. The ToS says features may be updated over time. As long as game matching falls within a disclosed category, we don't need retroactive consent for existing uploads. When the actual sharing feature launches, we will need:
- An opt-in toggle before sharing anyone's video (CCPA requires this for sharing data involving minors)
- A privacy policy update describing the specific feature
- User notification of the policy update (CalOPPA requirement)

But the *analysis* (detecting same-game matches) is pre-authorized by today's policy language.

---

## Override 3: Acceptable Content & Upload Rights in Terms of Service

The ToS draft must include an "Acceptable Content" section that addresses three concerns:

### A. Content they don't have rights to

> **Your Content Rights.** You represent and warrant that you have all necessary rights, licenses, and permissions to upload content to Reelballers, including the right to upload video depicting any individuals shown. If you upload video recorded by a third party (such as a club camera system, Veo, or Trace), you represent that you have permission to use and redistribute that content.

### B. Illegal content

> **Prohibited Content.** You may not upload content that is: (a) unlawful, harmful, threatening, abusive, or harassing; (b) depicts the exploitation or abuse of any person, especially minors; (c) infringes any third party's intellectual property rights; (d) contains malware or harmful code; or (e) violates any applicable law or regulation.

### C. Sports-only scope restriction

> **Intended Use.** Reelballers is designed for youth sports video editing. You agree to use the service only for uploading and editing sports-related video content. We reserve the right to remove content that falls outside this intended use.

**Why the scope restriction matters:** It narrows our liability surface. If someone uploads non-sports content (surveillance footage, copyrighted movies, etc.), we have clear ToS grounds to remove it without needing to make a judgment call.

### D. Video ownership & DMCA

The question of who "owns" a game video is murky:
- **Parent films with their phone** — parent owns the copyright
- **Club pays for Veo/Trace** — ownership depends on the platform's ToS and the club's agreement; typically the club/org is the "owner" but members get viewing/download access
- **Hired videographer** — videographer owns copyright unless work-for-hire

**Our position:** We don't adjudicate ownership. The ToS puts the burden on the user:

> **Content Ownership.** You retain ownership of content you upload to Reelballers. By uploading, you grant us a limited license to process, store, and display your content solely for the purpose of providing our services to you. This license terminates when you delete your content or your account.

> **DMCA Takedown.** If you believe content on Reelballers infringes your copyright, you may submit a takedown notice to [copyright@reelballers.com]. We will respond to valid notices in accordance with the Digital Millennium Copyright Act. Our designated agent for DMCA notices is: [Name and address TBD].

The Veo/Trace import feature makes this slightly relevant — we actively facilitate download-and-reupload. But since those platforms serve content without authentication (verified during T2600 discovery), they're effectively making it publicly accessible. Our ToS representation ("you have permission to use and redistribute") covers us.

---

## Override 4: PII We Actually Store (Corrected Inventory)

The privacy policy must accurately disclose all personal information we collect. Corrected and complete list:

| Category | Specific Data | Source | Storage Location |
|----------|--------------|--------|-----------------|
| **Account data** | Email address | User-provided (Google OAuth or OTP) | auth.sqlite `users` table |
| **Account data** | Google ID (`sub` claim) | Google OAuth | auth.sqlite `users` table |
| **Account data** | Profile picture URL | Google OAuth | auth.sqlite `users` table |
| **Session data** | Session token (`rb_session` cookie) | Generated at login | auth.sqlite `sessions` table |
| **Payment data** | Stripe customer ID | Stripe checkout | user.sqlite `stripe_customers` table |
| **Payment data** | Credit card details | Stripe (never touches our servers) | Stripe only |
| **Video content** | Video files containing identifiable minors | User upload or Veo/Trace import | Cloudflare R2 |
| **Video metadata** | Duration, resolution, FPS, file size, blake3 hash | Derived from upload | profile.sqlite `games` table |
| **Game metadata** | Opponent name, game date, tournament, game type | User-provided | profile.sqlite `games` table |
| **Usage data** | Page views (anonymous, no PII) | Cloudflare Web Analytics | Cloudflare (not our servers) |
| **Device data** | User agent string | HTTP headers | Logged in `impersonation_audit` only |
| **Editing data** | Clip selections, crop keyframes, overlay settings, export jobs | User actions in editor | profile.sqlite, R2 |

**What we do NOT collect:**
- No biometric data extraction (framing is manual crop, no face detection/recognition)
- No location data (beyond what's in video metadata, which we don't extract)
- No advertising identifiers
- No cross-site tracking
- No contact lists or social graphs
- No children's data directly (children don't create accounts; they appear in videos uploaded by parents/coaches)

---

## Updated Implementation Checklist

### What already exists vs. what needs work

| Component | Current State | Action |
|-----------|--------------|--------|
| `privacy.py` (export + delete) | Done | No changes |
| `PrivacyPolicy.jsx` | Exists | Update content with Part 2 language |
| `TermsOfService.jsx` | Exists | Update content with Part 2 language |
| `/privacy` + `/terms` routing | Exists in App.jsx | No changes |
| Landing page footer | Needs legal links | Add Privacy, Terms, Do Not Sell links |
| Main app footer | Needs legal links | Add Privacy, Terms, Do Not Sell links |
| `AgeConfirmationModal.jsx` | Blocking 18+ modal | **Replace** with passive consent |
| `migrate_t1740_privacy.py` | Adds 3 columns | **Remove** `age_confirmed_at` |
| `auth_db.py` init | Adds 3 columns | **Remove** `age_confirmed_at` |
| `auth.py` accept-terms | Writes 3 columns | **Remove** `age_confirmed_at` write |
| `auth.py` whoami + /me | `needs_age_confirmation` | **Rename** to `needs_terms_acceptance` |
| `authStore.js` | `needsAgeConfirmation` | **Rename** to `needsTermsAcceptance` |
| `sessionInit.js` | Reads `needs_age_confirmation` | **Update** to `needs_terms_acceptance` |
| `AccountSettings.jsx` | No privacy section | **Add** privacy rights UI |
| `email.py` | No CAN-SPAM compliance | **Add** physical address + privacy link |
| Legal doc drafts | Not started | **Create** all 3 |

### Final Ordered Checklist

**Phase 1: Legal Drafts (new)**
1. [ ] Draft `docs/legal/privacy-policy.md` with:
   - Corrected PII inventory (table above)
   - Future-proof "How We Use Your Information" covering game matching
   - Forward-looking "Sharing Your Information" for future community features
   - COPPA section: children are data subjects in videos, not account holders; no biometric extraction
   - Cloudflare Web Analytics disclosure (cookieless, no PII)
   - Session cookie disclosure (functional, auth only)
   - All third-party service providers listed with what data they receive
   - "DRAFT -- For Attorney Review" header
2. [ ] Draft `docs/legal/terms-of-service.md` with:
   - Acceptable Content section (rights representation, prohibited content, sports-only scope)
   - Content ownership + limited license grant
   - DMCA takedown procedure
   - User represents they have authority to upload content depicting individuals shown
   - "DRAFT -- For Attorney Review" header
3. [ ] Draft `docs/legal/data-retention-policy.md`

**Phase 2: Age Gate -> Passive Consent (modify existing)**
4. [ ] Remove `age_confirmed_at` from `scripts/migrate_t1740_privacy.py` (keep other 2 columns)
5. [ ] Remove `age_confirmed_at` from `src/backend/app/services/auth_db.py` ALTER TABLE loop (~line 199)
6. [ ] Remove `age_confirmed_at` write from `POST /accept-terms` in `auth.py` (~line 170)
7. [ ] Rename `needs_age_confirmation` -> `needs_terms_acceptance` in `GET /whoami` (`auth.py` ~line 158)
8. [ ] Rename `needs_age_confirmation` -> `needs_terms_acceptance` in `/me` endpoint (`auth.py` ~line 375-380)
9. [ ] Rename `needsAgeConfirmation` -> `needsTermsAcceptance` in `authStore.js` (~line 21)
10. [ ] Update `sessionInit.js` to read `needs_terms_acceptance` and set `needsTermsAcceptance` (~line 209-211)
11. [ ] Delete `AgeConfirmationModal.jsx`, create `TermsConsentBanner.jsx` (or move consent text into auth gate)
12. [ ] Update `App.jsx` import + render (~line 22, 552) to use new component

**Phase 3: Content Updates (modify existing)**
13. [ ] Update `PrivacyPolicy.jsx` content with Part 2 language (game matching, PII inventory, etc.)
14. [ ] Update `TermsOfService.jsx` content with Part 2 language (acceptable content, DMCA, ownership)

**Phase 4: Remaining Frontend (new)**
15. [ ] Expand landing page footer (`src/landing/src/App.tsx` ~line 189-192) with Privacy, Terms, Do Not Sell links
16. [ ] Add footer to main app (`App.jsx`) with Privacy, Terms, Do Not Sell links
17. [ ] Add privacy rights section to `AccountSettings.jsx` (Download Data, Delete Account, Do Not Sell)

**Phase 5: Email Compliance (modify existing)**
18. [ ] Add physical address placeholder + privacy link footer to all email templates in `email.py`

**Phase 6: Verification**
19. [ ] Confirm no cookie consent banner needed
20. [ ] Confirm `/shared/:token` routes still work after any routing changes
21. [ ] Confirm GPC effectively honored
22. [ ] Run migration script against local auth DB to verify column changes

---

## Questions for Attorney Review

When the drafts go to the privacy attorney, these specific questions need answers:

1. Is the passive consent line ("By continuing, you agree to...") sufficient, or do we need an explicit checkbox?
2. Does storing user-uploaded video containing faces (without biometric extraction) trigger CPRA "sensitive personal information" requirements?
3. Is the future-proof game matching language broad enough, or does it overpromise and create obligations we don't want yet?
4. Does facilitating Veo/Trace download-and-reupload create any secondary liability for us beyond what the DMCA safe harbor covers?
5. We are currently below CCPA thresholds (50K+ consumers, $25M+ revenue, 50%+ revenue from selling PI). We're implementing consumer rights (data export, deletion) as best practice anyway — are there any threshold-dependent obligations we should be aware of as we grow?
6. Do we need a California-specific "Notice at Collection" separate from the privacy policy?

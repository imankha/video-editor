# Share Email Redesign Epic — Kickoff Prompt

> Paste this entire prompt into a fresh AI session to implement the Share Email Redesign epic (T3200 → T3210 → T3220).

---

## Implement Epic: Share Email Redesign (T3200, T3210, T3220)

Read `CLAUDE.md` for project context, coding standards, and workflow rules before starting. This is a **backend-only** epic that touches email templates, Postgres user lookups, and route handlers. No frontend changes.

### Epic Context

Read: `docs/plans/tasks/share-email-redesign/EPIC.md` for the full design system (color tokens, typography, layout, dark mode strategy).

**Problem:** Share notification emails look like spam. A soccer dad receiving "imankh@gmail.com shared clips of test with you" from an unknown service will delete it. The emails use dark backgrounds with broken contrast (purple CTA at 2.58:1 — fails all WCAG levels), show raw email addresses instead of names, and make no distinction between someone who's never heard of Reel Ballers and an existing user.

**Goal:** Emails a skeptical soccer dad would actually click. Light background with AAA contrast, sender's name (not email), and two variants: first-touch (trust signals, product explainer) vs returning user (streamlined notification).

### Classification

```
**Stack Layers:** [Backend]
**Files Affected:** ~5 files
**LOC Estimate:** ~300 lines
**Test Scope:** [Backend]

| Agent       | Include? | Justification |
|-------------|----------|---------------|
| Code Expert | Yes      | Trace all 4 email send paths through route handlers to understand data available at each call site |
| Architect   | No       | Design already specified in EPIC.md with exact color tokens, layout, and copy — no design decisions needed |
| Tester      | Yes      | Template output verification, sender name resolution edge cases, first-touch detection |
| Reviewer    | Yes      | Email rendering is hard to test — reviewer should verify HTML structure and escape safety |
| Migration   | No       | No schema changes |
```

---

### Current State (What You'll Find)

#### Email Service: `src/backend/app/services/email.py`

**Provider:** Resend API via httpx. From address: `Reel Ballers <noreply@reelballers.com>`.

**4 share email functions** (all copy-pasted HTML, all have the same problems):

| Function | Lines | Called From | Data Available |
|----------|-------|-------------|----------------|
| `send_share_email()` | 359-420 | `shares.py` ~line 199 | recipient_email, sharer_email, share_token, video_name |
| `send_teammate_share_email()` | 423-496 | `clips.py` ~line 2191 | recipient_email, sharer_email, tag_name, game_name, clip_count, share_token |
| `send_game_share_email()` | 499-566 | `games.py` ~line 1605 | recipient_email, sharer_email, game_name, share_token |
| `send_playback_share_email()` | 569-636 | `games.py` ~line 1777 | recipient_email, sharer_email, game_name, share_token |

**Current template pattern (all 4 are nearly identical):**
```python
html_body = f"""
<div style="... max-width: 500px; ... background: #1f2937; border-radius: 12px;">
  <p style="color: #e5e7eb; ...">{sharer_email} tagged <strong>{tag_name}</strong> in {clip_text} from:</p>
  <p style="color: #ffffff; font-size: 20px; ...">{game_name}</p>
  <a href="{share_url}" style="... background: #7c3aed; ...">View Clips</a>
  <hr style="... border-top: 1px solid #374151; ..." />
  <p style="color: #9ca3af; ...">Sent via <a href="..." style="color: #7c3aed;">Reel Ballers</a></p>
  <p style="color: #6b7280; font-size: 11px; ...">You received this because {sharer_email} shared...</p>
  {_CAN_SPAM_FOOTER}
</div>
"""
```

**Subject lines use raw email:**
```python
f"{sharer_email} shared clips of {tag_name} with you"
```

**Shared footer constant** (lines 21-28):
```python
_CAN_SPAM_FOOTER = """
<p style="color: #6b7280; font-size: 11px; ...">
  Reel Ballers<br/>
  <a href=".../privacy">Privacy Policy</a> | <a href=".../terms">Terms of Service</a>
</p>
"""
```

**Share URL construction** (lines 350-356):
```python
def _get_share_url(share_token: str, share_type: str = "video") -> str:
    domain = DOMAIN_MAP.get(APP_ENV, "localhost:5173")
    scheme = "http" if "localhost" in domain else "https"
    if share_type == "game":
        return f"{scheme}://{domain}/shared/teammate/{share_token}"
    return f"{scheme}://{domain}/shared/{share_token}"
```

#### Caller Pattern (all 4 endpoints follow this)

```python
# shares.py ~line 170
sharer = get_user_by_id(user_id)
sharer_email = sharer["email"] if sharer else user_id
# ... later ...
await send_share_email(recipient_email, sharer_email, share_token, video_name)
```

#### User Data Available

- **Postgres `users` table:** `user_id`, `email`, `created_at`, `google_name` (from Google OAuth — may be NULL for OTP users)
- **Profile SQLite `athlete_profiles` table:** `athlete_name`, `team_name`, `sport` (from T1610)
- `get_user_by_id(user_id)` in `auth_db.py` returns the Postgres user row

---

### Target State

#### Task 1: T3200 — Email Design System

Create `_build_share_email()` in `email.py` that produces the full HTML for any share email:

```python
def _build_share_email(
    heading: str,           # "Sarah shared a clip with you"
    game_name: str,         # "Vs LA Breakers May 9"  
    cta_url: str,           # share URL
    cta_text: str,          # "Watch Clips", "View Game", etc.
    footer_reason: str,     # "Sarah shared game clips with you"
    is_first_touch: bool,   # controls trust line visibility
    preheader: str = "",    # hidden inbox preview text
    secondary_cta_url: str | None = None,  # "Open in your gallery" link (returning users)
) -> str:
```

**Design tokens (all from EPIC.md — follow exactly):**

| Element | Value |
|---------|-------|
| Page background | #f9fafb |
| Content background | #ffffff |
| Heading | #111827, 24px, bold |
| Body text | #1f2937, 16px |
| Secondary text | #4b5563, 14px |
| CTA button | #6d28d9 bg, #ffffff text, 6px radius, 50px height, min 200px width |
| Footer text | #4b5563 (reason), #6b7280 (legal) |
| Accent bar | #7c3aed, 4px tall, full width at top |
| Divider | #e5e7eb, 1px |
| Max width | 600px |
| Font stack | `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif` |

**Template structure:**
```
[4px purple accent bar]
[Hidden preheader div]
[32px padded content area]
  [Heading — who did what]
  [Game name — bold, large]
  [CTA button — centered]
  [If first-touch: "No account needed to watch." + "Reel Ballers helps soccer parents create and share game highlights."]
  [If returning: "Open in your gallery" text link]
[1px divider]
[Footer: "Sent via Reel Ballers" + reason line + Privacy Policy | Terms of Service]
```

**Dark mode:** Include `<meta name="color-scheme" content="light dark">` in head. No @media overrides needed — light backgrounds invert cleanly.

**Preheader pattern:**
```html
<div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;">
  {preheader}
</div>
```

Replace `_CAN_SPAM_FOOTER` constant — the footer is now built into the template with proper styling.

#### Task 2: T3210 — Sender Name + Recipient Detection

**Sender name resolution** — add helper in `email.py`:

```python
async def _resolve_sender_name(user_id: str, sharer_email: str) -> str:
```

Resolution order:
1. Check Postgres `users` table for `google_name` (set during Google OAuth)
2. If NULL, try loading user's profile SQLite and reading `athlete_name` from `athlete_profiles`
3. Fallback: extract email local part, replace dots/underscores with spaces, title-case
   - `sarah.jones@gmail.com` → `Sarah Jones`
   - `imankh@gmail.com` → `Imankh`

**Recipient account detection** — add helper in `email.py`:

```python
def _is_existing_user(email: str) -> bool:
```

Simple Postgres lookup: `SELECT 1 FROM users WHERE email = %s`. Returns True if account exists.

**Update all 4 email function signatures** to accept `sender_name: str = ""` and `is_first_touch: bool = True`.

**Update all 4 callers** (shares.py, clips.py, games.py) to resolve name and detect recipient before sending:

```python
sender_name = await _resolve_sender_name(user_id, sharer_email)
is_first_touch = not _is_existing_user(recipient_email)
await send_share_email(..., sender_name=sender_name, is_first_touch=is_first_touch)
```

**From header update:**
```python
from_address = f"{sender_name} via Reel Ballers <noreply@reelballers.com>" if sender_name else FROM_ADDRESS
```

#### Task 3: T3220 — Rewrite Share Email Templates

Each function becomes a thin wrapper around `_build_share_email()`. The email-specific logic is just choosing the right subject line, heading, CTA text, and preheader.

**Subject lines (first-touch / returning):**

| Email Type | First-Touch Subject | Returning Subject |
|------------|--------------------|--------------------|
| Teammate clips | `{Name} tagged {Player} in a highlight from {Game}` | `New clip: {Player} tagged in {Game}` |
| Video share | `{Name} shared a highlight reel with you` | `New shared reel: {VideoName}` |
| Game share | `{Name} shared game footage with you` | `{Name} shared {Game} with you` |
| Playback share | `{Name} shared game annotations with you` | `{Name} shared annotations from {Game}` |

**CTA text per email type:**
- Teammate clips: "Watch Clips"
- Video share: "Watch Reel"
- Game share: "View Game"
- Playback share: "Watch Annotations"

**Example rewritten function:**
```python
async def send_teammate_share_email(
    recipient_email, sharer_email, tag_name, game_name,
    clip_count, share_token=None, sender_name="", is_first_touch=True,
) -> bool:
    api_key = os.getenv("RESEND_API_KEY")
    share_url = _get_share_url(share_token, "game") if share_token else None

    if not api_key:
        logger.warning(f"[Email] DEV MODE -- teammate share to {recipient_email}")
        return True

    clip_text = f"{clip_count} clip{'s' if clip_count != 1 else ''}"
    display_name = sender_name or sharer_email

    if is_first_touch:
        subject = f"{display_name} tagged {tag_name} in a highlight from {game_name}"
        heading = f"{display_name} clipped highlights from"
        preheader = f"Watch {tag_name}'s highlight -- {display_name} thought you'd want to see this."
    else:
        subject = f"New clip: {tag_name} tagged in {game_name}"
        heading = f"{display_name} tagged {tag_name} in {clip_text} from"
        preheader = f"{clip_text} from {game_name}"

    html_body = _build_share_email(
        heading=heading,
        game_name=game_name or "Untitled Game",
        cta_url=share_url,
        cta_text="Watch Clips",
        footer_reason=f"{display_name} shared game clips with you",
        is_first_touch=is_first_touch,
        preheader=preheader,
    )

    from_address = f"{display_name} via Reel Ballers <noreply@reelballers.com>"
    # ... send via Resend (same pattern as current) ...
```

---

### Key Files

**Read first (Code Expert):**
- `src/backend/app/services/email.py` — all 4 share email functions + `_CAN_SPAM_FOOTER` + `_get_share_url()`
- `src/backend/app/routes/shares.py` — `send_share_email()` caller (~line 145-219)
- `src/backend/app/routes/clips.py` — `send_teammate_share_email()` caller (~line 2093-2240)
- `src/backend/app/routes/games.py` — `send_game_share_email()` and `send_playback_share_email()` callers
- `src/backend/app/services/auth_db.py` — `get_user_by_id()` for sender data
- `src/backend/app/database.py` — `athlete_profiles` table schema (for athlete_name)
- `docs/plans/tasks/share-email-redesign/EPIC.md` — design system with exact tokens

**Modify:**
- `src/backend/app/services/email.py` — add `_build_share_email()`, `_resolve_sender_name()`, `_is_existing_user()`, rewrite all 4 share functions
- `src/backend/app/routes/shares.py` — resolve sender name + detect first-touch before email call
- `src/backend/app/routes/clips.py` — same
- `src/backend/app/routes/games.py` — same (two call sites: game share + playback share)

---

### Technical Constraints

1. **HTML email rendering is fragile.** All styles must be inline (no `<style>` blocks — Gmail strips them). Use `style="..."` on every element. No CSS classes.

2. **`_html_escape()` on all user-provided strings.** The existing function (line 639) handles `& < > "`. Use it on sender_name, game_name, tag_name, video_name — everything that comes from user input.

3. **Resend From header format.** Resend accepts `"Display Name <email>"` format for the `from` field. The sender_name must not contain characters that break email headers (angle brackets, quotes). Strip or replace them.

4. **athlete_name may require loading user's SQLite.** The profile SQLite is per-user and may need to be loaded from R2 if not cached. This is async and could add latency. The sender_name resolution should be best-effort — if it fails, fall back to the email local part. Don't let name resolution block email delivery.

5. **`google_name` column.** Check the Postgres `users` table schema to confirm this column exists and what it contains. It may be the full name from Google OAuth (e.g., "Sarah Jones"). If it exists and is populated, it's the best source for sender_name — no SQLite load needed.

6. **Thread safety.** The email functions are called from async route handlers. `_is_existing_user()` uses `get_pg()` which returns a sync connection — this is fine for a single SELECT query but keep it short.

7. **OTP and bug report emails are out of scope.** Only the 4 share email functions change. `send_otp_email()` and `send_problem_report_email()` / `send_bug_notification_email()` keep their current styling (they're admin-facing, different audience).

---

### Acceptance Criteria

- [ ] All 4 share emails use light background (#ffffff content, #f9fafb page)
- [ ] CTA button uses #6d28d9 (not #7c3aed) — AAA contrast on white
- [ ] Subject lines show sender's name, not raw email address
- [ ] From header reads "{Name} via Reel Ballers" not "Reel Ballers"
- [ ] First-touch recipients see "No account needed to watch" trust line
- [ ] First-touch recipients see "Reel Ballers helps soccer parents create and share game highlights" explainer
- [ ] Returning users see streamlined notification without trust copy
- [ ] Returning users see "Open in your gallery" secondary link
- [ ] Preheader text appears in Gmail inbox preview
- [ ] All user-provided strings are HTML-escaped
- [ ] Footer includes Privacy Policy + Terms of Service links
- [ ] `_build_share_email()` is the single template source — no copy-pasted HTML in individual functions
- [ ] Sender name resolution has graceful fallback (email local part) if profile data unavailable
- [ ] `python -c "from app.main import app"` passes after changes

---

### Workflow Reminders

- Follow the full workflow: Classify → Code Expert → Tester Phase 1 → Implement → Reviewer → Tester Phase 2 → Manual Testing → Complete
- Create branch: `git checkout -b feature/share-email-redesign`
- All 3 tasks go in one branch (they're tightly coupled in the same file)
- AI sets status to TESTING after implementation — never DONE
- Commit with co-author line
- Update PLAN.md status after commit
- After implementation, send a test share email to verify rendering in Gmail

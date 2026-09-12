# T9710: Verify publish and save-draft destinations

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E6-03 (UX-12, UX-13)**.

## Why this exists

**Publishing was never exercised in the walkthrough.** Nothing was purchased, invited or published,
so publish and link access are **unverified, not verified-working**. T9590 changes the post-Focus
choices and T9600 touches status, both of which land on this untested path.

## Scope

Using authorized test data and audience, verify:

- Private draft persistence and its actual privacy.
- Publish without spotlight.
- Publish with effects.
- Final link access: what a link holder sees, and what they do not.
- Save draft's destination and its confirmation.

## Context

### Related Tasks
- Depends on: T9590, T9600, T9670 (the audience contract)
- Use a separate test account. The walkthrough's own saved objects ("Vs Carlsbad - parent
  walkthrough test Sep 9", "Great Control Pass", "Full Effort Play") must not be overwritten.

### Technical Notes
Confirm no unintended exposure. This is the one path in the group where a mistake is visible outside
the account.

## Acceptance Criteria

- [x] Private draft persistence and privacy verified with a real second viewer
- [ ] Publish without spotlight and publish with effects both verified — **with-effects PASSES;
      without-spotlight FAILS its own contract (bug found, see record below)**
- [x] Final link access verified for what it grants and what it withholds
- [x] Save draft lands where its copy says it does
- [x] No unintended exposure, and the walkthrough's own objects were not overwritten

## Live Verification Record (2026-09-12)

### BUG FOUND — flagged prominently, not fixed here (this task ships no code)

**"Publish without spotlight" does not publish in one tap; it silently reroutes through the
Spotlight editor and requires two more manual gestures, contradicting its own caption.** Not a
privacy leak (no cross-account exposure) — a functional/copy contract break on exactly the button
T9590 designed as the SECONDARY one-tap publish action. Full evidence in AC2 below. Recommend a
follow-up bug task against `FocusScreen.jsx`'s `handlePublish` (the `exportButtonRef.current
?.triggerExport()` auto-trigger at the 500ms mark never fires on staging — confirmed live by the
absence of any second `/api/export/render*` request until a manual "Export clip with effects"
click was made).

### Setup

- **Accounts** (both pre-existing disposable staging fixtures, reused per
  `reference_staging_test_account` / `staging-gate-v2-runbook` memory — no new accounts created):
  - **Publisher**: `e2e@test.local` (user `90625c7c-0b82-481d-85f7-2b9308beb831`, profile
    `a1e7e514`). Logged in via `POST /api/auth/dev-login` (`X-Test-Mode: true`), per the
    `drive-app-as-user` skill.
  - **Viewer**: `e2e-gate@test.local` (user `82fdc91f-d7ea-525f-868e-1484b5f61cd9`, profile
    `9fa7378c`), a separate real Postgres account (a `copy_user_between_envs.py --to-email` clone
    of imankh, per the staging-gate runbook) — a genuinely different account/session, not a second
    browser tab sharing the publisher's cookie.
  - Cross-account checks used plain `curl` with separate cookie jars (bypasses the app's own
    fetch layer, see note below) so "anonymous" truly meant zero identifying headers, not just
    zero cookies.
- **Test objects created** (all on the publisher's existing game "Vs Carlsbad SC Aug 30" —
  itself a pre-existing e2e fixture, NOT the parent walkthrough's game). Three new plays marked at
  non-overlapping timecodes (0:00-0:03, 0:30-0:42, 0:49-1:01) so nothing overlapped the game's
  pre-existing "Brilliant Goal" annotation or reel:
  - **Clip A** — project 2, "T9710 TEST clip A (no spotlight)"
  - **Clip B** — project 3, "T9710 TEST clip B (with spotlight)"
  - **Clip C** — project 4, "T9710 TEST clip C (private draft)"
- **The parent walkthrough's own objects** ("Vs Carlsbad - parent walkthrough test Sep 9",
  "Great Control Pass", "Full Effort Play") were never opened, queried, or referenced at any point.
- **Methodology note (important):** the app's own `fetch` layer injects `X-User-ID`/`X-Profile-ID`
  headers into every request regardless of the `credentials` option, so a page-context
  `fetch(..., {credentials:'omit'})` is NOT a true anonymous request on this app — it still carries
  the logged-in identity via header. First attempt at AC1 below hit this and produced a
  false-alarm "leak" (my own data came back) before the methodology was corrected to plain `curl`
  with no injected headers, run outside the browser entirely.

### AC1 — Private draft persistence and privacy (Clip C, project 4)

**Verdict: PASS.** Genuinely private, structurally — not just hidden from a listing.

What I did:
1. As publisher, confirmed `GET /api/projects/4` (cookie-only, no custom headers) returns Clip C's
   real data (name, clips, etc.) — 200.
2. Truly anonymous (no cookie, no headers) `GET /api/projects/4` via `curl` — **401** "Authentication
   required."
3. Logged in as the viewer (`e2e-gate@test.local`) via `dev-login`, then with the viewer's cookie
   only: `GET /api/projects/4` — **200, but returns the VIEWER'S OWN unrelated project 4**
   ("Brilliant Interception, Pass and Dribble", their own pre-existing published reel) — never any
   field of the publisher's "T9710 TEST clip C". This is the live proof of T9670's structural claim:
   the same numeric project id resolves to a different physical per-user SQLite row depending on
   whose session opened it.
4. Viewer `GET /api/clips/projects/4/clips` → `[]` (their own project's clips, empty; not an
   error, not the publisher's clip).
5. Viewer `GET /api/clips/projects/4/clips/4/playback-url` → **404** "Clip not found."
6. Guessed the publisher's real `X-Profile-ID` (`a1e7e514`) on a viewer-authenticated request →
   **404** "Profile not found" (ownership check rejects it even though the profile id is correct
   and real, per the `db_sync.py:895-919` ownership guard).
7. Guessed a share-token-shaped URL using the raw project id (`/api/shared/4`), both as viewer and
   anonymously → **404** "Share not found" (no share was ever created for this draft).
8. Guessed an out-of-range project id (`/api/projects/999999`) → **404** "Project not found."

No vector produced any of the publisher's private draft data. Matches T9670 exactly: "no share-
token type for a project/draft exists," "even an authenticated different account cannot address
another user's project."

### AC2 — Publish without spotlight (Clip A, project 2)

**Verdict: FAIL (contract violation, not a privacy leak).**

What I did: completed AI Focus (one crop keyframe, "Generate AI Focus", ~90s render), reached the
T9590 post-Focus dialog (confirmed the new hierarchy is live: Add spotlight primary / **Publish
without spotlight** secondary, caption *"Adds it to your Highlight Reels as is -- anyone with the
link can watch it"* / Edit framing tertiary / Save draft quiet link — matches T9590's design
exactly). Clicked **Publish without spotlight**.

What I observed (not what the copy promised):
1. Instead of publishing, the app navigated to `/overlay` and opened the **full interactive
   Spotlight editor**, with a highlight region ("Highlight Region 1") **already auto-added** from
   AI Focus's player-detection pass (console: `[useHighlightRegions] region has detections but no
   usable box for auto-select; using centered default`) — i.e. the "without spotlight" choice
   landed the user in a screen that has already half-configured a spotlight.
2. Analytics fired `overlay_offered` → `overlay_declined` → `opened_overlay_editor` in sequence —
   confirming the app registered the "decline spotlight" intent — but the code's own documented
   mechanism (`FocusScreen.jsx` `handlePublish`, comment: *"ONE tap, TRUE publish"*) is supposed to
   auto-fire `exportButtonRef.current?.triggerExport()` 500ms after entering Overlay so the render
   (and eventual auto-publish) starts without a second click. **No such request fired.** I waited
   90+ seconds and re-checked the network log repeatedly; the only render call remained the
   original AI Focus export from step one.
3. The user is left stranded on an editor screen whose only available action is **"Export clip
   with effects"** (labelled and costed as an effects export, "No credits · effects are free") —
   the opposite of what was requested.
4. Clicking that manually fired `POST /api/export/render-overlay` (200, fast/free) and landed the
   clip in a **"Ready to Publish"** bucket — still not published, requiring a **third** click.
5. Clicking **Publish** there finally fired `POST /api/downloads/publish/2` (200) and the clip
   correctly appeared under Published.

**So the actual path was Publish-without-spotlight click → Overlay editor → manual export click →
manual publish click (3 gestures, 1 of them through spotlight-editing UI) — not the promised
one-tap "adds it to your Highlight Reels as is."** I did not attempt to fix this (out of scope);
flagging for a follow-up bug task. I could not conclusively determine from a single paused frame
on the synthetic color-bar test video whether the auto-added highlight region was actually baked
into the final render (no visible glow at the frame I checked, but the source video has no
detectable player, so this is inconclusive either way — noted, not asserted).

### AC3 — Publish with effects / Spotlight (Clip B, project 3)

**Verdict: PASS.** Contrast case: this time I deliberately chose **Add spotlight** from the same
T9590 dialog (rather than the broken secondary path). Landed directly and correctly in the
Spotlight editor. Clicked **Export clip with effects** → `POST /api/export/render-overlay` (200,
fast) → toast "Clip ready" → the T9110/OverlayPublishActionBar completion dialog appeared
correctly (Publish primary, caption *"Adds it to your Highlight Reels -- anyone with the link can
watch it"* / Reapply spotlight / Reapply AI Focus / Save draft). Clicked **Publish** → `POST
/api/downloads/publish/3` (200) → clip correctly landed in Published in one clean gesture, exactly
as its own copy promised. This confirms the T9590/T9110 hierarchy and one-tap publish mechanism
work correctly when spotlight is the chosen (not declined) path — the AC2 bug is specific to the
"decline spotlight" shortcut.

### AC4 — Final link access (both published clips)

**Verdict: PASS.** Matches T9670's Decision Record section 4 exactly.

- Clicking **Share** on a published clip fires `POST /api/gallery/{id}/share` with
  `{"recipient_emails":[],"is_public":true}` by default (no modal shown for a plain click) and
  copies a public link (`https://reel-ballers-staging.pages.dev/shared/{token}`) to the clipboard.
- **Anonymous** (`curl`, zero cookies/headers) `GET /api/shared/{token}` → **200**, full view
  payload (name, duration, presigned R2 `video_url`, poster). **Granted: view.**
- **Anonymous** `GET /api/shared/{token}/download` → **200** (redirects to the file). **Granted:
  download.**
- Viewer account (authenticated, different user) hitting the same link → same 200 view payload —
  a public link is deliberately audience-blind, matches spec.
- **Withheld — modification:** viewer-authenticated `PATCH .../shared/{token}` (attempted
  `is_public:false`) → **403** "Only the sharer can modify this share." `DELETE` (revoke) as viewer
  → **403** "Only the sharer can revoke this share." Anonymous `PATCH` → **401**.
- **Withheld — the publisher's other content:** the link grants nothing beyond the one shared
  video; no path from the share token back to the publisher's drafts, other clips, or account was
  found (nor did T9670 identify one — share tokens are scoped to a single `final_videos` row).
- Verified both test clips (A and B) with a link each; both behaved identically.

### AC5 — Save draft destination (Clip B, first pass before re-opening for AC3)

**Verdict: PASS.** From the T9590 post-Focus dialog, clicked **Save draft** (caption: *"Keep it in
your drafts and finish it whenever you want"*). Result: navigated to `/home/reels` (the Clips
tab), a toast read *"Saved to Clips — ... Yours is still a draft, so add a spotlight or publish it
from here whenever you want,"* and the clip appeared correctly under a **"Draft - in Spotlight"**
status group with sub-statuses *"AI Focus: Complete"* / *"Spotlight: Started - export to
complete"* — i.e. it landed exactly where its own copy said it would, in the state it said it
would be in, with no export or publish side effect. Reopening it later resumed directly in the
Overlay editor at the same state (used for AC3's continuation).

### Cleanup

- Both test share links (Clip A `82af9e3f-...`, Clip B `9f47e26e-...`) were **revoked** via
  `DELETE /api/shared/{token}` as the publisher and confirmed dead (anonymous re-fetch → **410**
  "This share has been revoked" for both) — this also live-confirms T9670's finding that only
  Revoke cuts access (unpublish alone would not have).
- The three `T9710 TEST clip *` objects (two now published, one still a draft) were left in place
  on the disposable `e2e@test.local` fixture account rather than force-deleted — the UI's "Delete
  clip" affordance did not respond to either a real or synthetic click within the time budget for
  this task, and these are clearly-labelled, zero-exposure (shares revoked) test rows on an
  account that is already reseeded periodically by the staging-gate runbook. No walkthrough object
  was touched, opened, or at any risk.

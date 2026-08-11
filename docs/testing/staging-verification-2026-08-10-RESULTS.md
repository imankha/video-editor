# Verification Results — 2026-08-10 code freeze

Driven live via Playwright against **local dev** (`localhost:5173`/`:8000`), authenticated as the
real account `imankh@gmail.com` (profile `9fa7378c`, "Test Soccer Mehdi profile") via `dev-login`.
Staging itself was not reachable for this pass (`dev-login` is dev-only per
`.claude/skills/drive-app-as-user/SKILL.md`); results below are code-correctness findings, not a
staging-environment sign-off. Companion docs:
[release-map-2026-08-10.md](release-map-2026-08-10.md) ·
[staging-verification-2026-08-10.md](staging-verification-2026-08-10.md) (the checklist this run worked through).

**Setup note:** the local profile DB was found stuck at schema `v34` (never migrated past T5195's
original table). Ran `POST /api/admin/migrate` to bring it to head (`v42`) partway through this
pass — see "False positive" below. Any fresh local dev environment used for follow-up testing
should run this first.

## Bug found — CONFIRMED

### Owner in-app playback: clicking the Intro segment on the composite scrubber does not seek back into the intro (T6710)

**Severity:** Real regression in shipped, STAGING-tagged code. User-facing: anyone who plays their
own reel with an intro attached, watches it advance into the reel, then tries to go back and rewatch
the intro card, cannot — clicking the "Intro" region of the scrubber silently does nothing.

**Steps:**
1. Play an owned reel with an Athlete Intro Card attached (My Reels → a reel tagged "An intro plays
   before this reel" → Play video).
2. Let it play forward through the intro into the reel (auto-continue works correctly here — confirmed).
3. Click the "Intro" segment on the scrubber at the top of the player.

**Expected:** playback seeks back into the intro card's own animation at the clicked position (per
the task's design and the checklist item "Seeking backward from the reel into the intro — lands at
the correct point in the intro's own animation, not a restart from zero").

**Observed:** nothing happens. The video stays on the reel; the DOM never re-mounts the intro
content. Reproduced 3 times, including via a synthetic `click()` fired directly on the button in
`browser_evaluate` immediately after the button click (eliminates any animation-already-finished
timing explanation) — confirmed synchronously that `document.body.textContent` never contains the
intro card's text and a `<video>` element is still present immediately after the click.

**Evidence:** the "Intro" scrubber button (`aria-label="Intro"`) is enabled and has a real `onclick`
handler attached (not a hit-testing/z-index problem — that class of bug was already fixed earlier in
T6710). The click event fires; the resulting seek/region-switch logic just doesn't do anything
observable.

**Likely code location** (see [release-map-2026-08-10.md § 8](release-map-2026-08-10.md) for full
context): `src/frontend/src/components/introcards/IntroStoryPlayer.jsx` (owns `region` state,
`'intro' | 'reels'`) and/or `src/frontend/src/components/introcards/CompositeScrubber.jsx` (the
segment click handler) and/or `src/frontend/src/components/introcards/useIntroPlayback.js`
(`seekIntro`). Worth checking whether the same `landingToken` seek-dedup mechanism that fixed a
forward-seek dedup bug is now incorrectly deduping a backward seek into the intro (e.g. if the
token/fraction comparison treats "intro, some fraction" as equal to a already-visited state).

## False positive — logged for the record, not a real bug

**Card subtitle field appeared to not persist.** Typing a subtitle on a card and blurring reset the
field to empty, and the PATCH response echoed `subtitle_text: null`. Root cause: the local profile
DB was at schema `v34`, which predates `subtitle_text` (added in **v035**, T6570) — the backend's
write path is deliberately column-guarded for exactly this deploy→migrate window and silently no-ops
when the column doesn't exist. After running `POST /api/admin/migrate` (brought the DB to v42), a
direct re-test of the same PATCH persisted and echoed correctly. **Not a code defect** — confirms the
column-guard is working as designed. Flagging only because it's a good illustration of why
migrations must run before QA on this release (v034–v042 span the whole Athlete Intro Card + Overlay
regions feature set).

## Confirmed PASS

- **Athlete Intro Card creation/editor** (T5205/T5210/T6540/T6570/T6580/T6640): opened multiple
  real cards from the account's existing library (20+ QA cards from prior sessions). Toggled all
  three facts (Position/Class/Team) + subtitle on a card with a real photo — rendered as the
  "recruiting" composition with no text collisions, band/photo-grade visible, gold treatment.
  Confirmed the card editor has **no** font/color/shadow/stroke controls anywhere (T6640's
  intentional removal) — only Content/Subtitle/Photo/Style remain.
- **Full Name resolution from profile** (T6570): the profile's Full Name ("Mehdi Khabazian") and
  Position/Class/Team all correctly appear on the card without being card-level fields — edited in
  Manage Profiles, immediately reflected on the card.
- **T6680's removed-duration-gate copy**: the exact expected string ("This no longer affects which
  intro plays (T6680: there is no default intro to inherit)...") is live in the Manage Profiles UI.
- **Naming consistency** (T6660): "Athlete Intro Card" / "Athlete Intro Cards" used consistently
  across the profile section heading, the modal title, and the button.
- **Attachment badges** (T5215): both reels and collections that have an intro attached show "An
  intro plays before this reel/collection" — several real examples present in the account's data.
- **Overlay text regions — multi-element** (T6630), the biggest single change in the release: added
  a second element into an existing region via "+ Add text" — **both elements rendered
  simultaneously** on the preview (the exact bug this task fixed). Independently toggled one
  element's visibility (only that element hid). Independently deleted one element (region survived
  with the other element intact, label updated from "asdf +1" back to "asdf"). Created a brand-new
  region by clicking empty timeline lane space — landed at the correct time, opened with default
  settings. All PASS.
- **Overlay text contrast** (T6480): the Edit Text panel renders on a dark panel with clearly
  legible labels/controls — no light-on-light issue found.
- **Thumbnail marker click-no-op** (T6560): dispatched a real pointerdown/pointerup pair at the same
  coordinate (no movement) directly on the marker element — confirmed zero network requests fired
  (no accidental frame clear/move).
- **Thumbnail panel copy** (T6510/T6590): "Drag the thumbnail marker on the timeline to choose the
  frame," shows a real picked frame ("Frame you picked · 0:02"), no upload affordance, no "Use
  current frame" button anywhere.
- **Tile hover preview** (T6420): hover correctly triggered a request to
  `/api/downloads/{id}/stream` (confirmed via network log) — this particular download's stream
  404'd, but the **regular** "Preview video" button on the same tile hit the identical 404, proving
  it's a local-dev video-data gap (not backed by a real object locally), not a hover-preview defect.
  Degraded gracefully either way — no crash, no broken-image flash, stayed on the poster.

## Not exercised this pass

Time-boxed; the following from the checklist were not driven live and should be covered in a
follow-up pass: full owner-download/share-link egress (composed `[intro][reel][outro]` file
content), desktop-vs-mobile Share button routing, the edge/unfurl public share page, the
migration/sync-durability backend fixes (T6345/T6350/T6410 — checklist itself notes these need the
backend test suite, not UI), and the crash fixes (T6450/T6451 — narrow repro conditions not easily
reached through normal UI flows). None of these showed any incidental problems during this pass;
they're simply unverified, not suspect.

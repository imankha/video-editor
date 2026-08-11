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

## §4 egress follow-up (2026-08-11)

Live-drive QA of Part A of [derisk-plan-2026-08-11.md](derisk-plan-2026-08-11.md) — the egress
paths ("Not exercised this pass" above) exercised end-to-end against the running dev container
(`reel-task-testsweep2`, `localhost:5176`) as the real account `imankh@gmail.com` / profile
`9fa7378c` via `dev-login`. New spec:
[`src/frontend/e2e/T-egress-livedrive-2026-08-11.qa.spec.js`](../../src/frontend/e2e/T-egress-livedrive-2026-08-11.qa.spec.js)
— 8 tests, all green (`E2E_BASE_URL=http://localhost:5176 npx playwright test
e2e/T-egress-livedrive-2026-08-11.qa.spec.js --reporter=line` → **8 passed**). Evidence
screenshots/frames under `qa/` (gitignored).

### Confirmed PASS

- **Item 1 — owner download composes `[intro][reel][outro]` into ONE file** (reel id 64, intro
  "T6670 inline-create QA card"). `GET /api/downloads/64/file` → 11,797,465 bytes,
  `content-type: video/mp4`. ffprobe:
  ```json
  {"streams":[{"width":808,"height":1440}],"format":{"duration":"32.033333"}}
  ```
  actual duration 32.03s vs expected intro(4s) + reel(23.53s) + outro(4.5s) = 32.03s — exact match.
  Frame extracted at t=0.5s (`part-a-item-1-owner-download-intro-frame-0.5s.png`) visually confirmed:
  shows the intro card ("Jordan Vega" on the gold treatment background), not reel footage.
- **Item 2 — share link playback, logged out, intro then genuine auto-resume.** Fresh
  cookie-less Playwright context → `/shared/{token}`. Video element mounted immediately (paused,
  under the intro overlay); polled until `!video.paused && currentTime > 0.3` (bounded by intro
  duration + 10s). Then sampled `currentTime` twice 2s apart with no interaction:
  t1=0.32s, t2=2.34s, `paused=false` — genuinely advancing on its own, not a
  paused-but-ready false positive. Evidence screenshot shows the reel ("Brilliant Dribble and
  Pass") playing live in the shared-video overlay.
- **Item 3 — share-page in-app download button serves the composed file**, from a genuinely
  logged-out context. `GET /api/shared/{token}/download` → 11,797,465 bytes (byte-identical to
  item 1, as expected — same underlying reel), `content-type: video/mp4`,
  `content-disposition: attachment`. ffprobe:
  ```json
  {"streams":[{"width":808,"height":1440}],"format":{"duration":"32.033333"}}
  ```
  Same 32.03s match; frame at t=0.5s confirmed the intro card, matching item 1.
- **Item 5a — desktop Share button opens the app's ShareModal, never touches `navigator.share`.**
  `navigator.share` stubbed via `page.addInitScript` before navigation; kebab → "Share" → the
  `Share "Good Dribble and Interception"` dialog became visible; stub call count = 0. Screenshot
  confirms the ShareModal (public-link toggle, recipient list), not a native share sheet.
- **Item 5b — mobile emulation (iPhone 13) still attempts the native share path.** Same stub;
  coarse-pointer bottom-sheet → "Share" → `navigator.share` called with
  `{title, text, url: ".../shared/<token>"}` — the native path was reached, and the desktop
  ShareModal did NOT appear in this run (confirming the two paths are mutually exclusive on
  `isMobile`). A real native OS sheet can't be visually confirmed headless (noted in the kickoff);
  reaching `navigator.share` is the achievable/relevant signal.
- **Item 6 — collection share freeze holds across a later badge change.** Recorded intro consent
  (idempotent gesture) → attached card 41 ("T6620 QA card") to the `game_id=6` collection's badge
  → created a public collection share with `intro_card_id=41` explicitly frozen → `GET
  /api/shared/collection/{token}` confirmed `intro_card_id=41` → changed the collection's badge to
  card 40 ("T6670 inline-create QA card") → re-fetched the SAME share token → still
  `intro_card_id=41, intro_card_name="T6620 QA card"`, unchanged. The freeze holds: a share's
  `collection_definition.intro_card_id` is resolved from the frozen JSONB
  (`_evaluated_share_members`), never re-read from the live `collection_settings` badge.
- **Item 7 — re-export carries the intro forward.** Reel 27 (project 48, `intro_card_id=40`,
  "T6670 inline-create QA card") → `POST /api/downloads/27/restore-project` (Open-as-Draft,
  re-materializes archived working data) → `POST /api/export/final` (raw stored bytes
  re-uploaded, not the serve-time-composed download) → new `final_video_id=83` → `POST
  /api/downloads/publish/48` → `GET /api/downloads` shows id 83 with `intro_card_id=40,
  intro_card_name="T6670 inline-create QA card"` — unchanged from before the re-export. Confirms
  the `prior_intro_card_id` capture-and-carry-forward in
  `export/overlay.py` (~lines 1746-1830) works correctly.

### Confirmed GAP (not a new bug — documented, QA correctly characterizes it)

- **Item 4 — public share page's plain-HTML footer download link is the raw, uncomposed
  `video_url`.** Static-source assertion against
  `src/frontend/functions/shared/[token].js`: `videoUrl` is built directly from
  `escapeHtml(share.video_url)` (no compose call), and the footer's
  `<a class="dl" href="${videoUrl}" download>Download</a>` uses that same raw URL. No reference to
  `compose_serve_time`/a composed-download endpoint exists anywhere in the file. This is the
  documented product gap (release-map §7) — the React SPA's `/shared/{token}` route (items 2/3
  above) already serves the composed file correctly; only this separate Cloudflare Pages Function
  edge-rendered page's plain-HTML footer link is uncomposed. Confirmed current behavior only, no
  fix applied per the kickoff's scope.

### Notes for whoever re-runs this spec locally

- Sessions are single-active-per-account: a later `loginAsRealUser` call for the SAME account (on
  a different Playwright context, e.g. items 5a/5b's throwaway contexts) invalidates an earlier
  context's session cookie. Items 6 and 7 re-authenticate the shared owner context immediately
  before use to guard against this — a real dev-login/session-pinning behavior, not a bug in the
  egress paths under test.
- Item 7 re-uploads the RAW stored final-video bytes (`GET
  /api/export/projects/{project_id}/final-video`, not `/api/downloads/{id}/file`) — the latter is
  the serve-time-COMPOSED file; re-uploading it would double-composite (extra intro+outro burned
  in on top of an already-composed file) on every re-run, inflating duration and breaking items
  1/3's expected-duration math on a later run. Caught during this pass (a pure test-harness
  self-inflicted issue, not a product bug) and fixed in the spec.
- Item 7 is destructive (deletes the prior `final_videos` row, republishes a new id for the same
  project) and item 6 permanently changes the `game_id=6` collection's attached-intro badge and
  leaves a new collection share link active (no revoke endpoint exists for collection shares in
  this codebase, only for single-reel shares) — expected churn on this dev/QA account, consistent
  with how existing specs in this suite already mutate it (e.g. T6730's `attachCardToAllReels`).
  The spec prefers the known-good reel ids (64/23/27) from the kickoff over "first list match" so
  duration math stays stable across repeated local re-runs even as item 7 consumes them one by one.

**Verdict: no deploy blockers found in Part A.** All 7 checklist items pass or are the
already-documented gap; the egress rewrite (serve-time `[intro][reel][outro]` composition,
share-page playback/download, collection share freeze) is safe to ship.

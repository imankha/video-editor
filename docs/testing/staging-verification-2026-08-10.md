# Staging Verification — 2026-08-10 code freeze

**Paste everything below to a fresh AI session with Playwright access, or use it as a manual QA
script.** Companion doc: [release-map-2026-08-10.md](release-map-2026-08-10.md) (file/function
references for every item below, if you need to go read the actual code).

This covers **everything that changed on master since the last production deploy** (2026-08-03,
`bce639d0`) — 52 task IDs, dominated by one epic: **Athlete Intro Cards** (a broadcast-style intro
card prepended to reels) and its **Overlay text editor rewrite**, plus a handful of independent
fixes. Six days of continuous iteration landed here; several items are "3rd or 4th attempt at the
same bug" — treat prior "fixed" claims in commit messages as unverified until you see it yourself.

## Environment

- **Frontend (staging):** the Cloudflare Pages staging site for this project
- **API (staging):** `https://reel-ballers-api-staging.fly.dev`
- Confirm the build before testing: `curl -sI https://reel-ballers-api-staging.fly.dev/api/version | grep -i x-app-version` — must be at or after commit `55aa9ed6`.

## Required before testing starts: run migrations

This release carries **profile_db migrations v034 through v042** (Athlete Intro Card schema, text
overlay regions). Migrations do not auto-run on deploy. Run `POST /api/admin/migrate` (admin
session) and confirm `errors: []` before testing any Intro Card or Overlay text feature — most of
this release 500s on a below-head profile.

| Version | What it does | Task |
|---|---|---|
| v034 | `intro_cards` table + `final_videos.intro_card_id` | T5195 |
| v035 | `intro_cards.subtitle_text` | T6570 |
| v036 | NULLs dead `intro_cards.title_text` | T6620 |
| v038 | NULLs dead `intro_cards.text_elements` | T6640 |
| v040 | backfills a default card per profile (now inert, see Known non-bugs) | T6640 |
| v041 | `user_settings.intro_min_duration_seconds` (now inert, see Known non-bugs) | T5215 |
| v042 | reshapes `text_overlays` into regions/elements | T6630 |

## Authentication

Use the real-account path (`loginAsRealUser` / `.claude/skills/drive-app-as-user/SKILL.md`) — a
blank test profile has no intro photo/consent/cards to exercise most of this release against.

## Ground rules

1. **Assert on what the user SEES**, not API responses.
2. **A passing test you did not watch is not evidence.** Screenshot at each checkpoint. Several
   fixes in this release (T6710's forward auto-continue, T5380-class drag bugs) **passed unit/jsdom
   tests and still failed live** — real-browser verification is mandatory for anything involving
   drag, playback timing, or z-index/stacking.
3. **Report failures precisely:** steps, expected, observed, screenshot, console/network errors.
4. **Do not fix anything.** Report only.
5. **Read "Known non-bugs" before filing anything** — several controls/behaviors were
   *deliberately removed* this release; reporting them as regressions wastes a cycle.

---

# What to verify

## 1. Athlete Intro Card — create & consent (T5180/T5190/T5195/T5230)

- Upload a photo for a profile (parent-consent flow), tick consent, fill Position/Class/Team.
  Reload — all of it must persist (photo, consent tick, all three facts).
- Upload a non-image file renamed to `.jpg` — expect a clean rejection, not silent acceptance.
- Toggle consent off (revoke), then back on.
- **Without consent recorded, try to create an Athlete Intro Card** — expect a clear in-app error
  (not a silently-swallowed failure — this was itself a bug fixed mid-release).
- Record consent, create a card — succeeds.
- Run `POST /export-data` for an account with cards/photo/consent/facts — export must include all
  of it. Run account deletion — confirm the R2 photo object is actually gone afterward.
- Cross-profile isolation: none of the above on Profile A should leak onto Profile B.

## 2. Athlete Intro Card — editor & rendering (T5205/T5210/T6540/T6570/T6580/T6600/T6620/T6650/T6640)

- Create a card, toggle facts on/off in **different click orders** with the same final set — the
  rendered layout must be identical regardless of order (this was a real reported bug).
- **The 30-combination visual matrix** (this is the highest-risk surface in the release — spend
  real time here): 4 compositions (title-only / hero / broadcast / recruiting) × 3 treatments
  (gold / dark / photo-forward) × 2 aspects (9:16 / 16:9) × {short name, long 2-word wrapping name}.
  Zero title/fact collisions, in both the live preview **and** the exported MP4, matching pixel-for-pixel.
  Specifically re-check: **broadcast, 9:16, Position+Team on, Class off, a real 2-line wrapping
  name** — this exact case round-tripped through 2 "fixed" attempts before actually closing.
- Switch treatments on a full-bleed-photo card — each treatment must visibly change the lower-third
  band color/opacity and photo tint/vignette, not just an accent color.
- Set the profile's Full Name, confirm the card title updates without any card-level edit. Clear
  it, confirm the card handles a blank name gracefully.
- Type a subtitle, blur, reload — persists. Leave blank — renderer omits the line entirely (never
  draws blank).
- Duplicate a card — confirm subtitle/focal point/zoom/treatment all copy.
- **Delete-a-card must not touch the profile's own intro photo** even though a new card defaults to
  the SAME R2 photo key (this was live data loss pre-fix): create a card, delete it, confirm the
  profile's header photo still loads. Create two cards off the same photo, delete one, confirm the
  other and the profile's own photo both still resolve.
- Replace the profile photo while a card still references the old key — old object must survive
  until nothing references it; the card keeps showing its **snapshot** (a later profile re-upload
  intentionally does NOT propagate to existing cards — see Known non-bugs).
- Break a card's photo (point it at a gone object) — confirm a "photo missing" state renders with a
  working "Use profile photo" recovery button.
- Open the intro-card modal with draft/reel tiles visible behind it, **hover a tile so its preview
  portals to `document.body`** — the tile preview must never paint over the modal (this needed a
  full z-index rewrite; two earlier "fixes" only made the backdrop scrim darker and didn't work).
- At 375px viewport: no horizontal overflow, one scroll region.
- **Confirm the card editor has NO font, custom-colour, colour-swatch, shadow, or stroke control**
  — this is intentional (see Known non-bugs), not something to file.

## 3. Athlete Intro Card — discoverability (T6660/T6670/T6680/T6690)

- Every user-facing surface should read "Athlete Intro Card(s)" consistently (profile section
  heading, modal title, buttons, toasts, generated card names "Athlete Intro Card N").
- From a reel's menu → intro picker → "New card" tile → build a card → confirm you land back on the
  **same reel's picker** with the new card pre-selected, and that exactly one attach write fires
  only when you click the picker's own OK/confirm (not on card creation itself). Test this from
  **both** a single-reel picker and a collection's picker — they use different attach endpoints.
- Double-click "New card" fast — confirm only one card is created.
- Edit a profile that is NOT the currently active one in Manage Profiles — there must be a real
  clickable "Switch & manage" button (previously dead grey text), and clicking it switches profile
  AND opens the card library in one action.

## 4. Athlete Intro Card — attached to a reel/collection, and shown on every egress (T5215/T5220)

- Attach an intro to a reel, re-export it — the new export version must still carry the same intro
  (re-export must not silently drop the attachment).
- Attempt to attach a card without consent recorded — expect 403.
- **Owner download** of a reel with an intro: single file, `[intro][reel][outro]`, not two files.
- **Share link playback** (open a share link, not logged in as owner): intro plays, then the reel
  **auto-resumes with no manual tap required** (this specifically regressed once already).
- **Share link download button inside the app** (`SharedVideoOverlay`): composed `[intro][reel][outro]`.
- **⚠ Known gap, please confirm and log it, do not "fix":** the **public share page's own footer
  Download link** (the plain HTML page a link-preview crawler or no-JS visitor sees) still points at
  the raw video file and does **not** include the intro or outro — only the in-app download button
  does. Confirm this is the actual current behavior and flag it to the release owner; it is a real
  product gap, not something QA should try to work around.
- **Desktop** click "Share" on a reel — opens the app's own ShareModal, does **not** pop the native
  OS share sheet (some desktop Chromium exposes `navigator.share`; this was a real regression).
  Mobile Share still uses the native sheet.
- Attach a card to a collection, share it, then **change the reel's own intro setting afterward** —
  the already-created share link must keep showing what was frozen at share-creation time, not the
  new setting.
- Collection playback shows the intro exactly once before the first member, not once per member.
- View a public share page's raw HTML (View Source or `curl`) for a share with an intro attached —
  confirm the intro DOM renders and the video has no bare `autoplay` attribute.
- The public-exposure notice appears in both the card picker and the Share modal whenever a card
  with a photo is being shared.

## 5. Athlete Intro Card — owner in-app playback as a real timeline segment (T6700/T6710)

- Play your own reel/collection with an intro attached (as the owner, in-app) — the intro now plays
  as a proportionally-sized segment on the **same scrubber** as the reel, not a separate screen.
- **Click the intro portion of the scrubber** — must be visible and clickable (this was invisible/
  unclickable due to a z-index bug in an earlier round).
- Seek backward from the reel into the intro — lands at the correct point in the intro's own
  animation, not a restart from zero.
- While the reel is playing, confirm its progress visibly advances on the composite bar (was
  hardcoded to 0% in an earlier round).
- **Let the intro play to its natural end with no interaction** — confirm it auto-continues into
  the reel. This exact case passed automated tests and still failed live in an earlier round —
  verify it for real, don't trust a green CI run alone.
- Repeat the same scrub twice in a row — both should apply, not get silently deduped.
- Confirm this also works on the **public share page's collection view** (proportional segment
  widths reach there too, as a side effect).
- A reel/collection with **no** intro attached should show a completely normal, unaffected player.

## 6. Overlay text editor — regions with multiple simultaneous elements (T6630)

This is the second-biggest change in the release (50 commits, structurally different data model).

- Add a text element, then **add a second element into the same existing region** (via the Text
  tab's per-region "+ Add text", not a new timeline click) — both must render **simultaneously** on
  the preview (the original bug: the 2nd element silently got its own disjoint time window and only
  one was ever visible).
- A region with 3+ elements: each independently toggles visibility, edits its own font/color/
  position, and deletes without affecting its siblings. Deleting the **last** element in a region
  deletes the region too.
- **Create a region by clicking anywhere in the empty timeline lane** — there is deliberately no
  "+ Add Text" button (removed by user decision); don't look for one.
- Drag a region's body (not the edge levers) to move it — start+end move together, duration
  preserved; a lever press still resizes, not moves.
- `Delete`/`Backspace` on a focused region deletes the whole region (every element in it).
- The Text tab shows a region **tree** scoped to the current playhead position — move the playhead
  off a region and the tab should empty/dim (but stay clickable).
- Load an account that had overlay text saved **before** this release — confirm it still renders
  correctly as a single-element region after the migration.

## 7. Overlay text editor — everything else (T5225, T6480, T6510, T6560, T6590, T6610, T6720)

- Add a text callout, drag its edge levers near a clip cut — confirms it snaps to the boundary.
- **On the deployed/staging site (not local dev)**, change a text block's font — confirm the glyph
  actually changes (a real bug: font URLs resolved against the wrong origin in staging/prod only,
  invisible in local dev because of the Vite proxy).
- Export a project with overlay text — burned-in text must match the live preview exactly.
- Open "Edit Text" on the Overlay screen — labels/color swatch/sliders must be legible (previously
  near-white-on-pale, now on a dark panel).
- Open a project with no prior thumbnail override — a real frame from the video shows by default
  (not blank). Drag the thumbnail marker — the shown still updates to match.
- **Click the thumbnail marker without dragging** (or click-release in the same spot, or
  keyboard-activate without moving) — must be a no-op; it must NOT clear or move the frame. Only an
  actual drag past a few pixels should change it.
- Confirm there is no "Applies highlight overlay (H.264)" line anywhere in the Overlay export copy.
- Sweep all Overlay-screen text for the word **"thumbnail"** — "preview image" and "cover photo"
  should be fully gone (this is the 3rd and final rename of the same concept).
- Confirm the old **"Use current frame" button no longer exists** — dragging the marker is the only
  way to set the thumbnail now.
- Seek the playhead exactly onto the marker's time — the marker icon must stay fully visible on top
  of the playhead, not hidden behind it.
- Grab a text block's **body** and drag — moves start+end together. Grab a **lever** (edge) — still
  resizes only that edge.
- **Select a text element and drag it directly on the video preview** — repositions it live; release
  and reload, position persists. Drag to the very edge/corner — clamps inside the frame instead of
  erroring. Click an unselected element directly on the canvas — selects it.
- Click a position preset, then immediately (under ~250ms) start a canvas drag on the same element —
  the drag should win, not a stale queued preset write.
- On mobile: drag a text element then release — confirm the trailing tap doesn't also toggle
  fullscreen video playback.

## 8. Tile hover preview (T6420/T6441)

- On desktop, hover a "Ready"/"Done" draft tile or a My Reels tile — poster shows immediately,
  nothing loads until a brief dwell, then a muted looping preview crossfades in (no black flash).
- Move the mouse across a grid of tiles without lingering — confirm (via the Network tab) that
  **no** video requests fire.
- Hover tile A, then tile B before A finishes revealing — only B ends up playing.
- Hover a draft that's mid-Overlay (has a working video but no final export yet) — same preview
  behavior, sourced from the working-video stream. A "Not Started"/"Framing" draft still shows no
  preview at all.
- Click Play on a My Reels tile while its preview is running — preview stops cleanly, full player
  opens, no doubled audio.
- Enable OS "reduce motion" — hover should produce no preview anywhere.
- Confirm touch/mobile tile behavior is completely unaffected (long-press-to-reveal-actions still
  works; there is no autoplay-on-scroll yet — that's a separate, unshipped task, see below).

## 9. Crash fixes — confirm the repro no longer crashes

- Start a multi-clip Framing export for a project whose clips resolve from the database with no
  uploaded video file backing them — must complete, not crash.
- (Dev/CI environment only, not relevant to prod) export a clip with rotation set while the mock/
  local upscaler is in use — must complete without a `TypeError` (the output will not actually be
  rotated in this mock path — that's expected, not a new bug).

## 10. Independent small fixes

- Header profile control: a profile with an intro photo shows it; if that photo's R2 object is
  gone, the thumbnail should disappear cleanly (no broken-image icon), and reappear if a new photo
  is uploaded.
- My Reels tiles: the Play button now renders centered on the tile, not bottom-left. Confirm it
  still works and doesn't visually collide with the new hover-preview video underneath it.
- Share a reelballers.com link (Slack/iMessage/or any link-preview inspector) — confirm the new
  logo+tagline preview card, and that the tagline reads "Share Your **Athlete's** Brilliance"
  (site-wide, not just the preview card).
- On an actual mobile device, drag the landing page's before/after slider repeatedly for 10-15+
  seconds — the "After" video must never freeze mid-drag (iOS Safari is the original repro
  environment; test real iOS Safari if you have it, not just emulation).

---

# Not exercisable through the UI — confirm via backend test suite instead

These three are real fixes but their trigger conditions (a mid-flight sync failure, a specific
out-of-order migration merge, an unsynced-writes race during a profile migration) cannot be forced
on demand through the app. Confirm via the cited test files rather than filing "couldn't reproduce":

- **T6345** (postgres migration runner skipped version gaps) — `test_t6345_migration_version_gaps.py`
- **T6350** (move-to-profile half-apply) — `test_t6350_move_half_apply.py`. The **normal, non-failure
  move-to-profile flow** IS testable live and should be regression-checked: move a reel to another
  profile, confirm it disappears from source and appears in target with the standard success toast.
- **T6410** (migration swap discarding unsynced writes) — `test_t6410_migration_preserves_unsynced_writes.py`

---

# Known non-bugs — do not file these

- **Card editor has no font/color/shadow/stroke controls.** Deliberately removed (T6640, user
  directive: "the user shouldn't be able to make it ugly"). Typography is now fully template-owned.
  The **Overlay** text editor is unaffected and keeps full styling control — that's the control group.
- **A profile photo re-upload does not update existing cards.** Cards store a snapshot of the photo
  key at creation time. This is an approved, user-confirmed recovery model (Remove → "Use profile
  photo"), not a sync bug.
- **No "default" or "inherit" intro card exists.** A profile with cards but no explicit attachment
  shows no intro anywhere. This was a deliberate removal (T6680) that closed a real consent hole —
  don't expect a "set as default" option or an inherited-card indicator.
- **The old duration-gated intro rule doesn't apply anymore.** Any explicit attachment shows
  regardless of reel length; the settings field for it is inert leftover UI.
- **Card editor doesn't show a "Layout: Hero" style badge.** Removed by user decision — the layout
  is deliberately not named to the user.
- **In-app owner playback intro segment delete-button hit target looks small on the Overlay
  timeline.** A 44px enlarged hit box was tried and then explicitly reverted to match the sibling
  region-delete control — current small hit box is intentional, not a regression.
- **Touch users get no autoplay-on-scroll for tile previews, and there's no user-facing toggle for
  it.** Both are separate, unshipped tasks (T6430/T6440) — confirmed zero commits in this range.

---

# Explicitly OUT of scope

- **T6550** (poster-marker-time write path still lacks a column guard) — confirmed **NOT fixed** in
  this range; it's a known, still-open landmine that will 500 if the write path is hit on a
  below-head DB during the deploy→migrate window. Not new, don't file it as new, but be aware a
  poster-marker drag could 500 if migrations haven't finished running yet.
- Cross-machine sync conflicts — production runs a single backend machine, not reproducible here.

---

# Report format

For each numbered area above:

```
AREA: <name>
STATUS: PASS | FAIL | PARTIAL | UNTESTABLE
STEPS: <what you actually did>
OBSERVED: <what you saw — quote rendered text>
EVIDENCE: <screenshot filenames>
```

Then finish with:
- **Regressions found** (anything that worked before and doesn't now) — highest priority
- **Anything you could not test, and why**
- **Console errors / failed network requests** seen at any point

Be blunt about failures. This release rewrote both the card typography engine and the overlay text
data model, and touches every download/share/export egress path — a false PASS here is expensive.

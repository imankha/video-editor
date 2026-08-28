# T7920: Mobile clip-save live-drive audit (the decisive cliff, on phones)

**Status:** WAITING ON USER
**Impact:** 6
**Complexity:** 2
**Created:** 2026-08-27 (from the 2026-08-27 drop-off report refresh)

## Problem

The 2026-08-27 refresh shows the decisive drop-off has moved to durable-upload -> first
clip, and we now have the first mobile data point for it: **mostafaali452010** (2026-08-27,
the first-ever successful mobile uploader, iPhone-class viewport) fired `add_clip_opened`
37 seconds after his upload landed, saved nothing, and left. That is the exact
open-form-save-nothing pattern of cschwartz78, jordark, and (per the original report's
prediction) the tag-trap class — except nobody has ever driven the full mobile clip-save
path end to end since T7540 (tag trap), T7850 (no-sport Add Clip warning), and T7590
(mobile Add Game) landed.

T7590 proved the mobile ADD GAME dead end was real and fixable; the equivalent audit for
ADD CLIP has never been done. The Tutorial Redesign epic (T7640) includes a real-device
pass but is sequenced far later and gated on design approval.

## Solution

A focused live-drive audit, not a feature: drive the app as a real user
(drive-app-as-user skill, dev-login + realAuth.js) at mobile viewports (320x568 and
375x667, keyboard open/closed), through the full cliff-3 path:

upload small game -> open the game -> open Add Clip -> set range -> type a tag ->
save -> verify the `raw_clips` row exists.

Audit checklist (each with screenshot evidence):
1. Add Clip form fully reachable/operable at 320px (no control off-viewport or under the keyboard)
2. Tag input: the T7540 fix behavior on mobile (typing without Enter must not dead-end Save)
3. T7850's NoSportTagWarning renders correctly in the mobile-compact block (shipped with component tests only, explicitly never live-driven — this closes that gap)
4. Save button reachable with keyboard open; save round-trip completes; failure states visible
5. `clips_attempted`/`clips_failed` counters (T7510, deployed 2026-08-27 06:55, still unproven — 0 recorded events) actually fire during the drive — this doubles as their first live verification

Fix rule: S/M-tier findings are fixed inline in this task (branch per finding class);
anything larger gets filed with the evidence attached, not fixed here.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ClipDetailsEditor.jsx`, `AnnotateFullscreenOverlay.jsx`, `UploadClipModal.jsx` — the Add Clip surfaces (T7850 touched all three)
- `src/frontend/e2e/` + `realAuth.js` — drive harness
- `src/frontend/src/containers/AnnotateContainer.jsx` — `add_clip_opened` / save flow

### Related Tasks
- Verifies live: T7540, T7850, T7510 clip counters
- Complements: Tutorial Redesign T7640 (its real-device pass covers guided steps, not raw form usability)
- Evidence source: mostafaali452010 in the 2026-08-27 drop-off refresh

### Technical Notes
- Real browser required — jsdom gives false confidence on pointer/viewport work (T5380
  lesson); Playwright with real viewport + touch emulation minimum, note anything that
  still needs a physical iPhone pass.
- Do this on staging or local dev, never prod accounts.

## Implementation

### Steps
1. [x] Script the drive (small test video, mobile viewport matrix) — `src/frontend/e2e/T7920-mobile-clip-save-audit.qa.spec.js`
2. [x] Run the checklist, capture per-step screenshots — 9 PNGs under `qa/`
3. [x] Fix S/M findings inline; file larger ones with evidence — no S/M bug found; one UX follow-up filed (T7922)
4. [x] Confirm clips_attempted/clips_failed fire — first live proof captured (see Verdict)
5. [x] Write the verdict — below

## Acceptance Criteria

- [x] Full path driven at 320px and 375px with screenshot evidence per checklist item
- [x] Every finding either fixed (with test) or filed (with evidence) — nothing to fix; T7922 filed
- [x] T7510 clip counters observed firing — clip_save_attempted / clips_attempted proven (clips_failed correctly 0 on success)
- [x] Verdict written (below)

## Progress Log

- 2026-08-28 — Built a self-contained real-browser drive (`e2e/T7920-mobile-clip-save-audit.qa.spec.js`):
  authenticated disposable guest -> upload a UNIQUE per-run video (fresh game; the app dedups
  uploads by content hash, so a shared fixture resumes an old game and no-ops the mobile
  create-save) -> drive the REAL mobile inline Add Clip form (`AnnotateFullscreenOverlay`
  layout="inline") at 320x568 and 375x667, plus the landscape-inline compact path at 667x375.
  Runs green in ~30-50s, reproducibly (2x consecutive clean passes). Ran on the chromium engine at
  real iPhone viewport sizes.
- Test-harness notes (env, not product): the Add Game submit paywalls a 0-credit guest once the
  balance loads (seeded the credit store to stay on the create path; backend authorizes the guest
  upload regardless — proven live); `test-login` is deterministic (one shared session user in dev),
  so isolation comes from a unique upload per run, not the X-User-ID.

## Verdict — mobile clip-save is FUNCTIONALLY CLEAN

Driven end to end (add_clip_opened -> saved `raw_clips` row) at 320x568 and 375x667. What a mobile
user hits between opening the form and a saved clip is a working form, not a dead end:

1. **Form reachable/operable at 320px** — no horizontal overflow; the Save button lays out inside
   the viewport and is reachable with the tag input focused (soft-keyboard proxy).
   Evidence: `qa/criterion-1-form-reachable-{320x568,375x667}.png`.
2. **Tag input T7540 fix holds on mobile** — a teammate name typed WITHOUT Enter is auto-committed
   into the save payload and Save fires; the old "Tag not submitted" dead-end never appears.
   Evidence: `qa/criterion-2-4-pending-tag-focused-*.png` + payload `tagged_teammates` assertion.
3. **NoSportTagWarning renders** in the mobile Add Clip Tags block (a fresh profile is `no_sport`,
   T7850) — full variant in portrait inline, and the **compact** variant live in the
   landscape-inline scrub bar. Evidence: `qa/criterion-3-nosport-warning-*.png` (incl. the
   `-compact-landscape-667x375` shot — first live drive of the compact block).
4. **Save round-trip completes** — `POST /api/clips/raw/save` returns 200 with a real
   `raw_clip_id`; both created clips appear in `GET /api/games/{id}/load` annotations.
   Evidence: `qa/criterion-4-saved-*.png`.
5. **T7510 clip counters fire (first live proof)** — `user_actions` for the drive: `add_clip_opened`,
   `clip_save_attempted`, `clip_created` all recorded with `platform=webapp-mobile`; the daily
   rollup shows `clips_attempted` incrementing and `clips_failed = 0` (correctly 0 on success —
   the failure path is emitted by the durable-sync 503 in `middleware/db_sync.py`, not exercised
   here). So the T7510 clip counters are proven wired end to end.

**Conclusion:** The decisive "open Add Clip, save nothing, leave" pattern (mostafaali452010) is NOT
caused by a broken mobile clip-save form — the form works at the reported viewports. The most
plausible product contributor surfaced by the drive is that every NEW profile is `no_sport`
(T7850), so a first-time mobile user's Add Clip **Tags** section is only an amber "set your sport
(top bar)" prompt instead of tappable tags — a friction/dead-feeling step at exactly the moment
they'd tag their first clip. That is a UX/design question larger than an S/M inline fix, so it is
FILED as **T7922** (evidence: `qa/criterion-3-nosport-warning-*.png`), not fixed here.

**Real-device residue:** run on the chromium engine with emulated iPhone viewports, NOT real iOS
Safari — the true soft keyboard (visualViewport shrink) and iOS Safari pointer/fullscreen quirks
are not reproduced. Item 4's "keyboard open" is approximated by focusing the tag input. A physical
iPhone pass of this exact flow is still worthwhile (belongs to the T7640 Tutorial Redesign
real-device pass).

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
1. [ ] Script the drive (small test video, mobile viewport matrix)
2. [ ] Run the checklist, capture per-step screenshots
3. [ ] Fix S/M findings inline; file larger ones with evidence
4. [ ] Confirm clips_attempted/clips_failed fire (first live proof of the T7510 clip counters)
5. [ ] Write the verdict: is mobile clip-save clean, or what exactly breaks

## Acceptance Criteria

- [ ] Full path driven at 320px and 375px with screenshot evidence per checklist item
- [ ] Every finding either fixed (with test) or filed (with evidence)
- [ ] T7510 clip counters observed firing, or their failure filed as a bug
- [ ] Verdict written: what a mobile user hits between add_clip_opened and a saved clip

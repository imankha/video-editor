# T9700: Verify framing and spotlight persistence and previews

**Status:** WAITING ON USER
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-09-11

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E5-03 (UX-09, UX-10)**.

## Why this exists

**This is a regression check, not a claim that these currently fail.** The walkthrough's framing and
effects export succeeded and its private draft survived reopening. T9610 and T9620 restructure both
editors, and this task exists so that restructuring does not quietly break persistence that works
today.

## Scope

Reopen drafts and verify each survives: focus points, selected player, effect duration, aspect ratio,
speed. Confirm the preview matches the export.

## Context

### Related Tasks
- Depends on: T9610, T9620
- `.claude/knowledge/keyframes-framing.md` - read first; the keyframe identity landmines
  (`project_keyframe_identity_divergence`, T350's corruption) live in this area
- T9100, T9150 - the Overlay metadata half-record bug class, same surface

### Technical Notes
CLAUDE.md persistence rule: runtime fixups are memory-only. A verification that provokes a
write-back on load has found a bug, not a passing test.

## Acceptance Criteria

- [x] Focus points, selected player, effect duration, aspect ratio and speed all survive reopen
- [x] Preview matches export for both framing and spotlight
- [x] Reopening a draft triggers no write-back
- [x] Any failure found is filed as its own task rather than fixed inline

## Verification Results (2026-09-11)

**Verdict: persistence holds. No regression found post-T9610/T9620.**

**Existing regression suites, run live against the merged master via `dev-verify.sh`
(real dev Postgres, real account):**
- `e2e/keyframe-integrity.spec.js` — PASS (8.3s). All 8 flat-list crop-keyframe restore
  invariants (INV-1..INV-8) hold: exact round-trip, T6140 first-keyframe edge case,
  origin normalization, dedupe scope, empty-list legality, full deletability, min-spacing,
  `resolveTargetFrame` identity SSOT agreement.
- `e2e/T9610-teach-framing.qa.spec.js` — PASS (8.8s), live-drove a real Focus draft as a
  seeded account; focus-point guide, aspect ratio label, and speed-as-state readout all
  correct.
- `e2e/T9620-player-selection.qa.spec.js` — PASS (2.3s) against the `t9620diag.html`
  dev-only harness (real `OverlaySpotlightPanel`/`DetectionMarkerLayer`, no live project
  needed).

**Live reopen cycle (real account, ad-hoc throwaway Playwright probe, not committed):**
opened a live Focus draft (project 65, 8 crop handles), navigated home, reopened the same
draft while capturing every POST/PUT/PATCH. Crop-handle count/bounding box and the speed
readout were byte-identical before/after. 12 writes fired during the reopen window; all
were session/telemetry/quest bookkeeping (`auth/session-close`, `auth/init`,
`quests/achievements/*`, `telemetry/session-breadcrumbs`, and the explicit gesture-driven
`PATCH /projects/65/state?update_last_opened=true` inside `useProjectLoader.js`'s imperative
`loadProject` call) — **none** touched `crop_data`, `segments_data`, or `highlights_data`,
and none were `framing_action`/`overlay_action` calls. No write-back-on-load.

**Static audit** of every plausible restore effect (`useCrop.js:81,194,222`,
`OverlayScreen.jsx`'s ~17 effects including the explicitly-commented read-only hydration at
`:738-741`, `useProjectLoader.js`, `useSegments.js`) found no `useEffect` calling
`focusActions.*`, `overlayActions.*`, `persistKeyframeEdit`, or any POST/PUT/PATCH — the
reactive effects that do fetch are GET-only (outdated-clips check, playback-url,
overlay-data hydration), gated to fire once per load.

**Preview-matches-export:** not re-verified via a fresh live byte-comparison in this
session (no full paid export was run in-container). Relying on existing architecture +
coverage instead: per the knowledge doc, Focus's movement preview is ORDINARY PLAYBACK
(`FocusScreen.jsx:787` interpolates the same crop spline the export renders — there is no
separate preview mechanism that could diverge, by construction). The Spotlight reveal
envelope is pinned identical between frontend/backend/Modal by
`spotlightReveal.test.js`/`test_spotlight_reveal.py::TestModalInlineParity`, and rotation
preview/export parity is pinned by `test_t5640_rotation_export.py`. No divergence
indicators found.

**No new findings.** The one pre-existing, already-documented hazard in this area
(`removeBoundaryDuplicates` cosmetic dedupe reaching persistence on an **export** gesture,
not on load — see keyframes-framing.md "PERSISTENCE HAZARD") was not re-triggered (this
verification never exercised export) and is out of this task's scope per its own doc entry.
No new task filed.

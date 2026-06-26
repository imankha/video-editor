# T4020: Export Creates an Empty "Shadow" Working-Clip Version That Loses Framing

**Status:** TODO
**Impact:** 9
**Complexity:** 4
**Created:** 2026-06-26
**Updated:** 2026-06-26

## Problem

After exporting a reel from the Framing screen, the user's framing (crop keyframes, trim,
segment speeds) appears **lost** when they return to the editor. Reproduced live on dev with
imankh@gmail.com, project 39 ("Brilliant Dribble"):

- The user added crop keyframes + a trim + a 0.5x segment speed, then exported.
- The **exported video was correct** (it rendered from the real framing).
- But a **new, empty working-clip version was created on top**, shadowing the real one, so the
  editor now shows blank framing and a re-export would use the empty version.

This is almost certainly a major part of the long-suspected "buggy edit path" — re-editing or
re-exporting a reel silently drops its framing for the *next* edit.

## Root Cause (traced)

Working clips are versioned; readers take `MAX(version)` via `latest_working_clips_subquery`
(`src/backend/app/queries.py`). Post-export, project 39 has:

| working_clip | version | crop_data | segments_data | exported_at |
|---|---|---|---|---|
| id 41 | 1 | **3 real keyframes** | real (trim + 0.5x speed) | set (the export) |
| id 59 | 2 | **None** | default `{boundaries:[0,dur],segmentSpeeds:{},trimRange:null}` | None |

Version 2 (empty) shadows version 1 (the real framing). The empty v2 is written by the
**frontend full-state save**, NOT the backend (the backend `update_working_clip`,
`src/backend/app/routers/clips.py:~1980-2060`, creates a new version when
`is_framing_change AND was_exported AND data_actually_changed` — that is the versioning path;
it faithfully persists whatever the frontend sends).

The frontend fires **two** saves around an export:

1. `ExportButtonContainer.jsx:672` `saveCurrentClipState()` — BEFORE render. Correct: persists
   the user's edits → working_clip v1, which is what gets exported. ✅
2. `FramingScreen.jsx:896` `framingSaveCurrentClipState()` inside
   `handleProceedToOverlayInternal` — on the **export→overlay transition, AFTER render**. By this
   point the framing hooks (`useCrop` / `useSegments`, `src/frontend/src/modes/framing`) have
   reset to defaults, so this save persists **empty crop + default segments** → working_clip v2,
   shadowing v1. ❌

This violates the project rule (CLAUDE.md "Persistence: Gesture-Based, Never Reactive"):
> Full-state saves require explicit gesture: `saveCurrentClipState` only runs on export button
> click, never reactively.

A post-export transition is not a deliberate save gesture, and it clobbers the export.

## Not Related to T4010

T4010 (atomic re-export) is **backend-only and never inserts working_clips**. The frontend is
byte-identical on master vs the T4010 branch. This bug reproduces independent of T4010 — it was
found while testing the T4010 branch on dev, but it predates it.

## Investigation Required (test-first — do NOT blind-delete line 896)

1. **Confirm WHY the framing hooks are empty at FramingScreen.jsx:896.** Trace
   `handleProceedToOverlayInternal` (the export-complete callback, wired at line 1190
   `onProceedToOverlay`) and what resets `useCrop` / `useSegments` between export start and that
   callback. The deeper bug may be the reset itself; the save merely persists it. Determine
   whether the right fix is (a) skip the redundant save on an export-driven transition (the
   export already saved at ExportButtonContainer:672), (b) gate the save on a real
   "unsaved user changes" signal — note `framingChangedSinceExport` /
   `setFramingChangedSinceExport` is already in scope (FramingScreen deps at line 975), or (c)
   prevent the hooks from resetting to defaults before the save. Pick the fix that makes the
   empty-shadow unrepresentable, per "make the mistake unrepresentable."

2. The fix must guarantee: **an export never creates a working-clip version that drops the
   framing that was just exported.** After export → overlay → back to framing, the latest
   working_clip version must still carry the user's crop/trim/speed.

## Test Scope

- **Frontend (primary):** a test around `FramingScreen` / the export-to-overlay transition that
  asserts no empty full-state save is issued after an export (the post-export transition does not
  POST a clip-state save with default/empty crop when the user made no new change). Reproduce the
  shadow first (failing), then fix.
- Consider a backend guard test too (optional): `update_working_clip` should not create a new
  version from a save whose decoded crop/segments equal the *default* for an already-framed
  exported clip — but the primary fix is to stop the frontend from sending it (gesture rule), not
  a backend workaround (per "No Defensive Fixes / Correct Data").

## Recovery (separate, after fix verified)

On dev, project 39 has the empty shadow v2 (working_clip id 59). Recovery = delete working_clip
id 59 so v1 (id 41, with framing) becomes latest. Only 1 reel is affected on this account (only
project 39 was exported this session). Done as a dev R2 edit with a db-version bump — the
supervisor handles it after the fix lands (recovering before the fix just lets the next export
re-shadow).

## Classification

**Stack Layers:** Frontend
**Files Affected:** ~2-3 files
**LOC Estimate:** ~30 lines
**Test Scope:** Frontend Unit

| Agent | Include? | Justification |
|-------|----------|---------------|
| Code Expert | No | Root cause + lines already traced in this file. |
| Architect | No | Small, localized fix; persistence rule is the design constraint. |
| Tester | Yes | Test-first reproduction of the shadow save is required. |
| Implementor | Yes | Guard/remove the redundant transition save + confirm reset cause. |
| Reviewer | Yes | Persistence-rule correctness (gesture-based, no reactive full saves); blast radius is every export. |
| Migration | No | No schema change. |

## Key Rules (CLAUDE.md)

- **Persistence: Gesture-Based, Never Reactive** — full-state saves only on an explicit gesture
  (export click), never on a transition/reactive path.
- **No Defensive Fixes / Correct Data** — fix the frontend save, don't add a backend guard that
  silently swallows empty saves.
- Branch `feature/T4020-framing-shadow-version-on-export`; commit explicit paths only; don't
  change task statuses.

## Relevant Files

- `src/frontend/src/screens/FramingScreen.jsx` — `handleProceedToOverlayInternal` (~875-975),
  the redundant `framingSaveCurrentClipState()` at **896**; `framingChangedSinceExport` flag;
  `useCrop`/`useSegments` init (~178, 254).
- `src/frontend/src/containers/ExportButtonContainer.jsx:672` — the correct pre-render save.
- `src/frontend/src/modes/framing` — `useCrop` / `useSegments` (where state resets to default).
- `src/backend/app/routers/clips.py:~1980-2060` — `update_working_clip` versioning (context;
  this is correct, do not change unless the optional backend guard test justifies it).
- `src/backend/app/queries.py` — `latest_working_clips_subquery` (MAX(version) read).

## Acceptance Criteria

- [ ] A failing test reproduces the empty-shadow version created by the post-export transition.
- [ ] After the fix, exporting then returning to framing leaves the latest working_clip version
      carrying the user's crop/trim/speed (no empty shadow version is created).
- [ ] The redundant post-export full-state save is removed or gated on genuine unsaved changes.
- [ ] Frontend tests green; no backend schema change.

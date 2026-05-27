# Bug Report Diagnostic Quality

**Status:** TODO
**Started:** -
**Completed:** -

## Goal

Every bug report captures enough runtime context that an AI agent (or human debugger) can reproduce the bug in a test environment without asking the user for more information. The report should tell the complete story: what the user was doing, what state the app was in, what actions they took, and what it looked like.

## Why

Bug #1 (production, filed 2026-05-26) had: NULL editor_context, NULL actions, and a garbled 1170x2695px screenshot. An AI agent looking at this bug gets a user description, console logs (mostly SLOW_FETCH warnings), and an incoherent image. It can't answer basic questions: What mode was the user in? Which game? Which clip? What did they do before the bug? What did the screen actually look like?

The bug reporting system (T3100) stores data in Postgres + R2, but the data capture is incomplete and degraded. This epic fixes every gap in the capture pipeline so `/bug {id}` gives an agent everything it needs.

## Tasks

| ID | Task | Status |
|----|------|--------|
| T3150 | [Fix Backend NULL Storage](T3150-fix-null-storage.md) | TESTING |
| T3160 | [Screenshot Regression](T3160-screenshot-regression.md) | TESTING |
| T3170 | [Editor Context Enrichment](T3170-editor-context-enrichment.md) | TESTING |
| T3180 | [Action Breadcrumbs](T3180-action-breadcrumbs.md) | TESTING |

## Design Decisions

### What "enough context" means

The AI agent running `/bug {id}` should be able to:

1. **Identify the exact screen state**: mode, game, project, clip, video position, active panel
2. **Reconstruct the action sequence**: what the user did in chronological order, with enough detail to replay the steps
3. **See what the user saw**: a coherent screenshot of the viewport (not the full scrollable body)
4. **Find errors**: console errors/warnings with timing that correlates to the action sequence

### Breadcrumb philosophy: intent, not input

Track **user intent** (what they were trying to do), not **input events** (where they clicked). "Added clip at 495-510s with rating 3" is useful. "Clicked at (234, 567)" is noise. The buffer should reconstruct a narrative, not a replay.

**High-signal events (~20 types):**
- Mode changes, game/project/clip selection, video load
- Clip add/delete/rating in annotate (with timestamps, rating)
- Keyframe add/delete in framing (with frame number)
- Region add/delete in overlay, effect type changes
- Export start/complete/fail
- Video seek/play/pause (captures timeline position)

**Skip (noise):**
- Mouse moves, hover, scroll, zoom, volume, panel toggle
- Intermediate drag positions
- Speed changes, fullscreen toggle

### Editor context: reproducible state per mode

Each mode contributes different state needed to reproduce bugs:

| Mode | Must capture |
|------|-------------|
| All | mode, profileId, project (id, clipCount, selectedClipId), game (id, name), video (time, duration, playing), viewport (width, height), route |
| Annotate | all clip regions (start, end, rating, videoSequence), selected region, video sequence count |
| Framing | clipId, keyframe count, aspect ratio, segment count, trim range, changedSinceExport |
| Overlay | clipId, effectType, highlightColor, highlightShape, region count (enabled/total), detection status |

### Screenshot: fix regression, explore separately

This epic fixes the specific regressions vs. the email-era screenshots. A separate investigation (screenshot lab on staging) will evaluate capture techniques empirically before making larger changes to the approach.

## Completion Criteria

- [ ] Bug reports with empty actions `[]` stored as `[]` in Postgres, not NULL
- [ ] Editor context includes all per-mode fields listed above
- [ ] Action breadcrumbs capture 20+ event types with relevant parameters
- [ ] Buffer holds 200 entries (up from 50)
- [ ] Screenshot captures viewport only (not full scrollable body)
- [ ] Video frames visible in screenshot (not dark voids)
- [ ] End-to-end verification: file test bug on prod, confirm all 4 data channels populated

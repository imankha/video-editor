# T8510: Export guard + progress honesty

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03 (fully specced from source; T3700 conflict surfaced)

## Problem

Walkthrough 2026-09-02: with the clip explicitly labeled "This clip has not been framed
yet.", Export Focused Video accepted the click and spent 12 credits rendering an export
indistinguishable in value from the raw clip (a centered 9:16 crop). The progress toast
labeled the job "Project #1" and showed "(Less than a minute)" for ~3 minutes.

User decision 2026-09-03: autotracking is OUT of scope; the guard and honesty fixes are in.

## PRIOR-DECISION CONFLICT - read before coding

The missing guard is not an oversight. `src/frontend/src/containers/ExportButtonContainer.jsx`
lines 1068-1075:

```
// T3700 P0: unframed clips are NO LONGER a hard block - a centered default crop is
// applied on export (visible in the editor for opened clips, applied server-side for
// never-opened clips), so a zero-effort export always produces a valid job. The
// unframed count remains a soft, non-blocking nudge in the button title.
const isButtonDisabled = disabled || isCurrentlyExporting || (!videoFile && !projectId);
```

T3700 deliberately made zero-effort export legal via a centered default crop. The
2026-09-02 evidence is that this "valid job" burns credits producing no visible value
for a first-time user, and the user approved hard-blocking. **This task therefore
REVERSES T3700's P0 decision.** Record that in the commit message and design note.
At task start, confirm the exact policy with the user in one question:
- Option A (default per user approval): hard-block while ANY included clip has zero
  crop keyframes.
- Option B (softer): block only when ALL clips are unframed (a mixed multi-clip export
  with some framed clips may be intentional).
Implement A unless the user says B.

## What to build

### Step 1 - the guard

In `ExportButtonContainer.jsx` (~line 1073):

```js
const isButtonDisabled = disabled ||
  isCurrentlyExporting ||
  (!videoFile && !projectId) ||
  (isFramingMode && hasUnframedClips);   // T8510: reverses T3700 P0
```

`hasUnframedClips` already exists (line 1062: multi-clip -> `clipsNotFramed.length > 0`;
single -> `!cropKeyframes || cropKeyframes.length === 0`), as do `unframedCount` /
`totalClips`. Update `buttonTitle` (line 1079): replace the soft nudge
"N/M clips framed - the rest will use a centered default" with
"Set at least one focus point on every clip to export" (single-clip:
"Set at least one focus point to export").

### Step 2 - the inline reason at the button

`src/frontend/src/components/ExportButtonView.jsx` already renders the amber warning
block at lines 117-131 (strings: "This clip has not been framed yet." /
"No clips have been framed yet." / "N of M clips need framing. Select and add crop
keyframes."). Keep it, but:
- Move/duplicate the reason UNDER the disabled button as a caption (the walkthrough
  showed the banner far above the button on tall panels), styled like the existing
  credit-estimate row (lines 160-173): small centered text,
  "Set at least one focus point to export - ~{estimatedCredits} credits".
- Keep the per-clip "Needs focus - add crop keyframes" chip in the clip list untouched
  (it is the wayfinding to WHICH clip).

### Step 3 - kill "Project #N"

`src/frontend/src/components/GlobalExportIndicator.jsx` line 13-18:

```js
function getExportLabel(exp) {
  if (exp.type === 'annotate') return exp.gameName || 'Annotation';
  return exp.projectName || `Project #${exp.projectId}`;
}
```

The walkthrough saw "Project #1 - 5%" then later "Brilliant Goal - 73%": so
`exp.projectName` arrives EMPTY at export start and gets populated later. Fix at the
source, not the fallback: find where the export record enters `exportStore` on start
(the start handler in ExportButtonContainer around lines 136-151 builds
`{ stage, projectName, ... }` - trace why projectName is empty on the first render;
likely the store record is created before the project fetch resolves, or the field
passed is undefined for auto-created projects). Ensure the record carries the reel
name from the click context (FocusScreen has the project name at click time). Change
the fallback string to `'Your reel'` so a missing name can never surface an internal id.

### Step 4 - honest time estimate

`GlobalExportIndicator.jsx` `calculateETA` (lines 27-59) linearly extrapolates
elapsed/percent, and formats <60s as "Less than a minute". A stall at high percent
keeps the estimate frozen. Fix:
- Track the promise: when `calculateETA` first returns a value, remember
  `Date.now() + seconds*1000` per export id (component-local ref/Map). If now exceeds
  that deadline by 15s, stop showing the number: render the current stage message
  instead (`exp.progress.message` carries stage text from the websocket - e.g.
  "Upscaling..."; verify the field name in exportStore) or plain "Still working...".
- Never show "Less than a minute" while `percent` has not changed for >30s.
Both rules live in the same small component; keep them pure-render (derive from
exp.startedAt / progress timestamps; a 1s ticker interval already exists for ETA
display or add a local one - display-only state, not persistence).

### Step 5 - tests

- `ExportButtonView.test.jsx`: disabled matrix - (a) framing + zero keyframes ->
  disabled + caption, (b) framed -> enabled, (c) multi-clip partial per chosen policy
  A/B, (d) overlay mode unaffected.
- New `GlobalExportIndicator.test.jsx` cases: no "Project #" ever (label fallback),
  stale-ETA switch to stage message at deadline+15s.
- e2e: in Focus with an unframed clip, the export button is disabled and the caption
  is visible in-viewport at 390x844 (feeds T8550's assertion set).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/containers/ExportButtonContainer.jsx` (1055-1110; start handler ~136-390)
- `src/frontend/src/components/ExportButtonView.jsx` (117-131 warning, 134-152 button, 160-188 captions)
- `src/frontend/src/components/GlobalExportIndicator.jsx` (13-18 label, 27-59 ETA)
- `src/frontend/src/stores/exportStore.js` - record shape (projectName, progress.message)
- Tests: `ExportButtonView.test.jsx`, new GlobalExportIndicator tests

### Related Tasks
- REVERSES T3700 P0 (documented above) - one-question user confirmation at start
- T8390 (Focus publish exit) touches the same panel later - keep the diff surgical
- The backend centered-default-crop path (T3700's server half) stays: it still serves
  legitimately part-framed multi-clip exports under policy B, and reverting server
  behavior is out of scope

## Acceptance Criteria

- [ ] Export cannot start with zero user keyframes (per confirmed policy A/B)
- [ ] The reason renders at the button, in-viewport on phones
- [ ] No "Project #N" can ever render; export label = reel name from the first frame
- [ ] A busted estimate switches to stage wording within 15s of its promise expiring
- [ ] Unit + e2e green; 390x844 verified

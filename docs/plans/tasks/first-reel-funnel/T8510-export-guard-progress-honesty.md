# T8510: Export guard + progress honesty

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

Walkthrough 2026-09-02: with the clip explicitly labeled "This clip has not been framed
yet.", the Export Focused Video button accepted the click and spent 12 credits rendering
an export indistinguishable in value from the raw clip. ExportButtonView.jsx renders the
unframed warning as a banner only; nothing disables the button. The progress toast
labeled the job "Project #1" (a vocabulary token used nowhere else) and showed "(Less
than a minute)" for roughly three minutes.

User decision 2026-09-03: autotracking is OUT of scope. The guard and honesty fixes are in.

## Solution

- Hard-block export when a clip has zero user crop keyframes: button disabled with the
  reason inline ("Set at least one focus point to export, ~12 credits"). Multi-clip
  reels: block while ANY clip is unframed, listing which (reuse the existing per-clip
  "Needs focus" data).
- Progress toast uses the reel's name, never "Project #N".
- Time estimate: show honest state. If remaining time is unknown or exceeded, switch to
  stage wording ("Upscaling...") instead of a stuck "(Less than a minute)".

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/framing/components/ExportButtonView.jsx` (warning ~117-131; add disable)
- Export progress surface (locate: grep "Export Active" / "Less than a minute")
- `src/frontend/src/stores/exportStore.js` + ExportWebSocketManager - progress fields
- Backend `Project #` naming source if server-sent (grep backend for the label)

### Related Tasks
- Epic first-reel-funnel; T8390 (Focus publish exit) touches the same panel later; keep rebase-friendly
- Explicitly NOT autotracking (user decision)

## Implementation

### Steps
1. [ ] Wire hasUnframedClips (or equivalent) into the button's disabled state + inline reason
2. [ ] Rename progress label to the reel name end to end
3. [ ] Estimate honesty: stage wording when estimate is stale/unknown
4. [ ] Tests: disabled matrix (0 keyframes, partial multi-clip), label rendering
5. [ ] 390x844 pass (button + reason visible; see T8550)

## Acceptance Criteria

- [ ] Export cannot start with zero user keyframes on any included clip
- [ ] The reason is visible at the button, not only in a distant banner
- [ ] No "Project #N" string reaches the UI
- [ ] A stuck estimate never displays for more than ~15s past its promise

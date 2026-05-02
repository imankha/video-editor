# T1820: Teammate Toggle UI

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-04-25
**Updated:** 2026-05-02

## Problem

Users annotating game footage sometimes clip great plays by teammates. There's no way to mark these clips as "teammate" vs "my athlete" during the annotation flow.

## Solution

Add a lightweight "My Athlete" / "Teammate" toggle to the annotation dialog. Defaults to "My Athlete." One tap to switch. No email entry, no disruption to the scrubbing flow.

## Context

### Relevant Files (REQUIRED)

**Frontend:**
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — Add toggle
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — Add toggle to edit sidebar
- `src/frontend/src/containers/AnnotateContainer.jsx` — Wire is_teammate in save payload

### Related Tasks
- Depends on: T1810 (is_teammate field in DB)
- Enables: T1840 (framing export detects teammate clips), T1860 (reel filter)

### Technical Notes

**Toggle placement:** Near the star rating or play type tags — visible but not in the way. A simple segmented control or pill toggle: `[My Athlete | Teammate]`

**Default:** "My Athlete" (is_teammate = false). The 90% case.

**Persistence:** The toggle value is included in the existing clip save gesture. No additional API call — `is_teammate` is just another field in the save payload.

**Edit mode:** When editing an existing clip in ClipDetailsEditor, the toggle reflects the saved state and can be changed.

## Implementation

### Steps
1. [ ] Add toggle UI to AnnotateFullscreenOverlay (near rating/tags)
2. [ ] Wire toggle state to clip save payload (`is_teammate` field)
3. [ ] Add toggle to ClipDetailsEditor for editing existing clips
4. [ ] Load existing `is_teammate` value when editing
5. [ ] Visual design: compact, doesn't disrupt annotation flow

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Toggle visible in annotation dialog
- [ ] Defaults to "My Athlete"
- [ ] One tap to switch to "Teammate"
- [ ] Value persists on save via existing clip save gesture
- [ ] Toggle reflects saved state when editing existing clips
- [ ] Does not add friction to the annotation flow (no modals, no email entry)

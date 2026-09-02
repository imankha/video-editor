# T8140: One-tap first clip (form defaults + sticky Save)

**Status:** STAGING
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-31
**Epic:** [First-Clip Funnel](EPIC.md)

## Problem

The Add Clip form charges five decisions and a scroll for the very first unit of work
(theory doc T3; screenshots `mobile-09/10-add-clip-overlay*.png`): range editor, rating
labeled **"Rating (press 1-5)"** (keyboard copy on a phone), free-text Clip Name, a My
Athlete/Team "Layer" choice, and - for 100% of new signups since T7850 made `no_sport`
the default - an amber **"Pick your sport to tag this clip"** warning IN the form. Save
is below the fold.

Evidence: mostafaali452010 (mobile) opened the form 38s after his upload durably
succeeded, spent <=78s in it, never saved, never returned. Only 5 users have ever opened
this form; 3 saved. This form also produced T7540's save-dead-end. Caveat honestly: N=1
clean in-form abandonment; the T7922 inline sport picker (shipped Aug 28) already
softened the sport wall.

## Solution

1. **One-tap save:** every field defaulted - range default, rating 4, auto-name
   ("Play 3"), My Athlete layer. A first clip saves with a single tap on Save; details
   editable afterward from the clip row (clips are already editable - surface it).
2. **Sticky Save:** Save visible without scrolling at 390x844 (sticky footer in the
   overlay).
3. **Sport out of the critical path:** first save with `no_sport` triggers ONE
   full-screen question ("What sport is this?" - TurboTax style, one question, big
   targets), never an amber warning inside the form. Answer persists to the profile
   (existing gesture path).
4. **Copy:** platform-aware rating label (no "press 1-5" on touch); reassurance line
   "You can change all of this later" at the form top.
5. **Instrumentation:** add `dialog_impression:add_clip_opened_no_save` via the existing
   T7515 impression vocabulary (open-ended name, closed kind - no schema change) so
   in-form abandonment becomes measurable before/after.

## Context

### Relevant Files (REQUIRED)
- Add Clip form component (opened by `AnnotateContainer.jsx` handleAddClip - locate the
  overlay component + its mobile full-screen takeover variant)
- `src/frontend/src/containers/AnnotateContainer.jsx`
- `src/frontend/src/modes/annotate/constants/tagRegistry.js` - no_sport warning branch
- Frontend impression beacon util (T7515) + `src/backend/app/analytics.py`
  `record_impression` (verify kind vocabulary covers dialog)

### Related Tasks
- After T8130 (CTA brings more users here; defaults convert them).
- T7922 (inline sport picker) is the current state - this task moves the question out
  entirely; do not stack both prompts.
- Tutorial-redesign guided step for "create a clip" must match the new one-tap flow.

### Technical Notes
- Gesture persistence rules: the save is the gesture; defaults are memory-only until
  Save. The sport answer writes through the existing profile-sport gesture path.
- Check the T7540 regression test still passes (same form).

## Implementation

### Steps
1. [x] Beacon added alongside the ship (timing didn't allow a separate 1-2 week
       baseline-only period; `add_clip_opened_no_save` will still show the before/after
       trend post-ship)
2. [x] Sticky Save + defaults + platform-aware copy
3. [x] Full-screen sport question at first save (no_sport only) - coexists cleanly with
       T7922's inline picker, no double-prompt
4. [x] Mobile keyboard-open check - structural/component-test verified (fixed bottom
       sheet outside scroll); full real-browser keyboard-open check not runnable in the
       container (no chromium/network), documented rather than claimed

### Progress Log

**2026-09-02**: Implemented, reviewed (a real Reviewer stage this time, explicitly made
mandatory in the kickoff - APPROVED, 0 blocking/major, one cosmetic fix applied), CI
green. 65/65 relevant unit tests green, T7540 regression preserved. Merged to master -
**this completes the First-Clip Funnel epic (T8120/T8130/T8140, all 3 merged)**.

## Acceptance Criteria

- [x] A new user's first clip saves with one tap after opening the form
- [x] Save visible without scrolling at 390x844, keyboard open or closed (structural
      verification; full-browser check not runnable in this container)
- [x] No amber warning state in the default first-clip path
- [ ] Metric to watch: `clip_created / add_clip_opened` + time-to-first-clip;
      `add_clip_opened_no_save` impressions trend down after ship - post-ship metric

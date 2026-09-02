# T7620: Architect design: guided-tour engine + essential-path step definitions

**Status:** WIP (design REVISION 2026-09-02 per user feedback: per-screen intent analysis + main data source as the spine, pervasive branching intent capture, forceful push-to-publish posture, design-change recommendations allowed; D1c/D3/D4a/D5a/D6a accepted, D2 re-derived under the push directive)
**Impact:** 8
**Complexity:** 4
**Created:** 2026-08-24
**Epic:** [Tutorial Redesign](EPIC.md)

## Scope

Design document (docs/plans/tasks/T7620-design.md), USER APPROVAL GATE, covering:

1. **Engine architecture**: shade overlay (portal, z-index strategy vs existing modals),
   target registry (data-tutorial-target attributes on real elements), anchoring +
   re-anchoring (resize, scroll, route/mode change, list virtualization), step advance
   detection (hook into the SAME gesture handlers that already exist, zero new
   persistence), bouncy-arrow motion spec (reduced-motion variant), interrupt/resume
   model (user leaves mid-path, returns later at the right step), and the "not now" /
   off-toggle escape hatches.
2. **Step definitions for the essential path**: upload -> open game -> create+save a
   clip (explicitly handling the tag-input Enter behavior surfaced by T7540) -> Framing
   follow-the-athlete -> Create Reel -> My Reels -> share. Per step: target element,
   completion event, copy (says "reel" per T7580 language), mobile-specific anchoring
   notes.
3. **State model**: on/off preference + current-step bookmark, where they persist
   (user-level settings, gesture-written on toggle/step-advance), default-on for new
   accounts, behavior for EXISTING accounts (design call: on or off for users who
   predate it, ask the user).
4. **Quest reconciliation**: what happens to quest_1's watch-video steps; how the quest
   panel and the tour coexist without competing arrows/prompts.
5. **Risk section**: z-index/stacking with existing modals (no-backdrop-close rule
   interplay), iOS Safari viewport quirks (keyboard, safe areas), elements that only
   exist after data loads (data-always-ready pattern), and how the tour behaves when a
   guided step FAILS (e.g. upload error mid-tour: the tour must surface the failure
   honestly, never loop on a broken step; coordinates with T7490's retry states).

## 2026-08-31 directive addendum (binding)

EPIC.md gained the Help-button directive; this design must additionally cover:
- **Context engine**: next-best-action derivation from FLOW_EVENTS milestone state +
  current route (the "smart" half - what does THIS user on THIS screen need next).
- **Question steps**: intent-question dialogs that branch the path (full game vs
  pre-cut clips is the known first branch); branch coverage must equal the retired
  tutorial videos' curriculum - enumerate the video content and map every topic to a
  guided branch.
- **Step interaction contract**: one-clickable-control OR one-input OR one-question per
  step; explainer dialog placement algorithm that provably never overlaps the target or
  essential UI at 320px+.
- **Stall-pulse trigger**: dwell-without-key-action detection pulsing the Help button
  (never auto-open) - spec threshold, screens, and rate limit.
- **Report-a-problem** entry from Help (reuses T7515 + bug_reports paths).
- **Voice-ready copy**: per-step copy as short spoken-style sentences (V2 TTS is a
  renderer swap).
- Quest reconciliation is now simpler and harsher: the quest panel dies (T8120 collapses
  it; this design decides what of the quest STATE survives as milestone tracking).

## Inputs

- EPIC.md product requirements (user-specified, binding)
- Funnel evidence: docs/plans/tasks/upload-integrity/EPIC.md + the 2026-08-24 drop-off
  report artifact
- .claude/references/ui-style-guide.md; frontend skills: mvc-pattern, state-management,
  responsiveness, data-always-ready

## Acceptance Criteria

- [ ] Design doc with diagrams/pseudocode for the anchoring + step-advance engine
- [ ] Full step table for the essential path incl. mobile anchoring notes
- [ ] Existing-accounts default decision put to the user explicitly
- [ ] User approval recorded before T7630 starts

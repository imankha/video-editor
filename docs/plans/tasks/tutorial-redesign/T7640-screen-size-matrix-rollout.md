# T7640: Tutorial screen-size matrix verification + quest reconciliation + rollout

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-08-24
**Epic:** [Tutorial Redesign](EPIC.md)
**Blocked by:** T7630

## Scope

1. **Screen-size matrix (user requirement: tested on ALL screen sizes).** Verify the
   full guided path at minimum: 320px (iPhone SE class - the width bug reports #18/#46
   came from is 320-352), 375, 428, 768 (tablet/breakpoint boundary), 1280+ desktop.
   Mobile: keyboard open and closed, portrait + landscape, iOS safe-area insets. Every
   step's shade + arrow must anchor correctly, the target must be reachable (scrolled
   into view), and no step may be advanceable only by an element that is off-screen or
   covered. Real-device iPhone Safari pass for at least the upload + clip-save steps
   (the two mobile cliffs), not emulation alone. Evidence: screenshot per step per
   width in the PR.
2. **Quest reconciliation rollout**: apply the T7620 decision (quest_1 watch-video steps
   replaced/retired; quest panel and tour not competing), including any user_db
   migration if quest state shape changes (Migration agent per classification if so).
   **NOTE: T8690 (SHIPPED 2026-09-04) already hid the quest_1-4 "Watch tutorial video"
   steps behind `TUTORIAL_VIDEOS_ENABLED=false` (code kept, just off).** So the
   watch-video steps are ALREADY not competing with anything — reconciliation here is
   about the remaining quest steps + the guided tour, not re-retiring the videos. Decide
   whether the guided tour fully replaces the quest panel (in which case
   `TUTORIAL_VIDEOS_ENABLED` and the quest-video code become dead and can be a separate
   cleanup) or they coexist.
3. **Rollout**: default-on wiring confirmed for new signups on staging; the approved
   existing-accounts default applied; tutorial off-switch discoverable; staging
   walkthrough by the user as the final gate.

## Acceptance Criteria

- [ ] Matrix evidence table (step x width) with screenshots; real-device pass on the two
      mobile-cliff steps
- [ ] No competing guidance anywhere (quest panel reconciled)
- [ ] User completes a full guided run on staging and approves

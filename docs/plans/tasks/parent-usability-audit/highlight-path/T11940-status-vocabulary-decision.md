# T11940: Decide the highlight status words ("Clipped" and friends)

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Tier:** S/M after the decision (display-only)
**Created:** 2026-10-06
**Decision gate:** user ruling needed before any code.

## Epic Context

Follow-up to [T11910](T11910-highlight-instances-server-sync-and-orientation-slots.md) in [Epic D](EPIC.md).

## Problem

The orientation slots still show the shared status vocabulary (`HIGHLIGHT_STATUS` in `clipStage.js`:
Clipped, Framing, Framed, Spotlight started, Overlaid, Finished). The UX consult called "Clipped"
jargon and proposed Not started / In progress / Ready. Those words are used on other surfaces too
(T11790 one status ladder, T11820 Finish rename), so changing only the slots would make screens
disagree.

## Options for the user

- **A. Keep the current words** (consistent with the rest of the app).
- **B. Change everywhere** to Not started / In progress / Ready from the single map in `clipStage.js`
  and `draftStage.js`, as one display-only sweep.

Recommendation: B only if it is done as one sweep with T11790's ladder; otherwise A.

## Acceptance Criteria

- [ ] User ruled A or B
- [ ] If B: one map drives every surface; no screen shows a different word for the same state

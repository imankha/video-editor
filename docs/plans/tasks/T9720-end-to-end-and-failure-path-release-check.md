# T9720: End-to-end and failure-path release check for the parent workflow

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E8-01 (all 18 UX specs)**.

## Why this exists

Each task in this group proves its own change. **Nothing proves they work together**, and this group
touches every screen in the first-parent path at once. This is the release gate for the whole
handoff.

## Scope

Run the full path on staging, on desktop and mobile viewports, in normal and fullscreen:

1. Upload game -> mark two plays -> framed clip -> effects -> private save -> reopen -> authorized
   test publication.
2. Direct clip upload -> framing -> publish, **without** creating a game.
3. Optional multi-clip reel assembly.

Then exercise the failure paths deliberately: slow network, interrupted upload, failed render,
navigation during preview load, duplicate clicks, reload mid-flow.

Confirm credit use matches the rules confirmed by T9680, and that nothing was exposed unintentionally.

## Fixtures

- `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29). Original local path recorded in the handoff:
  `formal annotations/test.short/wcfc-carlsbad-trimmed.mp4`. **The video is not in the handoff
  archive** - confirm access or substitute an equivalent authorized fixture.
- Plays: 0:03-0:09 Control/Pass, 0:13-0:19 Dribble, optional 0:59-1:03.5 Pass.
- Fractional bounds 2.973-9.000 s for the rounding boundary check.
- Use a separate test account; do not overwrite the walkthrough's reviewed output.

## Context

### Related Tasks
- Depends on: every implementation task in this group (T9400-T9660 and the Shared Vocabulary epic)
- **Overlaps the existing staging gate.** Check `STAGING-GATE.md` and `scripts/staging-gate.sh`
  first: if this path can become a lane there rather than a one-off manual run, it should. Note that
  the runbook requires scaling the machine to 4x/4096 first.

### Technical Notes
The handoff listed 39 acceptance checkboxes for this item, which are the union of every other task's
criteria. They are not repeated here - each task owns its own. This task owns the **integration**:
the seams between them, and the failure paths no single task exercises.

## Acceptance Criteria

- [ ] The full parent path completes on staging at desktop and mobile viewports
- [ ] A direct clip reaches publication without creating a game
- [ ] An optional multi-clip reel still assembles and publishes
- [ ] Slow network, interrupted upload, failed render, navigation-during-load and duplicate clicks are each exercised
- [ ] Credit use matches the rules confirmed by T9680, with no unintended exposure
- [ ] A decision is recorded on whether this becomes a permanent staging-gate lane

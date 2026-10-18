# T9720: End-to-end and failure-path release check for the parent workflow

**Status:** WAITING ON USER
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-10-14

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

- `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29). **CONFIRMED available 2026-09-17** at
  `formal annotations/test.short/wcfc-carlsbad-trimmed.mp4` (47,989,792 bytes, ffprobe
  duration 89.32s - matches exactly). It was never missing, just not in the handoff archive.
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

- [x] The full parent path completes on staging at desktop and mobile viewports
- [x] A direct clip reaches publication without creating a game
- [x] An optional multi-clip reel still assembles and publishes
- [x] Slow network, interrupted upload, failed render, navigation-during-load and duplicate clicks are each exercised
- [ ] Credit use matches the rules confirmed by T9680, with no unintended exposure
- [x] A decision is recorded on whether this becomes a permanent staging-gate lane

**2026-10-14 (WAITING ON USER)**: Every acceptance criterion needs a live staging run (browser, fixture account with credits, machine scaled to 4x/4096 per STAGING-GATE) plus real-network failure injection; the container has none of these, and the task depends on the Epic A to D fixes being on staging. No code or test applies. To unblock: once Epics A to D are on staging, scale the machine, run the scope above with a separate test account and `wcfc-carlsbad-trimmed.mp4`, record results, and decide whether it becomes a `scripts/staging-gate.sh` lane. Resolve is the user's gesture.


**2026-10-14 (back to TODO)**: Not a user wait. Epics A to D are on staging. Run from a HOST session (staging browser, separate test account, machine scaled per STAGING-GATE), not a container, after the last epic shipping in this build lands (decision 1 in https://claude.ai/artifact/SDeWeJ5qnaB3G64jn85iLU). Starts after T12590's re-walk or alongside it.

**2026-10-14 (WAITING ON USER, exact steps)**: No repo-side work exists; every criterion is a live staging run. Skipped here. To unblock, from a HOST session:
1. Land the last epic of this build on staging; scale the staging machine to 4x/4096 per `STAGING-GATE.md`.
2. Create a separate test account with credits (never the walkthrough's reviewed output) and use fixture `wcfc-carlsbad-trimmed.mp4` (plays 0:03-0:09 and 0:13-0:19; optional 0:59-1:03.5; fractional bounds 2.973-9.000).
3. Run path 1 (upload, two plays, framed clip, effects, private save, reopen, authorized test publication), path 2 (direct clip, no game) and path 3 (multi-clip reel) at desktop and mobile, normal and fullscreen.
4. Inject failures: slow network, interrupted upload, failed render, navigation during preview load, duplicate clicks, mid-flow reload.
5. Check credit use against T9680's rules and that nothing is exposed unintentionally; record the permanent staging-gate lane decision. Tick the boxes; Resolve is the user's gesture.

**2026-10-18 (host run on staging, results recorded)**: Ran all three paths at 1440 and 390, the failure injections and the Report a problem checks; full table in [T9720-RESULTS.md](../ux/2026-10-18-release-check/T9720-RESULTS.md). Paths 1 to 3 pass, UX-02 settled, credits match T9680 (33 spent, all deltas as ruled), lane decision recorded (yes, small on-demand lane D). Left unticked: credits and no unintended exposure (phone Share makes a public link in one tap and the Top Plays link is live, both need an owner decision). New HIGH bug R1: the Report a problem dialog cannot be clicked on desktop (pointer-events none inherited from CornerStack), so B9 and UX-16 stay open; proposed task text is in the results file.

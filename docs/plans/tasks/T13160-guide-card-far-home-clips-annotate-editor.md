# T13160: Guide card still parks far from its anchor on Home Clips drafts and the Annotate play editor

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Tier:** S/M (frontend guide placement)
**Created:** 2026-10-25
**Updated:** 2026-10-25
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Found by the T12590 staging re-walk, 2026-10-25 ([RESULTS.md section 11](../ux/2026-10-11-guide-coverage-sweep/RESULTS.md)), which re-checked the T13010 to T13100 fixes on staging. Screenshots are local only (`r3-*.png` under `docs/plans/ux/2026-10-11-guide-coverage-sweep/screens/` on the host that ran the walk).

## Problem

T13060 (STAGING) fixed Focus: steps 1, 2 and 4 now sit 12 px from their anchor at 1440 and 1024. Two of its three places still fail on staging 2026-10-25:

- **Home Clips, drafts** ("Pick up where you left off. Tap a clip to finish its highlight."): the card docks at the top of the screen while the pulsing first draft tile is near the bottom, 386 / 372 / 468 / 527 px away at 1440 / 1024 / 768 / 390. The page logs `[guide-overlap] home.clips.unfinished clips-gallery`: the rule keeps the whole `clips-gallery` clear, so no slot near the tile qualifies (at 1440 the space right of the tile is empty). Evidence: r3-home-clips-{1440,1024,768,390}.
- **Annotate play editor** ("Drag the green ends ... then tap Done."): the card is 409 / 437 / 702 px from Done at 1440 / 1024 / 768 (top-left at 1440, docked at the top at 1024 and 768). 390 passes (56 px). Evidence: r3-annotate-editor-*.

## Solution

Home Clips: keep only the tiles and controls clear (not the whole gallery box), so the card can sit beside or above the first tile. Annotate editor: place the card near Done (above it, with the video as a shadeClear preference as the rule already sets) when room exists, before falling back to the top strip.

## Context

### Relevant Files
- `src/frontend/src/components/instructions/resolveGuide.js` (`home.clips.unfinished`, `CLIPS_KEEP_CLEAR`, the annotate editor rule)
- `src/frontend/src/components/instructions/FloatingCoach.jsx`, `placement.js` (`clearOfPulses`)
- `.claude/knowledge/guidance.md`

### Related Tasks
- Residual of T13060

## Acceptance Criteria

- [ ] Home Clips drafts: the card is within 250 px of the pulsing tile at 1440, 1024, 768 and 390, without covering it
- [ ] Annotate play editor: the card is within 250 px of Done at 1440, 1024 and 768, without covering Done
- [ ] A unit test pins each placement

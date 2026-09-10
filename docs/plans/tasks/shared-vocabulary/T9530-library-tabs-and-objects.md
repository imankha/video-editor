# T9530: Library tabs, objects and destinations

**Status:** TODO
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **N01-N03, N10-N15, N33, N46, UX-14 (handoff E1-03, E7-03)**.

> Child of the [Shared Vocabulary epic](EPIC.md). The epic's two binding overrides apply:
> mode names stay **AI Focus** / **Spotlight** (N16/N18 overridden), and statuses are not
> re-modelled (N22 overridden, T8470's Draft/Shared stands). Internal APIs, routes, store keys and
> analytics vocabulary are never renamed for UI consistency.

## Problem

The library reads as a mandatory four-step pipeline ("1 Games -> 2 Clips -> 3 Reels -> 4 Published"),
which tells a parent that a single highlight must pass through a multi-clip reel before it can be
published. It does not. Tab names carry status inside the object name ("In Progress Clips"), so the
tab has to be renamed conceptually whenever an item finishes. And the Clips library offers
**"Delete reel"** on a clip - the object-model mismatch the report leads with.

## Rename table

| Group | Observed | Becomes |
|-------|----------|---------|
| N01 | Add Game / Add New Game / Upload your game | **Upload game** |
| N02 | Add Video / short clip / "Add it directly on In Progress Clips" | **Upload clip** |
| N03 | Add footage / Add footage to this game | **Add footage to game** |
| N10 | In Progress Clips / YOUR IN PROGRESS CLIPS | **Clips** (status shown per item, not in the tab name) |
| N11 | In Progress Reels / Highlight Reels | **Reels** (multi-clip assemblies only) |
| N12 | Published / Publish to Highlight Reels | **Published** / **Publish clip** / **Publish reel** |
| N13 | Build New Reel / Create with 0 Clips | **Create reel** / **Create reel (N clips)**, disabled at zero |
| N14 | Delete reel (in a Clips menu) | **Delete clip** |
| N15 | Rename reel | **Rename clip** / **Rename reel**, matching the object |
| N33 | By Phase / By Game | **By status** / **By game** |
| N46 | Numbered 1-4 destinations | **Unnumbered**: Games . Clips . Reels . Published |

## Reversal to record

**N10/N11 reverse part of T8555**, which introduced the four-tab IA with "In Progress" prefixes
(itself a fix for T8545's mislabeling). Note this in T8555's file. Mitigating fact found while
triaging: `SECTION_NAMES_SHORT` already renders **Games / Clips / Reels / Published** below the `sm`
breakpoint, and `displayNames.js` records the reasoning that "Published sitting next to Reels is
what reads the middle two as in-progress" - so the short labels are already the target names, and
this change makes them universal rather than inventing anything.

**Also settled here (UX-14):** single-clip publication must never require opening Reels, and
**Create reel** is only for assembling multiple clips, never for extracting one play. Verify against
current staging - T8390, T8530 and T8555 may already satisfy this, in which case record it as
satisfied rather than re-implementing.

## Context

### Relevant Files
- `src/frontend/src/config/displayNames.js` - `SECTION_NAMES`, `SECTION_NAMES_SHORT`, `CLIP_UPLOAD`, `LIBRARY`
- `src/frontend/src/components/ProjectManager.jsx` - tab bar and panels
- `src/frontend/src/components/PublishedReelsPanel.jsx`, `DraftTile.jsx`
- `src/frontend/src/config/emptyStates.js` - `FLOW_STEPS` share these words
- `ProjectManager.fourTabIA.test.jsx`, `ProjectManager.homeTabDefaults.test.jsx` - update, do not delete

### Related Tasks
- T8555, T8545, T8360 - the IA history this touches
- T9600 - status labels on the same cards
- T9640 - the upload entry points these labels name

### Technical Notes
Tab **ids** and URLs (`projects`, `/home/reels`) are frozen for deep-link compatibility. Only labels
change. `displayNames.js` already documents that freeze - keep the comment accurate.

## Acceptance Criteria

- [ ] Tab labels read Games / Clips / Reels / Published at every breakpoint, unnumbered
- [ ] A Clips menu never says Delete reel; every object action names its own object
- [ ] Create reel is disabled with zero eligible clips and shows the selected count
- [ ] Single-clip publication never requires opening Reels
- [ ] Tab ids and URL paths are unchanged; the deep-link freeze comment stays accurate
- [ ] T8555 records the reversal with a pointer to this task
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green

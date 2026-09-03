# T8540: Share is the primary player action

**Status:** TODO
**Impact:** 7
**Complexity:** 2
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

The reel player dialog offers Re-edit, Re-rank, Download, Close. No Share. Share and
Copy Link exist only inside the card's kebab "More actions" menu, listed below Download.
The landing page's headline promise is "share via a single link"; prod has NEVER had a
real user complete a share of a self-made reel (cliff 4, 100% loss). Even a user who
survives every upstream friction must discover an overflow menu to finish the job.

## Solution

- Add Share as the visually dominant primary button in the reel player toolbar, with
  Download secondary beside it. Re-edit/Re-rank demote to tertiary.
- The card keeps its kebab, but Share also appears on the card face for Shared-capable
  reels (per ui-style-guide button hierarchy).
- Reuses the existing share flow (share modal / copy link); no new share backend.

## Context

### Relevant Files (REQUIRED)
- Reel player dialog component (locate: grep "Re-rank" / "Re-edit this reel"; likely in DownloadsPanel.jsx or a player modal)
- `src/frontend/src/components/DownloadsPanel.jsx` - card + kebab menu
- ui-style-guide skill for button hierarchy

### Related Tasks
- T8400 (publish lands on the reel) and T8410 (share-page CTA) are adjacent; this task
  is the player-surface fix and lands independently
- T8530's completion toast points at this button

## Implementation

### Steps
1. [ ] Locate player toolbar; add primary Share (opens existing share flow)
2. [ ] Demote Re-edit/Re-rank per style guide
3. [ ] Card-face Share affordance
4. [ ] e2e: open player -> Share -> link copied/share modal
5. [ ] 390x844 pass (toolbar must not overflow; see T8550)

## Acceptance Criteria

- [ ] Share is reachable in one tap from the open player, without any overflow menu
- [ ] Share is visually primary relative to Download
- [ ] Verified at 390x844

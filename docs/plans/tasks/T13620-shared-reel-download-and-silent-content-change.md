# T13620: Shared highlight reel has no Download, and its content changes silently as highlights are added or moved

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Tier:** M (frontend shared page; product decision for part B)
**Created:** 2026-10-26
**Updated:** 2026-10-26
**Milestone:** Release check bugs (bugs first), see PLAN.md

## Source

Staging QA part 2, 2026-10-26, signed-out 390x844 (report bugs 57, 59; screenshots `BUG-57-shared-reel-no-download-390.png`, `p2-signedout-top-390.png`, `p2-top-after-move-390.png`). Link: https://reel-ballers-staging.pages.dev/shared/collection/8bcb7109-91de-4dda-889f-da26ef8b70b6

## Problem and repro steps

**A. No Download (bug 57).** Open the Top Plays share link in a signed-out phone browser. Only Share, Play, Fullscreen, Close are offered. A single shared highlight (`/shared/<token>`) does have a Download icon. Expected: the reel can be downloaded too (plan step 6.3).

**B. Content changes silently (bug 59, unsure if intended).** Share Top Plays, then finish a new highly-rated highlight: the same link now opens on the new highlight. Moving a highlight to another profile changed it again. Nothing tells the parent the link is live. Expected: either the link shows what was shared, or the share UI says the reel updates.

## Verify the fix (required, before and after)

1. **Before the fix:** open the link signed out at 390 and record the missing Download; for B record the first highlight before and after finishing a new one.
2. **After the fix:** same link: Download works and saves the reel; B behaves as decided and the share UI matches it.

## Acceptance Criteria

- [ ] Download available on a shared reel
- [ ] B decided with the user and implemented; copy matches
- [ ] Before/after recorded; test for the Download control fails before, passes after

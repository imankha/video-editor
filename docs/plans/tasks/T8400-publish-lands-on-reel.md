# T8400: Publishing lands the user on the reel they just made (guided-path R4)

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-02

App design change **R4 from the approved T7620 guided-Help design** (user accepted
2026-09-02; rationale in [T7620-design.md](T7620-design.md) sections 17 and 17.1).
Standalone task per the design's sequencing argument (see T8390's header note).

## Problem

Publishing currently hides the thing the user just made: the flow completes without
landing them on their published reel, so the payoff moment (see it, share it) requires
navigation the user may not find. The guided design had to spend a whole step walking
users to their own reel; R4 deletes that step - the product does the right thing instead
of the guide narrating it.

## Solution

After a successful publish, land the user ON the published reel (the Highlight Reels
surface with the new reel focused/visible, per the T8360-approved IA - published reels
live on the DownloadsPanel). The share affordance should be immediately at hand - this
is where guided fork F8 ("share it now / see what else / make another") fires. Design
doc demotes the old walk-to-your-reel rule 13 to a leave-and-return fallback once this
lands.

## Context

### Relevant Files (anticipated)
- The publish-completion flow (frontend: publish gesture handler + navigation;
  verify against the current export/publish seam - see export-pipeline.md)
- `src/frontend/src/components/DownloadsPanel.jsx` - landing surface (post-T8360 shape:
  Highlights section + published list)
- e2e publish spec

### Related Tasks
- From: [T7620-design.md](T7620-design.md) R4
- Blocks: **T7630** (fork F8 fires on this landing moment)
- Sequencing (T7620-design.md 18.3): R3, R4 -> T8360 -> T8370 -> T8380 -> T7630 -> T7640
- Related: [T8390](T8390-focus-publish-exit.md) (R3, sibling); T8360 (the landing
  surface - in flight, coordinate)

## Acceptance Criteria

- [ ] A successful publish navigates to/reveals the published reel, not a generic screen
- [ ] Share affordance visible at the landing moment
- [ ] No reactive persistence introduced (navigation is part of the publish gesture)
- [ ] Tests pass (unit + publish e2e updated)

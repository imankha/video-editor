# T8400: Publishing lands the user on the reel they just made (guided-path R4)

**Status:** WIP
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

After a successful publish, land the user ON the published reel. Post-**T8555** (SHIPPED)
published reels live on their own dedicated **"Published" tab** (id `published`,
`/home/published`), rendered by **`PublishedReelsPanel.jsx`** (renamed from DownloadsPanel).
T8360's "published reels live on the DownloadsPanel Highlights section" IA is superseded.
The share affordance should be immediately at hand - this is where guided fork F8 ("share
it now / see what else / make another") fires. Design doc demotes the old walk-to-your-reel
rule 13 to a leave-and-return fallback once this lands.

## Context

### Relevant Files (anticipated)
- The publish-completion flow (frontend: publish gesture handler + navigation;
  verify against the current export/publish seam - see export-pipeline.md)
- `src/frontend/src/components/PublishedReelsPanel.jsx` - landing surface (post-T8555:
  published-only content on its own tab; testid `published-tab-panel`)
- `src/frontend/src/components/ProjectManager.jsx` - the publish-landing effect (already
  retargeted to `setActiveTab('published')` by T8555 — see pre-flight note)
- e2e publish spec

### Related Tasks
- From: [T7620-design.md](T7620-design.md) R4
- Blocks: **T7630** (fork F8 fires on this landing moment)
- Sequencing (T7620-design.md 18.3): R3, R4 -> T8360 -> T8370 -> T8380 -> T7630 -> T7640
- Related: [T8390](T8390-focus-publish-exit.md) (R3, sibling, SHIPPED — its one-tap Publish
  lands via `openFinishedReel`); [T8555](first-reel-funnel/T8555-published-tab-and-highlights-multiclip-only.md)
  (the landing surface — SHIPPED, four-tab IA)

## Pre-flight note (2026-09-04, UPDATED after T8390/T8530/T8540/T8555 all shipped)

Filed 2026-09-02. Since then: T8530's shared `usePublishProject` hook + draft preview
player, T8540's Share-primary player action, **T8390's one-tap Publish that lands the user
on the finished reel via `openFinishedReel`**, and **T8555's publish-landing effect which
already fires `setActiveTab('published')`** have ALL shipped. **The gap this task described
may now be substantially or fully closed** — the pieces that would "land the user on the
published reel with share at hand" are largely in place. **Before any design/implementation
work: re-read the current publish gesture + `openFinishedReel` (`utils/finishedReelNav.js`)
+ `PublishedReelsPanel.jsx`/`CollectionPlayer.jsx` flow and the `activeTab === 'published'`
landing, and confirm whether a real gap still exists.** If it's already closed, close this
task with the evidence recorded here rather than building anything. The T8545/T8555 landing
surface has LANDED — no wait remains.

## Acceptance Criteria

- [ ] A successful publish navigates to/reveals the published reel, not a generic screen
- [ ] Share affordance visible at the landing moment
- [ ] No reactive persistence introduced (navigation is part of the publish gesture)
- [ ] Tests pass (unit + publish e2e updated)

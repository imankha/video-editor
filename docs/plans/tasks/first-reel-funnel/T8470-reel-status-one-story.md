# T8470: One status story for a reel (created = visible)

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Created:** 2026-09-03
**Updated:** 2026-09-03

## Problem

In one staging session (2026-09-02 walkthrough) the same freshly created reel was
described three contradictory ways within two minutes:

1. Toast at save: "Reel created!"
2. Home continue card: "Brilliant Goal, 1 clip, Not Started"
3. Highlight Reels drawer: "Highlights 0, No highlights in progress" AND "No reels yet"

The drawer named for reels does not show a reel that exists. This reproduces prod bug
#21 (lisagee: "There's no way to create a reel... There is no point to this website",
filed after she had effectively already made one) and rikusbothainnz's identical silent
exit ten weeks later. Cliff 4: no real user has ever exported a reel.

Also: after saving with the reel switch ON, the Clip Details panel still shows an
actionable "Create Reel" button (stale reelRequested rendering); clicking it flips to a
disabled "Reel Created" with still no link to the reel.

## Solution

- Single status vocabulary, binding per EPIC.md: a reel is **Draft** from the moment of
  creation until shared, then **Shared**. Kill "Not Started", "Ready", "Complete" as
  reel statuses everywhere they render.
- Draft reels appear in the Highlight Reels drawer immediately on creation, visually
  distinguished from Shared ones (build on T8360's split IA). The "Highlights 0" counter
  and the "No reels yet" empty state must count drafts.
- Replace the stale Create Reel button state: the instant a reel exists for a clip, the
  control becomes a link to that reel ("Open reel (Draft)"), never a disabled label.
- Continue card subtitle uses the same Draft/Shared status.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` - continue card, home surfaces
- `src/frontend/src/components/DraftTile.jsx` + `src/frontend/src/utils/draftStage.js` - stage naming ("Not Started" lives here)
- `src/frontend/src/components/DownloadsPanel.jsx` - Highlight Reels drawer, counters, empty states
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` - stale Create Reel / Reel Created button (~line 411)
- `src/frontend/src/containers/AnnotateContainer.jsx` - "Reel created!" toast (~line 924)
- Tests: `DraftTile.test.jsx`, `draftStage.test.js`, `ProjectManager.publishRetry.test.jsx`

### Related Tasks
- Builds on T8360 (drawer split, merged 2026-09-02)
- Reconcile vocabulary with T8130 (Plays/Clips/Highlight Reels) and T8260
- T8480 handles the Focus-unlock half of the same post-save moment

### Technical Notes
draftStage.js is the single source of stage names; change it there, not per-surface.
No new persisted state: Draft/Shared is derivable (published_at NULL or not); do not
store a redundant status column (no-redundant-state rule).

## Implementation

### Steps
1. [ ] Map every surface that renders a reel status string (grep draftStage usages + literals)
2. [ ] Collapse stage names to Draft/Shared in draftStage.js; update consumers + tests
3. [ ] Drawer: include drafts in counts and lists from creation
4. [ ] ClipDetailsEditor: reelRequested renders as a live "Open reel (Draft)" link
5. [ ] e2e: save clip with reel on -> drawer badge increments, draft row visible, no contradictory strings

## Acceptance Criteria

- [ ] Within one session, no two surfaces can describe the same reel with different status words
- [ ] A created draft is visible in the Highlight Reels drawer within one render cycle
- [ ] The stale actionable "Create Reel" button cannot appear once a reel exists
- [ ] Verified at 390x844

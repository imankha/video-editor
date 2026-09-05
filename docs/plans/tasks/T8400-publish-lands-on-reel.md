# T8400: Publishing lands the user on the reel they just made (guided-path R4)

**Status:** STAGING
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

- [x] A successful publish navigates to/reveals the published reel, not a generic screen
- [x] Share affordance visible at the landing moment
- [x] No reactive persistence introduced (navigation is part of the publish gesture)
- [x] Tests pass (unit + publish e2e updated)

## Progress Log

### 2026-09-05 — Re-verified: gap fully closed by shipped code, closing as satisfied (zero product diff)

Per the 2026-09-04 pre-flight note, re-traced every current publish path before
touching code. **All four acceptance criteria are already met by shipped work
(T8390 + T8530 + T8555 + T8540); no product code was written.** This entry is the
evidence, cited file:line.

**Publish paths that exist today:**
1. **Focus one-tap Publish (the R4 primary flow).** `FocusScreen.handlePublish`
   (`screens/FocusScreen.jsx:1105-1123`) stakes the intent + fires the overlay
   render. On completion, `App.jsx handleExportComplete`
   (`src/App.jsx:582-631`) runs the publish gesture (`publishFocusExit`, `:621`)
   then calls `openFinishedReel(finishedProject, { alreadyPublished: published })`
   (`:625`).
2. **In-player Publish** from the draft preview player
   (`DraftReelPreview.jsx:84-99`).
3. **Board shortcut** — DraftTile "Move to My Reels"
   (`DraftTile.jsx:123-126` → `usePublishProject.js:103-105` → `ProjectManager.jsx:996-1001`
   switches to the Published tab, `PublishedReelsPanel.jsx:750` `published-tab-panel`).

**AC1 — lands on the published reel, not a generic screen.**
`openFinishedReel` (`utils/finishedReelNav.js:28-41`) opens the reel snapshot into
`reelPreviewStore`, which `DraftReelPreview` (`DraftReelPreview.jsx:28-36`) renders
as the finished reel inside `CollectionPlayer`. The board shortcut lands on the
dedicated Published tab that displays the freshly published reel
(`ProjectManager.jsx:996-1001`, `PublishedReelsPanel.jsx:706-738,750`). Verified
live: `qa/T8530-criterion-post-publish-share-slot.png` shows the reel player
("QA Draft Reel"), not a generic screen.

**AC2 — Share affordance visible at the landing moment.** Focus's one-tap path
opens the preview already in the published state (`DraftReelPreview.jsx:48`
initializes `published` from `payload.alreadyPublished`), so the primary slot is
Share, not Publish (`:179-182`, `onShare` passed only when `published`). In-player
publish swaps Publish→Share in place with a one-shot attention ring
(`DraftReelPreview.jsx:86-93`). The player Share button is the dominant action
(T8540, `PublishedReelsPanel.jsx:643-666 sharePlayerReel`). Verified live:
`qa/T8530-criterion-post-publish-share-slot.png` shows the prominent Share button
+ "Published — Anyone with the link can watch it." toast at the landing moment.

**AC3 — no reactive persistence.** Navigation is inside the gesture/completion
handlers, never a `useEffect` watching store state: `handleExportComplete`
(`App.jsx:582-631`) is the export-completion callback — both the publish write
(`:621`) and the navigation (`:625`) live in it; `handlePublish`
(`DraftReelPreview.jsx:84-99`) and `usePublishProject.publish`
(`usePublishProject.js:59-118`) are click gestures that open the landing surface
inline (`:103-105`). The one effect involved — `ProjectManager.jsx:996-1001` —
only sets LOCAL tab state and consumes a one-shot gallery-open signal; it writes
nothing to the DB/backend, so it is not the banned reactive-persistence pattern.
This task added zero product code, so nothing new is introduced regardless.

**AC4 — tests pass.**
- Unit: 63 passed — `src/__tests__/appPublishAfterRender.test.js`,
  `components/DraftReelPreview.test.jsx`, `components/DraftTile.test.jsx`,
  `stores/publishIntentStore.test.js`.
- e2e: 8 passed, live-driven in-container via
  `bash scripts/dev-verify.sh e2e/T8520-T8530-overlay-choice-and-publish.spec.js`
  (the publish e2e spec — draft banner → Publish → Share swap, no video reload;
  503 amber retry; responsive). Evidence screenshots saved under `qa/`.

**Conclusion:** close-as-satisfied. The R4 intent ("land the user on the reel they
just made, with Share at hand") is met — and exceeded: the shipped flow lands the
user IN the reel player with Share dominant, rather than merely on the Published
panel scrolled to the new reel as the original design (T7620 §17 R4) proposed.

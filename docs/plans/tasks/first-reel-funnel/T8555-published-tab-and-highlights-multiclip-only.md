# T8555: "Published" becomes its own tab; "Highlights" narrows to multiclip-only work

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-04

## Problem

User-reported bug (2026-09-04), found live on staging: the "Highlights" tab (T8545) shows
**every published reel**, not just multiclip work. Root cause, confirmed against the actual
commits:

- **T8360** (`b5562865`, "split single-clip Clips tab from multi-clip Highlights surface")
  added the in-progress multi-clip "Highlights" section *above* `DownloadsPanel`'s
  pre-existing published-reels list — but that published list was explicitly left
  **unfiltered** ("existing DownloadsPanel content, unchanged" per T8360-design.md §4.2).
  It already contained every published reel, single-clip origin included.
- **T8545** (`8ac78d58`, "Highlight Reels becomes a third peer tab") promoted that
  already-mixed surface from an occasional drawer into a **permanent top-level tab literally
  labeled "Highlights."** That's what made the mislabeling load-bearing: the tab's badge
  (`unseenReelsCount`, `ProjectsScreen.jsx:141`) is defined as "count of NEW published
  reels, not the total" — i.e. it counts the *entire* gallery, single-clip reels included,
  under a tab named Highlights.

Nothing about the actual gallery/published-reels functionality was ever changed by either
commit — it was relabeled as a subset of something it isn't. `is_auto_created` (T8360's
already-established single-vs-multiclip signal) was applied to the **draft** section
correctly (`DownloadsPanel.jsx:78`, `highlightDrafts = projects.filter(p => !p.is_auto_created)`)
but never to the **published** section.

## Solution (user-decided 2026-09-04, supersedes T8545's naming)

Four peer tabs in `ProjectManager.jsx`'s segmented control:

| Tab | Was | Content |
|---|---|---|
| **Games** | Games (unchanged) | unchanged |
| **In Progress Clips** | "Clips" | unchanged content (single-clip in-progress work, `is_auto_created === true`, unpublished) — rename only |
| **In Progress Reels** | "Highlights" | **narrowed**: multiclip in-progress work ONLY (`is_auto_created === false`, unpublished) — today's `highlightDrafts` filter, unchanged. Includes the "Build New Reel" assembly button (today's "Create Highlight Reel" button, T8545) — confirm final button copy in the design pass, since "Highlight Reels" as a term is being retired from the tab bar (see Open question below). **Published content is REMOVED from this tab entirely** — this is the actual bug fix. |
| **Published** (new) | The published section of the old "Highlights"/`DownloadsPanel` (aka "the gallery" internally — `stores/galleryStore.js`) | **Everything published, regardless of single- or multi-clip origin.** Functionally identical to today's published list (`useCollections`/`CardCarousel`/`CollectionsTab` — unchanged behavior), just relocated to its own top-level tab instead of nested under Highlights. This is "basically the gallery on prod" per the user — do not redesign its content or behavior, only its placement/label. |

**Badge/count semantics change:** `unseenReelsCount` (today wired to the Highlights tab
badge) must move to the **Published** tab badge — it was always counting published reels,
so it belongs there now. **In Progress Reels** needs its own count instead, matching the
same pattern **In Progress Clips** already uses (`clipDrafts.length`) — i.e.
`highlightDrafts.length` (already computed in `DownloadsPanel.jsx:78`, just needs wiring to
the tab badge instead of being section-local).

### Open question for the design pass
The user's phrasing named the assembly button "Build New Reel" while describing this task,
which conflicts with T8545's very recently shipped, user-approved "Create Highlight Reel"
label. Unclear whether this is a deliberate further rename (consistent with retiring
"Highlight Reels" terminology from the tab bar entirely) or just casual description. **Do
not silently pick either — confirm with the user during the design pass**, and if renamed,
sweep it the same way T8545 swept "Build Highlight Reel" → "Create Highlight Reel" (button
label, empty-state copy, comments, tests, docs — see T8545's own task file for the exact
site list as a template for how thorough this sweep needs to be).

## Context

### Relevant Files (anticipated — confirm with a Code Expert pass, T8390/T8545 may have
shifted line numbers since filing)
- `src/frontend/src/components/ProjectManager.jsx` — segmented tab bar (currently 3-way,
  `games`/`projects`/`highlights` around L1230-1263), `unseenReelsCount` badge wiring
  (L457/472/475/1260), `clipDrafts`/tab-disabled logic (~L495-499, L953-956)
- `src/frontend/src/components/DownloadsPanel.jsx` — currently renders BOTH the in-progress
  "Highlights" section (`highlightDrafts`, L78) AND the published list inline under one tab
  body (L760-810+); these need to split into two independent tab bodies. Likely decomposes
  into two components (e.g. an in-progress-only panel + a published-only panel) rather than
  one panel with an `active` prop — **this is a real architecture call, not just a filter
  tweak; needs an Architect pass** on how to split `DownloadsPanel`'s internals (it currently
  gates 4 places on a single `isOpen`/`active` prop — T8545's own implementation note flags
  this) without duplicating the published-list rendering logic.
- `src/frontend/src/stores/galleryStore.js`, `src/frontend/src/hooks/useCollections.js` —
  published-reels state; confirm neither has any implicit "must be inside Highlights tab"
  assumption before moving it to a new top-level tab context.
- `src/frontend/src/screens/ProjectsScreen.jsx` — `unseenReelsCount` source (L139-141,
  "My Reels badge"), needs re-wiring to the new Published tab.
- `src/frontend/src/config/displayNames.js` — `SECTION_NAMES.HIGHLIGHTS`, `.CLIPS`,
  `.LIBRARY` — all three need new/renamed entries for the four tab labels.
- `src/frontend/src/config/themeColors.js` — `HIGHLIGHT` token exists (T8545); decide
  whether Published needs its own token or reuses one (four tabs, three color tokens today:
  `GAME`, `REEL`/Clips, `HIGHLIGHT`).
- `src/frontend/src/utils/finishedReelNav.js` (`openFinishedReel`, touched by T8390) — opens
  a fullscreen preview overlay via `goToProjectManager()` + `reelPreviewStore`; does NOT
  itself set `activeTab`. Confirm what tab is visible underneath once the preview closes
  post-publish (today: whatever was active before export, likely wrong under the new IA) —
  this is exactly [T8400](../T8400-publish-lands-on-reel.md)'s scope, not this task's, but
  T8400 needs designing against the FOUR-tab structure, not the current three-tab one.
- e2e locator sweep: expect a blast radius at least as large as T8545's (37 files) since
  this touches 3 of 4 tabs simultaneously plus the published-list relocation. Grep every
  `activeTab === 'highlights'` / `'highlights'` / drawer-open call site, plus every e2e spec
  asserting "Highlights" tab text or DownloadsPanel's published-section location.

### Related Tasks
- Fixes a regression introduced across [T8360](../T8360-split-single-vs-multiclip-drafts.md)
  (STAGING, merged 2026-09-02) and [T8545](T8545-highlight-reels-third-tab-and-rename.md)
  (STAGING, merged 2026-09-04) — **supersedes T8545's "Highlights"/"Highlight Reels"
  terminology** in the tab bar (the published-vs-draft distinction is now tab-level:
  In Progress Reels vs Published, not a naming pair within one tab).
- [T8390](../T8390-focus-publish-exit.md) (pushed, PR #329, held for user test) lands the
  user on the finished reel via `openFinishedReel` — re-verify its landing/close behavior
  once this task's four-tab structure ships.
- [T8400](../T8400-publish-lands-on-reel.md) (TODO, held) is entirely about *where* publish
  lands the user — must be designed against this task's four-tab structure, not the current
  one. Sequence T8400 after this task, or design them together.
- [T8550](T8550-mobile-cta-visibility-sweep.md) (TODO, held) audits CTA visibility including
  "the Export-complete choice" and "Ready board tile" rows — its matrix will need updating
  for whichever tab each surface now lives under. Already held per its own "runs LAST,
  post-change" framing; this task is part of what it should run after.
- [T8380](../T8380-clips-screen-add-video.md) (TODO) reworks the Clips tab's
  `clipsTabDisabled` empty-state guard — coordinate naming ("In Progress Clips") and confirm
  it doesn't collide with whatever empty-state this task defines for the same tab.
- [T8470](T8470-reel-status-one-story.md) (STAGING, merged) — drafts visible in "the
  Highlight Reels drawer from creation" per its own filing language; grep its shipped diff
  for any hardcoded "Highlights" tab references that need updating to "In Progress Reels".

### Technical Notes
- **ui-designer pass required** — four-tab segmented control at 320px is a harder layout
  problem than T8545's three-tab one (which already needed stacked icon-over-label to fit
  three); do not guess the visual spec.
- **Architect pass required** — splitting `DownloadsPanel`'s internals (today: one component
  gating 4 places on `active`, rendering both in-progress and published content) into two
  independently-tabbed surfaces is a real decomposition decision, not a filter tweak.
- Doc-code-consistency rule (coding-standards.md): rename ships in ONE commit across code +
  every doc/task file that quotes "Highlights"/"Highlight Reels" as the tab name (follow
  T8545's own Relevant-Files list as the template for what needs sweeping — PLAN.md,
  EPIC.md files, T7620-design.md, T8130's naming table, `.claude/knowledge/annotate.md`,
  etc.).
- Gesture-based persistence: `activeTab` stays local UI state, not persisted (no-persisted-
  view-state rule, unchanged from T8545).
- Greppability: after the rename, confirm zero remaining code/doc references to a
  "Highlights" or "Highlight Reels" *tab* (the underlying concept of "reels made from
  multiple clips" as a filter/signal, `is_auto_created`, is unaffected and keeps its name).

## Acceptance Criteria

- [ ] Four peer tabs render: Games / In Progress Clips / In Progress Reels / Published
- [ ] In Progress Reels shows ONLY unpublished multiclip drafts (`is_auto_created === false`)
      — zero published reels visible there, regardless of origin
- [ ] Published shows every published reel regardless of single- or multi-clip origin,
      functionally identical to today's gallery/DownloadsPanel published list (same
      behavior, new location)
- [ ] Badge counts: In Progress Reels shows in-progress-multiclip count; Published shows
      unseen-published count (today's `unseenReelsCount`, relocated)
- [ ] Assembly button ("Build New Reel" vs "Create Highlight Reel") copy confirmed with the
      user during the design pass, not assumed either way
- [ ] ui-designer spec approved (4-tab layout, 320px) before implementation
- [ ] Architect spec approved (DownloadsPanel decomposition) before implementation
- [ ] Every doc/task file referencing the old "Highlights"/"Highlight Reels" tab naming is
      updated in the same commit as the code change
- [ ] Tests pass (unit + e2e, including new four-tab navigation coverage); e2e locator sweep
      confirmed complete via repo-wide grep, not assumed from the file list above

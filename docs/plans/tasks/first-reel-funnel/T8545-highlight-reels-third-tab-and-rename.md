# T8545: Highlight Reels becomes a third peer tab + rename "Build" → "Create Highlight Reel"

**Status:** WIP
**Impact:** 6
**Complexity:** 5
**Created:** 2026-09-03

## Problem

Filed from a Project Manager agent gap-check (2026-09-03, user directive) that resolved
two open threads at once:

1. **T8360's own still-open IA question** ("two tabs, one tab with two sections, or a
   filter within one list?") is answered by user decision: **a third tab.** Today
   `ProjectManager.jsx`'s segmented tab bar has exactly two peers, Games and Clips
   (`activeTab === 'games' | 'projects'`, ~L1194-1236); "Highlight Reels" is a separate
   top-right icon button (`onOpenDownloads`, ~L1064-1082) that opens `DownloadsPanel` as
   a drawer — not a peer tab. The user wants Highlight Reels promoted to a true third
   segmented-control tab alongside Games and Clips, replacing the icon-button/drawer
   entry point.
2. **Naming conflict, resolved by user decision:** rename the assembly button
   **everywhere** from "Build Highlight Reel" (T8130's user-approved 2026-08-31 naming
   table — the authoritative source) to **"Create Highlight Reel."** This is a rename of
   already-shipped, user-approved vocabulary, not a fresh naming choice — every doc/code
   site that quotes "Build Highlight Reel" must be updated in the SAME commit as the code
   change (doc-code-consistency rule, coding-standards.md).

Bundled into one task (not two) because both changes land in the same UI region (the tab
bar + the Highlight Reels surface) and would otherwise produce two small PRs fighting
over the same files (`ProjectManager.jsx`, `DownloadsPanel.jsx`).

## Solution

### Part A — Third peer tab
Restructure `ProjectManager.jsx`'s segmented tab bar from two entries (`games`, `projects`)
to three (`games`, `projects`, `highlights`), rendering `DownloadsPanel`'s content inline
under the `highlights` tab instead of as a drawer opened via the top-right icon button.
Needs a **ui-designer pass first** — no mockup exists yet for a 3-way segmented control at
320px (the existing 2-way bar's per-tab padding/label/count-badge pattern may not fit three
without redesign; see `GAME`/`REEL` color-token usage at ~L1196-1235 for the visual
language to extend, plus a new token for the Highlights tab).

Scope:
- Three-way segmented control (Games / Clips / Highlight Reels), same visual language
  (icon + label + count badge) as the existing two tabs.
- Remove the top-right `onOpenDownloads` icon button and its `unseenReelsCount` badge
  (~L1064-1082); the "new" count moves to the Highlights tab badge instead.
- Deep-link paths: anything that currently calls `onOpenDownloads` / opens the drawer
  programmatically (T8400's "land the user ON the published reel" per T8360's IA, T8470's
  "drafts visible in the Highlight Reels drawer from creation") must instead set
  `activeTab = 'highlights'` — grep both tasks' shipped diffs for the drawer-open call
  sites before assuming inline-`DownloadsPanel` behaves identically.
- Tab-disabled logic: `projects` tab has a `clipsTabDisabled` guard (~L1216-1217, "Extract
  clips from a game first"); decide whether `highlights` needs an analogous
  zero-content-disabled state or is always enabled (T8380 is separately reworking
  `clipsTabDisabled` for the zero-content-account case — coordinate, do not collide).
- `DownloadsPanel.jsx` currently renders as a standalone drawer component (props like
  `onOpenAssembly`); confirm it can render inline under a tab body without a drawer chrome
  (header/close button) it no longer needs.

### Part B — Rename "Build Highlight Reel" → "Create Highlight Reel"
Update every site quoting the old name, in the same commit as Part A (they touch the same
files):

- **Authoritative source:** T8130's naming table (`docs/plans/tasks/first-clip-funnel/T8130-annotate-primary-cta-and-naming.md`)
  — update the table row AND the "user-approved 2026-08-31" language to record the rename
  and its date.
- **Shipped code (the actual button label + empty-state copy):**
  `src/frontend/src/components/DownloadsPanel.jsx:782` (button text), `:795` (empty-state
  "Tap Build Highlight Reel to assemble one."), `:61` (comment), `:769` (comment).
- **Other code comments referencing the old name:**
  `src/frontend/src/components/ProjectManager.jsx:418, 1239, 1696`,
  `src/frontend/src/screens/ProjectsScreen.jsx:148`.
- **Tests asserting the old string:** `src/frontend/src/components/ProjectManager.homeTabDefaults.test.jsx`,
  `src/frontend/e2e/regression-tests.spec.js`, `src/frontend/e2e/new-user-flow.spec.js`,
  `src/frontend/e2e/T8360-clips-highlights-split.qa.spec.js`.
- **Task/doc files that quote it:** `docs/plans/PLAN.md` (this table's own T8130 row + any
  other row quoting the name), `docs/plans/tasks/first-clip-funnel/EPIC.md`,
  `docs/plans/tasks/T8360-design.md`, `docs/plans/tasks/T7620-design.md`,
  `docs/plans/tasks/first-reel-funnel/T8550-mobile-cta-visibility-sweep.md`,
  `docs/plans/tasks/T8380-clips-screen-add-video.md`,
  `docs/plans/tasks/tutorial-redesign/EPIC.md`, `.claude/knowledge/annotate.md`.
- After the sweep, grep the whole repo for `Build Highlight Reel` and confirm zero
  matches (case-sensitive; check for lowercase/variable-name variants too).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` — segmented tab bar (~L1194-1236),
  top-right `onOpenDownloads` button (~L1064-1082), `clipsTabDisabled` guard, comments at
  L418/1239/1696
- `src/frontend/src/components/DownloadsPanel.jsx` — the Highlight Reels surface (currently
  a drawer), button label L782, empty-state copy L795, comments L61/769
- `src/frontend/src/screens/ProjectsScreen.jsx` — comment L148
- `src/frontend/src/config/displayNames.js` — tab label tokens (extend for the third tab;
  the button string itself is NOT here today — near-use in `DownloadsPanel.jsx`, confirm
  whether to consolidate into `displayNames.js` now that it's being touched anyway)
- `src/frontend/src/components/ProjectManager.homeTabDefaults.test.jsx`,
  `src/frontend/e2e/regression-tests.spec.js`, `src/frontend/e2e/new-user-flow.spec.js`,
  `src/frontend/e2e/T8360-clips-highlights-split.qa.spec.js` — string assertions to update
- Docs: `docs/plans/PLAN.md`, `docs/plans/tasks/first-clip-funnel/T8130-annotate-primary-cta-and-naming.md`,
  `docs/plans/tasks/first-clip-funnel/EPIC.md`, `docs/plans/tasks/T8360-design.md`,
  `docs/plans/tasks/T7620-design.md`, `docs/plans/tasks/first-reel-funnel/T8550-mobile-cta-visibility-sweep.md`,
  `docs/plans/tasks/T8380-clips-screen-add-video.md`, `docs/plans/tasks/tutorial-redesign/EPIC.md`,
  `.claude/knowledge/annotate.md`

### Related Tasks
- Resolves the open IA question in [T8360](../T8360-split-single-vs-multiclip-drafts.md)
  (split single-vs-multiclip drafts; STAGING, merged 2026-09-02) — this task answers "two
  tabs, one tab with two sections, or a filter" with "a third tab."
- Renames the button T8130 approved: [T8130](../first-clip-funnel/T8130-annotate-primary-cta-and-naming.md)
  is the authoritative naming table and must be updated in the same commit.
- Epic: [First Reel Funnel](EPIC.md) — this row.
- Coordinate, do not collide: [T8400](../T8400-publish-lands-on-reel.md) (lands the user on
  DownloadsPanel per T8360's IA — its landing target becomes the Highlights tab, not a
  drawer open), [T8470](T8470-reel-status-one-story.md) (drafts visible in the "Highlight
  Reels drawer" from creation — same surface, same rename applies), [T8380](../T8380-clips-screen-add-video.md)
  (separately reworking `clipsTabDisabled` — do not fight over the same guard),
  [T7620](../tutorial-redesign/T7620-guided-tour-design.md) design (guided-path step copy
  uses T8130 vocabulary — must pick up the renamed string).
- Should land **before** [T8550](T8550-mobile-cta-visibility-sweep.md) (mobile CTA
  visibility sweep — explicitly "runs LAST, audits the epic's own surfaces post-change");
  the new 3-way tab bar is exactly the kind of surface that sweep needs to audit, so this
  task must ship first. Placed at T8545, between T8540 and T8550, for that reason.

### Technical Notes
- **ui-designer pass required** for Part A (see Solution) — no mockup exists for the 3-way
  tab bar at 320px; do not guess the visual spec.
- Doc-code-consistency rule (coding-standards.md): the rename ships in ONE commit across
  code + every doc/task file listed above — never rename in code while docs still quote
  the old name.
- Gesture-based persistence: which tab is active is ephemeral UI state (no-persisted-view-state
  rule already governs tabs) — `activeTab` stays local state, not written to DB/store.
- Greppability: after the rename, `grep -r "Build Highlight Reel"` across the repo must
  return zero hits.

## Implementation

### Steps
1. [ ] ui-designer pass: 3-way segmented control spec (placement, labels, badges, 320px
       behavior), plus confirm the Highlights tab's disabled/empty state
2. [ ] `ProjectManager.jsx`: add `highlights` tab, remove top-right icon button, wire
       `DownloadsPanel` inline under the tab body
3. [ ] Update deep-link call sites (T8400/T8470 landing paths) to set `activeTab =
       'highlights'` instead of opening the drawer
4. [ ] Rename sweep: code (`DownloadsPanel.jsx`, `ProjectManager.jsx`, `ProjectsScreen.jsx`)
       + tests + docs/task files, per the Relevant Files list
5. [ ] Repo-wide grep confirms zero remaining "Build Highlight Reel" occurrences
6. [ ] Tests: update string assertions in the 4 listed test/e2e files; new e2e for
       three-tab navigation + deep-link landing on the Highlights tab

## Acceptance Criteria

- [ ] Games / Clips / Highlight Reels render as three peer tabs in one segmented control;
      the top-right icon-button/drawer entry point is gone
- [ ] T8400's publish-landing and T8470's draft-visibility deep links land on the
      Highlights tab correctly (not a dead drawer-open call)
- [ ] Every UI string and doc/task file says "Create Highlight Reel"; zero repo-wide
      matches for "Build Highlight Reel"
- [ ] T8130's naming table reflects the rename as the authoritative record
- [ ] ui-designer spec approved before implementation
- [ ] Tests pass (unit + e2e, including new three-tab navigation coverage)

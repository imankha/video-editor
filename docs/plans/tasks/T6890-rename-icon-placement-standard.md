# T6890: Rename icons should sit next to the name they rename (standardize the pattern)

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-08-12
**Updated:** 2026-08-12

## Problem

The rename pencil icon on a draft reel tile (`DraftTile.jsx`) sits in the tile's top-right
hover-action rail — stacked with Preview/Crop/Layers/Hide/Delete — while the reel's name
renders separately in the bottom scrim. Nothing visually ties the pencil to the name it
edits, so users don't know what it does without hovering to read the tooltip. User report
2026-08-12 (screenshot of the action rail).

This isn't unique to draft reels: a repo-wide check found the same disconnect on game tiles
and reel tiles (both kebab-menu-based, softened by a text label but still opened from a
corner away from the name), while two OTHER surfaces already get this right — the pencil
sits directly beside/inside the name field. There's no shared component enforcing either
pattern, so it drifted per-surface.

## Solution

1. **Primary fix — `DraftTile.jsx`**: move (or add) a rename affordance next to the reel name
   in the bottom scrim, instead of (or in addition to) the top-right action-rail icon. Follow
   the already-correct reference patterns in the codebase (see Relevant Files) rather than
   inventing a new layout.
2. **Standardize**: apply the same "icon touches the name" placement to the other rename
   affordances found in the sweep (`ReelTile.jsx`, `GameTile.jsx`) so the pattern is
   consistent app-wide, not just fixed on one tile type.
3. **Decide on extraction**: given 4+ surfaces reimplement local rename state independently
   (no shared `InlineRename`/`EditableLabel` component exists today), decide whether this
   task also extracts a shared component or just aligns positioning per-surface using the
   existing per-surface state. Default to positioning-only first pass unless the duplication
   makes the fix harder than the extraction — this is a judgment call for whoever implements,
   not pre-decided here.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/DraftTile.jsx:608` — the reported pencil, in the hover-action
  rail (`absolute top-9 right-1.5`, ~line 604), stacked with Preview/Crop/Layers/Hide/Delete.
  Reel name renders separately in the bottom scrim (`<h3>{getProjectDisplayName(project)}</h3>`,
  ~lines 551-569, `absolute inset-x-0 bottom-0`). Also has a text-labeled "Rename" kebab-menu
  entry (~lines 416-419, "ready to publish" state only) — that one already has a label, not
  in scope.
  Rename state: `renameValue`/`isRenaming` (~lines 80-93, 189-216).
- `src/frontend/src/components/collections/ReelTile.jsx:336,402` — "Rename" inside kebab
  dropdown menus (mobile sheet + desktop popover), text-labeled but opened from a
  `top-1.5 right-1.5` kebab, away from the name in the bottom scrim. Rename state ~lines
  92-164.
- `src/frontend/src/components/GameTile.jsx:153` — `{ key: 'edit', label: 'Edit game', icon:
  Pencil, ... }` inside the tile's kebab `menuItems` (~line 161); kebab top-right, name in
  bottom scrim (~lines 238-240).
- **Reference patterns — already correct, copy the approach, don't reinvent:**
  - `src/frontend/src/components/ManageProfilesModal.jsx:381` — `<Pencil size={14} />` in a
    per-row Actions cluster immediately adjacent to the profile name in the same row
    (~lines 354-358).
  - `src/frontend/src/components/introcards/IntroCardEditorContainer.jsx:~200-239`
    (`CardNameInput`) — Pencil rendered directly inside the `<label>` wrapping the editable
    name `<input>` (~lines 226-236) — the icon literally touches the input it edits. Best
    reference; there's an explanatory comment at ~lines 195-198 on why.
- No shared rename component exists (`InlineRename`/`EditableLabel`/`InlineEdit`/
  `EditableName`/`RenameInput` — zero matches repo-wide). Each surface reimplements its own
  local rename input/state.

### Related Tasks
None directly — this is a fresh UX-consistency finding, not a follow-up to an existing epic.

### Technical Notes
- `IntroCardTile.jsx:36-39` also has a Pencil below the card, separate from the name in the
  scrim — but it opens a full editor rather than doing inline rename, so it's a different
  interaction class; note it during implementation but it's not necessarily in scope for a
  same-surface fix (judgment call).
- Keep tooltips/aria-labels (existing `title="Rename reel"` etc.) — positioning fix, not a
  copy fix.
- Mobile/coarse-pointer hit-target size matters if the icon moves into the bottom scrim,
  which is already a denser area (name + possibly other affordances) — check for crowding at
  375px.

## Implementation

### Steps
1. [ ] Reposition `DraftTile.jsx`'s rename pencil next to the name (bottom scrim), matching
       the `IntroCardEditorContainer.jsx` / `ManageProfilesModal.jsx` reference pattern
2. [ ] Apply the same repositioning to `ReelTile.jsx` and `GameTile.jsx`
3. [ ] Decide extraction vs. per-surface fix (see Solution §3); document the call briefly in
       the Progress Log either way
4. [ ] Responsive check: no crowding/overflow at 375px on all three tile types
5. [ ] Tests: existing rename-flow tests still pass; add/adjust any test asserting icon
       position or DOM structure
6. [ ] Lint + relevant test set green

### Progress Log

**2026-08-12**: Filed from user report (screenshot of DraftTile's action rail) + a repo-wide
sweep for the same pattern, done at filing time.

## Acceptance Criteria

- [ ] Draft reel tile's rename icon sits next to (or touching) the reel's displayed name, not
      grouped with unrelated action icons
- [ ] Reel tile and game tile rename affordances follow the same "next to the name" placement
- [ ] No regression to existing rename functionality (works exactly as before, just
      repositioned)
- [ ] No layout crowding/overflow introduced at 375px
- [ ] Tests pass

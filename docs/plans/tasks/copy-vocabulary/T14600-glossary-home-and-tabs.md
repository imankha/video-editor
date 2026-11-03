# T14600: Glossary reference + Home and tabs

**Status:** TODO
**Impact:** 8
**Complexity:** 4
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

The Home screen is where the vocabulary first breaks. On one screen the tab says **Clips**,
the heading says **Highlights in progress**, the button says **Upload highlight** (it uploads a
raw video), and the guide says "Tap a **clip** to finish its **highlight**", all about the play
the parent just marked. Tile menus add "Open as Draft", "Hide from Drafts", "Re-edit this
highlight", "Open in Spotlight", "Open in Framing", and "Contains 3 highlights" next to "2 plays
changed since this highlight was made".

Task 1 of 8 in the [Copy Vocabulary epic](EPIC.md). Read EPIC.md for the glossary, verbs and
style rules; they are not repeated here.

## Solution

1. **Glossary reference:** create `.claude/references/copy-glossary.md` from the EPIC.md
   glossary, verbs and style rules (the durable home once the epic is done). Link it from
   `.claude/references/ui-style-guide.md` and `src/frontend/CLAUDE.md`. Update the top-of-file
   comment in `displayNames.js` that declares the object model.
2. **Tabs:** labels **Games / Plays / Highlights** (`SECTION_NAMES`, `SECTION_NAMES_SHORT`).
   Tab ids and URLs stay frozen.
3. **Plays tab:** heading "Plays you're turning into highlights"; button "Upload a play";
   empty states and guide lines use play / highlight per the glossary (e.g. "Pick up where you
   left off. Tap a play to make its highlight.", "Every play is finished. Open a game to mark more plays.").
4. **Tile menus and badges:** "Edit highlight" replaces Open as Draft / Re-edit / Open in
   Framing / Open in Spotlight where they reopen a finished highlight; "Move to Highlights"
   replaces "Hide from Drafts"; counts say plays; "Tap again to confirm" everywhere; statuses
   Not started / In progress / Finished from the single status map (fix the hardcoded
   "Highlight made, not finished yet" in `NotesOverlay.jsx`).
5. **Highlights tab:** loading, empty and error states say highlight / highlight reel; retire
   "content", "mixes", "Top Plays", "smart" in visible copy.
6. Apply the style rules to every string touched.

## Context

### Relevant Files
- `src/frontend/src/config/displayNames.js` (SECTION_NAMES, SECTION_NAMES_SHORT, LIBRARY_ACTIONS, CLIP_UPLOAD, GUIDE.clips*, RESULT_SURFACE)
- `src/frontend/src/config/emptyStates.js`
- `src/frontend/src/components/ProjectManager.jsx` (tab bar, group labels "Other highlights" / "Legacy highlights", legacy notice with "re-edited in Focus")
- `src/frontend/src/components/DraftTile.jsx`, `GameTile.jsx`, `collections/ReelTile.jsx`, `collections/CollectionPlayer.jsx`, `collections/CollectionsTab.jsx`, `collections/LockedReasonModal.jsx`, `collections/RatioUnlockGroup.jsx`, `collections/SmartLockedCard.jsx`, `JustPublishedCard.jsx`, `EmptyTabGuide.jsx`
- `src/frontend/src/modes/annotate/components/NotesOverlay.jsx`
- New: `.claude/references/copy-glossary.md`

Findings with lines: [audit/A-catalog.md](audit/A-catalog.md) A1-A8, D23-D27, I72; [audit/B-components-AL.md](audit/B-components-AL.md) 1-7, 21-27, 103-118; [audit/C-components-MZ.md](audit/C-components-MZ.md) 4, 22-26; [audit/F-gapfill.md](audit/F-gapfill.md) F2, F6, F13-F15.

### Technical Notes
- Many unit and e2e tests select by visible text ("Clips", "Finished"). Update them in the same change; grep `src/frontend/e2e` too (CLAUDE.md refactoring rule 7).
- Code identifiers (`ReelTile`, `projects`, `PUBLISHED`) keep their names; only visible strings change.
- After this task, update the saved memory note about vocabulary if it still says "clip" (the main session already updated it on 2026-11-03; verify).

## Implementation

1. [ ] Write `.claude/references/copy-glossary.md` and link it
2. [ ] Failing tests: tab labels, Plays tab heading/button/guide, tile menu labels
3. [ ] Change the strings; move inline strings to displayNames
4. [ ] Update unit + e2e text selectors
5. [ ] Relevant tests + explicit lint; phone + desktop screenshot of Home (all three tabs)

## Acceptance Criteria

- [ ] Home reads Games / Plays / Highlights at every width
- [ ] No "clip", "draft", "Drafts", "Finished" (as a tab name) or "content/mixes" in Home copy
- [ ] Glossary reference exists and is linked from the UI style guide
- [ ] Tests pass

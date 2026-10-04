# T11850: Rename "Annotate" to "Mark Plays" in the UI

**Status:** TODO (H3 ruled "Mark Plays", 2026-10-04)
**Impact:** 5
**Complexity:** 2
**Tier:** M (copy sweep; frontend only, ~8 files + tests)
**Created:** 2026-10-04
**Decision gate:** H3 (recommended option C: tab "Mark Plays", cards "N plays") **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 2 of 3 in [Epic D](EPIC.md). Runs after T11740 (two-row header; check the label fits there)
and before the guided tour (T7630/T7640) anchors on the label. Milestone rules:
[README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [iphone/05](../../../ux/2026-10-04-parent-usability-audit/iphone/05-annotate-overflow-jargon-status.png),
[iphone/06](../../../ux/2026-10-04-parent-usability-audit/iphone/06-new-game-card-clipped-and-annotations-jargon.png).
The step is called "Annotate", the button inside it says "Mark play", and game cards say "6 annotations".
A parent cannot tell whether an annotation is a note, a play or a highlight.

## Solution

| Where | Old | New |
|-------|-----|-----|
| Mode bar tab (`MODE_SWITCHER_NAMES`, `MODE_NAMES`) | Annotate | Mark Plays |
| Game card count (`components/GameTile.jsx:76-80`) | 6 annotations · 2 published | 6 plays · 2 published (second half follows S2) |
| Failed-upload line (`GameTile.jsx:336`) | N annotations saved — Retry... | set by T11790 |
| Continue card (`ProjectManager.jsx:1430`) | 1 annotation | 1 play |
| Game menu (`GameTile.jsx:186`) | Watch annotations | Watch plays |
| ModeSwitcher help | (Annotate copy) | Mark Plays: press Mark play right after a great moment. |

Singular/plural: "1 play", "N plays". All three tabs now read verb + object: Mark Plays / Frame
Highlight / Add Spotlight. "Mark Plays" is 10 characters and fits the two-row 390px tab (T11740) and
the `md`+ single row.

Do **not** rename `/annotate`, `EDITOR_MODES.ANNOTATE`, component/file names, store keys, analytics
names or knowledge-doc names.

## Implementation Steps

1. Change the display values in `config/displayNames.js` (`MODE_NAMES`, `MODE_SWITCHER_NAMES`, and add
   a `GAME_CARD.PLAYS_COUNT(n)` helper).
2. Replace the literals in `GameTile.jsx` and `ProjectManager.jsx` with the helper.
3. Grep `src/frontend/src` for user-visible `Annotate`/`annotation` in JSX text, aria-labels, titles,
   toasts, quest/guide copy and empty states; convert each to the new words via `displayNames.js`.
4. Grep `src/frontend/e2e` for text selectors on "Annotate"/"annotation" and update them.

## Acceptance Criteria

1. Mode bar reads "Mark Plays / Frame Highlight / Add Spotlight" at 320, 390, 768, 1440.
2. No game card, menu or continue card says "annotation".
3. `git diff` changes no route, store key, analytics event or file name.

## Tests

- `components/__tests__/GameTile.test.jsx:295-357` (pins "N annotations"), `ModeSwitcher.test.jsx:51`,
  `ProjectManager` continue-card tests, any test matching `/annotation/i`.
- E2E (local): `e2e/T5681-games-poster-grid.spec.js:115` (`/annotation/i`) and any spec clicking the
  tab by name.

## Landmines

- Round 2 ruling 6 (2026-09-24) listed the bar as "Annotate / Frame Highlight / Add Spotlight". Add a
  dated note to `docs/plans/tasks/highlight-first/EPIC.md` recording the H3 ruling.
- If H3 = option B (noun only), change only the game-card/menu/continue-card nouns and keep the tab.

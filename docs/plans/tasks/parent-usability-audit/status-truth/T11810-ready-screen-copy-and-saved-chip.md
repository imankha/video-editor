# T11810: Ready-screen copy and no "Saved" chip

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Tier:** M (frontend copy, `displayNames.js` + 2 action bars + tests, ~60 LOC)
**Created:** 2026-10-04
**Decision gate:** S4 (recommended D2), S5 (recommended: remove the chip). Wording of the
secondary tile depends on S2. **Ruled 2026-10-04: D2, remove the chip, S2 = Finish.**

## Epic Context

Task 3 of 5 in [Epic C](EPIC.md). Milestone rules: [README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [desktop/06](../../../ux/2026-10-04-parent-usability-audit/desktop/06-highlight-ready-next-step-choices.png).
"Publish without spotlight" with the caption "Nobody else can see this until you share a link" makes
"publish" sound like "make public" and then takes it back. A "Saved" chip breaks the standing rule
that persistence is silent.

## Solution (D2)

Focus ready screen (`FOCUS_PUBLISH` in `displayNames.js:501-510`, rendered by
`components/FocusPublishActionBar.jsx`). Layout unchanged (T10670 V2: three tiles in a row at 1024+,
stacked at 390).

| Slot | Label | Caption |
|------|-------|---------|
| Headline | Your highlight is ready | |
| Primary (Sparkles) | Add spotlight | Show everyone watching which player is yours. |
| Secondary | **If S2 = Finish:** Finish without spotlight | Moves it to Finished. Only you can see it until you share a link. |
| Secondary | **If S2 = keep Publish:** Publish without spotlight | Moves it to your Published tab. Private until you share a link. |
| Tertiary (Pencil) | Edit framing | Change the framing and generate again. Uses credits. |
| Exit | Done for now | (button styling is in T11800) |

Overlay ready screen (`OVERLAY_PUBLISH`, `displayNames.js:603-612`), changed in lockstep:
primary **Finish** (or **Publish**) with the same caption as the secondary above; **Redo spotlight** /
"Go back and change the spotlight." (replaces "Reapply spotlight"); **Edit framing** / "Change the
framing and generate again. Uses credits." (replaces "Reapply Framing").

**S5:** delete the "Saved" / "Saved. Link unchanged" chip (`RESULT_RETENTION`, `displayNames.js:621-629`)
and its render site. The headline carries the moment.

## Relevant Files (under `src/frontend/src/`)

- `config/displayNames.js:185` (`STAGE_REASONS.PUBLISH`), `:501-510`, `:603-612`, `:621-629`
- `components/FocusPublishActionBar.jsx`, the Overlay sibling action bar, and wherever
  `RESULT_RETENTION` renders (grep it).

## Implementation Steps

1. Update the strings. Keep the tile order and DOM structure (tests pin hierarchy).
2. Remove the `RESULT_RETENTION` chip and its now-unused keys.
3. Grep the changed files for em dashes and for "Save"/"Saved" in user-visible text.

## Acceptance Criteria

1. Focus and Overlay ready screens show the new labels and captions; Focus and Overlay match.
2. No "Saved" text on either ready screen.
3. Every caption names the audience or the cost; none claims automatic tracking.

## Tests (red first)

- `FocusPublishActionBar.test.jsx:37,145,157` and `OverlayPublishActionBar.test.jsx:40-42,118`:
  update expected names; add an assertion that no element contains "Saved".

## Landmines

- "Published" is also a tab name. If S2 = Finish, the tab rename is T11820; this task only sets the
  ready-screen words so the two tasks can merge in order.
- Record in `docs/plans/tasks/clip-ready-screen/` (T10670) that S4/S5 changed its approved copy on 2026-10-04.

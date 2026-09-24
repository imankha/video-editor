# T11100: UX design gate - badges, Done popup, rating gate, mode bar

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 2
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

T11120-T11140 change the Annotate play editor's shape: the rating becomes required, the clip
badge's "Create clip" nudge disappears, and a popup replaces the Frame Now / Frame Later row.
The existing named / rated / noted / clip badge row (`PlayProgressBadges.jsx`) was designed
around the old optional-rating + nudge model and has to be redesigned before implementation.

## Solution

ui-designer produced a mockup artifact with labelled options; the user picks one per section.
The picks become binding inputs for T11130 (badges, popup), T11120 (gate), T11140 (mode bar).

Round 2 (owner feedback 2026-09-24) reshaped the sections:

| Section | Options | What it decides |
|---|---|---|
| A | A1 / A2 | Editor layout in the owner's hierarchy: (1) start/end time, (2) Name + Rating, (3) Details = tags + notes. States: unrated / 1-4 / Highlight / already a highlight. Placement of Play category + sport (H16) |
| B | B1 / B2 | Highlight popup: Make Highlight Now / Highlight Later, gold, no teaching line; the toast "Highlight moved to clips so you can edit it later" |
| C | (one design) | The "Rate this play" modal on an unrated Done: 5 rows, stars + adjective + one-line meaning. Replaces round 1's C1/C2 "Required" styles (owner: no "required" wording) |
| D | D | Mode bar in 3 states, gold where it means highlight, locked-tab copy without "clip" |
| Palette | proposal | Gold for rating 5 and a recolor for rating 2 (Amber Yellow collides with gold), H15 |

Copy constraints: no em dashes; no user-visible "clip" except the Highlight Later toast; no
"Required" label; never claim the AI frames or tracks automatically (user frames, AI upscales
and finds players); never close a modal on backdrop click.

## Context

### Relevant Files
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` - current badge row
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` - play editor (5 layouts)
- `src/frontend/src/modes/AnnotateModeView.jsx` - Frame Now / Frame Later row (T10450)
- `src/frontend/src/components/shared/ModeSwitcher.jsx` - mode bar
- `src/frontend/src/config/displayNames.js` - all copy

### Related Tasks
- Blocks: T11120, T11130, T11140
- Artifacts: mockups + decision artifact (links recorded in the Progress Log)

## Progress Log

**2026-09-24**: Filed. Mockups: https://claude.ai/artifact/FFGqtZQnE4a9n9PHjANaeA (ui-designer
recommends A1, B2, C1, D as shown). Decision artifact (answers stored in its `answers` db
collection, one doc per question id): https://claude.ai/artifact/CWHnjGEUCzqMhgeyQGrzwB, covering
H1-H14 (H12 split into H12A-D) and R1-R12.

**2026-09-24 (round 2)**: Owner feedback: no "required" wording (modal on unrated Done with
details per rating), gold for highlights, hierarchy time -> name + rating -> details (tags,
notes), remove the word "clip" except the Highlight Later toast, buttons Make Highlight Now /
Highlight Later. Mockups v2 published at the same URL (sections P1/P2, A1/A2, C, B1/B2, D);
ui-designer recommends P2, A2, C as shown, B2, D solid gold. Decision artifact v2: 35 questions
(new H15-H20). Not mocked: the landscape-phone editor (`AnnotateFullscreenOverlay.jsx:804`,
height-starved); it needs the rate modal and Highlight popup too, likely as centered modals,
and the implementing task must design it against the live layout. 393 px no-scroll is by
construction only; not yet browser-checked.

**2026-09-24 (round 3/4)**: Owner picked P2, A2, rate modal C (Highlight meaning "Brilliant
Play! Everyone should see it."), popup **B3** (Back to Editing closes the editor; toast
confirms; "Clips" capitalized; Escape-only cancel). Open: M6, M7 (D2 vs D3). Mockups v3 at the
same URL.

## Acceptance Criteria

- [ ] User has picked A and B, approved C, D and the palette (or given a redirect)
- [ ] Picks recorded in this file and copied into T11110 / T11150 / T11120 / T11130 / T11140

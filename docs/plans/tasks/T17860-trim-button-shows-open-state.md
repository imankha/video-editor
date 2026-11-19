# T17860: "Trim and slow motion" button shows when its track is open

**Status:** WIP
**Impact:** 5
**Complexity:** 2
**Created:** 2026-11-19
**Updated:** 2026-11-19

## In plain words

In Frame, the bar under the video has "Sharpen my highlight", "Trim and slow motion" and "Preview". Tapping "Trim and slow motion" opens the trim and speed track in the timeline. While it is open the button looks and reads exactly the same, and tapping it again closes the track. The owner, testing staging on 2026-11-19, found this strange: nothing says the button now closes what is open. Preview, right next to it, already changes its icon and label when active.

## Ruling

Owner, 2026-11-19: "consult with the UX expert agent and fix". UX expert (Fable) design, adopted as the ruling:

| | Closed | Open |
|---|---|---|
| Icon | Scissors | Check |
| Title and aria-label | Trim and slow motion | Done trimming (new `FRAMING_GUIDE.TRIM_BUTTON_DONE`) |
| Description | Adjust timing and playback speed. | Your trim and speed changes stay. |
| Tooltip | unchanged | Hide the trim and slow motion track. Your changes stay. |

- Pressed look when open, passed via `className`: `border-cyan-300 from-cyan-500/40 to-cyan-500/15 ring-1 ring-cyan-300/60`. It stays a tinted card; the solid cyan "Sharpen my highlight" stays the only saturated control.
- ARIA: replace `aria-pressed` with `aria-expanded={trimOpen}` and `aria-controls="frame-trim-track"`, with that id on the `trim-guide-scope` element.
- No extra close or Done control on the track itself (an in-place panel is dismissed by its disclosure, per the style guide).
- Phone portrait: no layout change; "Done trimming" is shorter than the closed label.
- Landscape phone cockpit (scissors cap opening a CockpitSheet with its own close) is out of scope; leave it.
- Same task: give Preview the same pressed classes while previewing (it has the same no-visual-state gap) and drop its `aria-pressed` if its label already changes, so state is not announced twice.

Rejected: a small X beside the scissors (owner's loose idea; scissors plus X reads as "remove the trim" next to real delete-split and trim-undo controls, and the label still would not say what a tap does). A separate close on the track (second dismiss path; off-screen under the pinned band on phone).

## Current code

- `src/frontend/src/modes/focus/FramingActionRow.jsx` lines ~28-38: the button, an `ActionCard` with a fixed Scissors icon and title `FRAMING_GUIDE.TRIM_BUTTON` (`src/frontend/src/config/displayNames.js` ~1146). Preview's swap is at lines ~47-51.
- `src/frontend/src/modes/FocusModeView.jsx` ~512-527 toggles `advancedOpen`; `showSegments` at ~717; `src/frontend/src/modes/focus/FocusTimeline.jsx` ~64, 111-118 shows the track.
- `ActionCard.jsx` has no pressed styling today.
- Tests asserting `aria-pressed` on `trim-slowmo-button` need updating.

## Relevant Files

- `src/frontend/src/config/displayNames.js`
- `src/frontend/src/components/shared/ActionCard.jsx`
- `src/frontend/src/modes/focus/FramingActionRow.jsx`
- `src/frontend/src/modes/FocusModeView.jsx`
- `src/frontend/src/modes/focus/FocusTimeline.jsx`

## Acceptance Criteria

- [ ] C1: At 1440 and 390 wide, after tapping the Trim and slow motion button it reads "Done trimming" with a check icon, has aria-expanded="true", and its border colour differs from the closed state; the trim and speed track is visible.
- [ ] C2: Tapping it again hides the track and restores "Trim and slow motion", the scissors and aria-expanded="false"; trim and speed edits made while open still apply (highlight length unchanged by closing).
- [ ] C3: At 390 wide the button is at least 44px high in both states, and the "Sharpen my highlight" button does not move or resize between states.
- [ ] C4: While previewing, the Preview button shows the same pressed look, and neither button announces its state twice (no aria-pressed alongside a changing label).

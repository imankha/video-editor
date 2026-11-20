# T17910: Frame buttons read as steps

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-19
**Updated:** 2026-11-19

## In plain words

Frame is the step where a parent drags a box around their athlete and pays credits to sharpen the result into a highlight (a finished short video). The bar under the video has three buttons, in this order: "Sharpen my highlight", "Trim and slow motion" and "Preview".

The owner, testing staging on 2026-11-19, said the screen does not tell a parent to tap "Sharpen my highlight" when they are done framing. The last step sits first in the row. While the trim track is open its button reads "Done trimming" with a check mark, which looks like a second finish button. The coaching sentence shown to a parent with three or more finished highlights ends at "tap Preview" and never names Sharpen, and the sentence that does name it only appears after a preview has played to the end, although Preview is optional.

We will put the buttons in the order a parent works: Trim and slow motion, Preview, then Sharpen my highlight, with a small arrow before Sharpen. The two toggles will say "Close trimming" and "Close preview" while they are on. A short line beside the buttons will say that Trim and Preview are optional and that Sharpen is the finish. The coaching sentences will name Sharpen. The Sharpen button will carry a magic-wand icon in place of the download arrow.

A UX expert reviewed the screen and recommended this. Numbered steps were ruled out because numbering optional buttons makes them look required. Putting the credit cost inside the Sharpen button was ruled out because the button would change width with every trim.

We will know it worked when a tester sees the three buttons in working order on a computer and on a phone, both toggles read "Close ..." while on, the line naming Sharpen shows on a computer, and nothing in the bar moves or resizes when a toggle is tapped.

## Ruling

Owner, 2026-11-19, after reading the UX expert (Fable) proposal: "proceed with all recommendations." This reverses two earlier rulings on purpose: "Generate is FIRST" (T12020) and "Back to full video" as the label while previewing. It also replaces "Done trimming" (T17860, same day).

One recommendation changed after a code check: the expert proposed the Sparkles icon for Sharpen, on condition it meant nothing else. Sparkles is the Spotlight icon across the app (`ModeSwitcher.jsx`, `FocusPublishActionBar.jsx`, `OverlayModeView.jsx`, `ReelTile.jsx`), so Sharpen uses the wand icon instead (`WandSparkles` from lucide-react, or its older alias `Wand2` if the installed version lacks that export).

### Order and hierarchy

- DOM order (not CSS `order`, so tab and screen-reader order match): Trim, Preview, Sharpen.
- Sharpen stays the only solid fill and keeps the 1.4fr cell: grid template becomes `repeat(2,minmax(0,1fr)) minmax(0,1.4fr)` from `sm` up.
- A small `ChevronRight` between Preview and Sharpen, `aria-hidden`, `text-cyan-300/50`, `lg` only.
- No step numbers on the buttons.
- `PRESSED_SECONDARY` in `ActionCard.jsx` is unchanged.

### Labels

| Control | State | Label and aria-label | Icon | Tooltip |
|---|---|---|---|---|
| Trim | closed | Trim and slow motion (unchanged) | Scissors | unchanged |
| Trim | open | Close trimming | Scissors (Check dropped), `pressed` | Close the trim and slow motion track. Your changes stay. |
| Preview | off | Preview (unchanged) | Eye | unchanged |
| Preview | on | Close preview | EyeOff, `pressed` | unchanged |
| Sharpen | idle | Sharpen my highlight (unchanged) | wand (replaces Download) | unchanged |

Descriptions on the tall cards are unchanged. Busy, opening and rendered states of Sharpen are unchanged.

### Idle hint

New string `Trim and Preview are optional. When your athlete stays in the box, tap Sharpen my highlight.` in the band's status cell (left of the buttons on `lg`). Shown only when framing is idle: no error, failure, disconnect, progress or ghost link in that cell. `text-xs text-gray-400`, hidden below `sm`.

### Credit estimate

Stays in the cost cell, which is now next to Sharpen. On `lg`, left-align it (`lg:items-start lg:text-left`).

### Coach sentences (`GUIDE.focus`)

| Key | New string | Rule change |
|---|---|---|
| `preview`, `cockpitPreview` | Tap Preview to see exactly what you’ll share, then tap Sharpen my highlight. | Pulse stays on Preview; add the action band (cockpit: the Sharpen button) to `keepClear` so the shade never dims Sharpen |
| `watchPreview` | Watch it through. Tap Close preview to change anything. | none |
| `experienced` | You know the basics. Trim and Preview are optional. When your athlete stays in the box, tap Sharpen my highlight. | No pulse before the box is checked; pulse the export target once the box has been dragged (split into two rules, plus cockpit twins) |
| `generate`, `generateAdvanced` | unchanged | none |

Build the Sharpen name into these strings from `EXPORT_JOBS.framing.action`, as `generate` does.

### Per layout

- Desktop (`lg`): one row: hint, Trim, Preview, chevron, Sharpen, cost. Band height unchanged (T16640).
- Tablet (`sm` to `lg`): same three-cell order; hint and cost in the row below as today.
- Portrait phone: row 1 Trim and Preview, row 2 Sharpen full width, cost line under it, no hint. The pinned band height must not change; `reserveTwoTitleLines` still guards the label swaps.
- Landscape phone cockpit: `ActionRail` already runs Settings, Preview, cost, Sharpen top to bottom. Only the icon swap and the guide twins apply. `COCKPIT_INTRO_BODY` stays true.

## Current code

- `src/frontend/src/components/ActionBand.jsx` line ~60: the `above` grid renders the CTA cell first, then Trim and Preview (comment cites T12020).
- `src/frontend/src/modes/focus/FramingActionRow.jsx`: Trim and Preview tiles; Trim swaps to `Check` when open.
- `src/frontend/src/config/displayNames.js`: `FRAMING_GUIDE.TRIM_BUTTON_DONE` ("Done trimming"), `TRIM_BUTTON_DONE_HINT`, `EDITOR_PANELS.PREVIEW_BACK_TO_FRAMING` ("Back to full video"), `GUIDE.focus.{preview,cockpitPreview,watchPreview,experienced}` (~1056-1075).
- `src/frontend/src/components/instructions/resolveGuide.js` ~283-298: `focus.progress.experienced` (no pulse, never names Sharpen) and `focus.progress.preview` (holds until a preview has played through). Confirm what lines 293-298 cover before changing the rules.
- `src/frontend/src/components/ExportButtonView.jsx`: the Sharpen button (Download icon) and the status cell.
- `src/frontend/src/modes/focus/cockpit/ActionRail.jsx`: landscape Sharpen button.

## Relevant Files

- `src/frontend/src/config/displayNames.js`
- `src/frontend/src/modes/focus/FramingActionRow.jsx`
- `src/frontend/src/components/ActionBand.jsx`
- `src/frontend/src/components/ExportButtonView.jsx`
- `src/frontend/src/modes/focus/cockpit/ActionRail.jsx`
- `src/frontend/src/components/instructions/resolveGuide.js`
- Tests and checks that pin the old order or strings: `FramingActionRow.test.jsx`, `ActionBand.test.jsx`, `ExportButtonView.test.jsx`, `guideRules.namedControls.test.js`, `resolveGuide.pulseTargets.test.js`, `e2e/checks/T17860.check.spec.js`, `e2e/helpers/trimToggleCheck.js`, `e2e/checks/T16640.check.spec.js`, `e2e/focus-guided-steps.spec.js`. Grep `src/`, `e2e/` and `src/landing/` for "Done trimming" and "Back to full video" before finishing.
- Docs in the same change: the T17860 note in `.claude/knowledge/keyframes-framing.md`, the ActionBand entry in `.claude/references/ui-style-guide.md`, `.claude/knowledge/guidance.md` for the rule changes, and `.claude/references/copy-glossary.md` if it lists either retired label.

## Acceptance Criteria

- [ ] C1: At 1440 wide in Frame, the bar's buttons read left to right "Trim and slow motion", "Preview", "Sharpen my highlight", and keyboard Tab reaches them in that order. At 390 wide, Trim and Preview share one row and "Sharpen my highlight" is full width directly beneath them.
- [ ] C2: After tapping "Trim and slow motion" the button reads "Close trimming" with the scissors icon (no check) and aria-expanded="true", and the trim track is visible; tapping it again restores "Trim and slow motion" and hides the track. "Done trimming" appears nowhere in Frame.
- [ ] C3: After tapping "Preview" the button reads "Close preview"; tapping it returns to dragging the box and the button reads "Preview". "Back to full video" appears nowhere in Frame.
- [ ] C4: At 1440 wide with nothing in progress, the bar shows "Trim and Preview are optional. When your athlete stays in the box, tap Sharpen my highlight." to the left of the buttons; at 390 wide that line is not shown.
- [ ] C5: The "Sharpen my highlight" button shows the wand icon, not the download arrow and not the Spotlight sparkles, at 1440 wide and in the landscape phone rail.
- [ ] C6: At 1440 and 390 wide, the "Sharpen my highlight" button's position and size are the same with the trim track open or closed and with Preview on or off, and at 1280x800 the video, play controls and crop track still fit above the bar without scrolling.
- [ ] C7: For an account with three or more finished highlights, the coach sentence in Frame names "Sharpen my highlight", and once the box has been dragged the Sharpen button pulses. For a new account at the Preview step, the sentence reads "Tap Preview to see exactly what you’ll share, then tap Sharpen my highlight." and the Sharpen button is not dimmed.

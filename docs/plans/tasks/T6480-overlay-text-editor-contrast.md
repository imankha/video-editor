# T6480: Overlay text editor reads bright-on-bright

**Status:** TODO
**Impact:** 5 | **Complexity:** 2
**Follows:** [T5225](player-intro/T5225-overlay-text-layer.md)

## Problem

User, 2026-08-04, with a screenshot from staging:

> The text UI seems like it has some issues with bright on bright.

The "Edit Text" rail sits on the Overlay screen's light-purple panel, and several of its controls are
light on light. Worst offender in the screenshot: the **COLOR** row renders as a near-white swatch on
the pale panel, so the control is nearly invisible until you hover it. Field labels
(TEXT / FONT / COLOR / ALIGN / SIZE) are also low-contrast against the panel.

This is a straight legibility bug, not a taste question — it should meet the contrast floor in the
style guide.

## More evidence 2026-08-05 (second screenshot, same rail)

User: *"the background here is too light for 'size', 'shadow blur' and 'stroke width' texts to be
white."*

Confirms the labels half of the report and pins the exact cause: the rail's field labels are
`text-xs uppercase tracking-wide text-gray-400` (`TextSpecEditor.jsx:55,71,89,100,119`) rendered on
the Overlay host's **light-purple** panel. `text-gray-400` is chosen for a DARK surface; on this host
it is close to the background. The same markup reads fine in the card editor, whose panel is dark —
which is why the component looks correct in isolation and only fails in this host.

So the fix is host-aware, not a global colour swap: either the Overlay panel surface changes, or the
shared editor stops hard-coding label colours and inherits from its host. **Do not simply darken the
labels in `TextSpecEditor`** without checking the card-editor host, or you invert the bug there.

Filed alongside [T6610](T6610-overlay-text-element-manipulation.md) (same rail, element manipulation)
— do both in one worker session, as separate commits.

## Scope

- Audit the `TextSpecEditor` rail as rendered **inside the Overlay screen** (its surface differs from
  where it is hosted in the card editor — check both hosts, since T5205 reuses the same component).
- Fix label + control contrast against the actual panel background; give the colour swatch a visible
  border/checkerboard so a white or near-white pick is still discernible.
- Slider tracks and the footer note ("Overlay text is burned into the exported video...") need the
  same pass.
- Verify in a real browser at both desktop and 375px, in whatever themes the screen supports.

## Notes
- `TextSpecEditor` is SHARED (T5225 built it, T5205 reuses it and extended it with size presets,
  colour swatches and `hideText`/`hideFooterNote`). A fix here must not regress the card editor —
  check with T5205's branch in mind, or after it lands.
- `.claude/references/ui-style-guide.md` is the contrast authority.

## Relevant files
- `src/frontend/src/components/textspec/` — the shared editor
- `src/frontend/src/modes/overlay/` — the Overlay host and its panel surface
- `.claude/references/ui-style-guide.md`

## Classification hint
S/M-tier, frontend-only, no schema change. Real-browser verification with screenshots is the
evidence — a contrast bug cannot be proven fixed in jsdom.

## Acceptance criteria
- [ ] Every label and control in the rail meets the style guide's contrast floor against its actual background.
- [ ] A white / near-white colour selection is still visible as a swatch.
- [ ] Fixed in both hosts (Overlay screen and card editor) with no regression to either.
- [ ] Before/after screenshots at desktop and 375px.

# T17230: Frame: one place to choose the shape

**Status:** TODO
**Impact:** 4
**Complexity:** 3
**Created:** 2026-11-17
**Updated:** 2026-11-17

## In plain words

On desktop Frame shows two controls for the same choice: "Where will you share it? Portrait / Landscape" above the video and Settings "Aspect ratio: Portrait / Landscape". The owner asked for consistency with the rest of the settings. Done when the parent sees the change described below.

## How we got here

Found by the full QA pass on 2026-11-17 on staging (build 1e4e0998f). The owner agreed in the confusion review (https://claude.ai/artifact/QDjidEXfCW1HuNXby2RYLC, finding U08), and a UX expert review (Fable model, same day) settled the final change below. Screenshots: `qa/qa-pass-2026-11-17/ux/` (local, not in git).

This is a confusion finding the owner agreed to fix, not a breakage, so there are no repro logs.

## Solution

- Keep the lasting control in Settings, as every other lasting choice (audio, tilt, spotlight color and size) lives in a settings row. Relabel it "Shape" with value text "Portrait (9:16)" ("shape" is the word the switch dialog already uses).
- Keep "Where will you share it?" only as the first-run step: it disappears once the first position is placed, instead of collapsing to the swap chip. On a phone, keep the chip only if the settings drawer is more than one tap away.
- Both controls share the "switch shape?" confirm that today lives only in `FrameShapeChoice`.

## Relevant Files

Names in the Solution come from the UX expert's code read; otherwise not investigated.

## Acceptance Criteria

- [ ] C1: After the first position is placed, Frame shows exactly one shape control, in Settings, labeled "Shape".
- [ ] C2: Changing the shape after positions exist asks to confirm, from wherever it is changed.

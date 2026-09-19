# T10630: ActionBand stacks on narrow widths (Focus/Overlay export bar)

**Status:** WIP
**Impact:** 5
**Complexity:** 1
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Epic:** [play-editor-autosave/EPIC.md](EPIC.md) (task 4 of 4, S-tier, file-disjoint from the other three — may run first or in parallel)

## Problem

Reproduced live 2026-09-19 at 393x852 on the Focus screen (screenshot in the epic's
decision artifact, Problem 2; user's own staging screenshot showed the same). The bottom
action band renders three cells in one non-wrapping row: the status caption ("Set at least
one focus point to export"), the "Generate Framing" CTA, and the credit estimate
("~8 credits · balance 926 / 20.8s of video · 21 credits · 1 credit per second, rounded to
the nearest second"). `ActionBand.jsx` line 33 is `flex items-center gap-3 ... min-h-[76px]`
with both text cells `flex-1 min-w-0`; the `flex-none` CTA takes its full width and each
text cell is left with ~60-80px, so both captions wrap one word per line into a vertical
column on either side of the button. Overlay uses the same component (T9270), so its band
has the same defect.

## Solution (ui-designer recommendation, 2026-09-19)

Stack the band below the `sm:` breakpoint using the app's established idiom
(`flex-col sm:flex-row`, used by `ProjectManager.jsx`, `GameTile.jsx`, `ShareGameModal.jsx`,
`ConfirmationDialog.jsx`): CTA first (the governing element per the component's own
comment), status line above it centered full-width, cost line below it centered full-width.
Desktop is byte-identical (`sm:` restores today's three-cell row).

```jsx
<div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2 sm:min-h-[76px]">
  <div className="order-2 sm:order-1 flex-1 min-w-0 w-full sm:w-auto flex flex-col justify-center gap-1 text-center sm:text-left">
    {status}
  </div>
  <div className="order-1 sm:order-2 flex-none flex items-center justify-center">
    {cta}
  </div>
  <div className="order-3 flex-1 min-w-0 w-full sm:w-auto flex flex-col justify-center items-center sm:items-end gap-1 text-center sm:text-right">
    {cost}
  </div>
</div>
```

`ExportButtonView.jsx`'s `statusCell`/`costCell` content is unchanged; only the outer band
reflows. Update the component's doc comment (it currently describes the three-cell row as
the only layout). Do NOT gate on `useIsMobile()` here — this is pure width-driven layout
with no behavior split, so a Tailwind breakpoint is the right tool (contrast T10590
finding 2, where BEHAVIOR forked).

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ActionBand.jsx` — the fix (one file)
- `src/frontend/src/components/ExportButtonView.jsx` — read only (cells it supplies; the T9480 billable second line is the long cost text)
- `src/frontend/src/modes/FocusModeView.jsx`, `src/frontend/src/modes/OverlayModeView.jsx` — read only (hosts)
- `src/frontend/e2e/T4880-mobile-editor-reachable.spec.js` — asserts the Framing Export / Create Reel CTA is reachable + clickable at 390x844 portrait and landscape; must still pass
- New unit test `src/frontend/src/components/ActionBand.test.jsx`

### Related Tasks
- Independent of T10600-T10620 (no shared files)
- Prior art: T9270 (ActionBand), T8510 (reason-next-to-button), T9480 (billable-duration second line that makes the cost cell long)

### Technical Notes
- Keep `data-testid="action-band"` and the CTA's DOM identity — T4880 and the usability audit key on them.
- `min-h-[76px]` becomes `sm:` only; on mobile the band's height is content-driven (three stacked lines).
- No horizontal overflow at 320px (usability audit invariant); the cost line's long variant ("20.8s of video · 21 credits · 1 credit per second, rounded to the nearest second") must wrap naturally as a paragraph, not per word.

## Implementation

### Steps
1. [ ] Branch `feature/T10630-action-band-mobile-stack` (single file + test; inline in the shared tree is acceptable per the dotask container gate)
2. [ ] Write `ActionBand.test.jsx`: renders three cells with the `order-*`/`sm:` classes; CTA node identity preserved
3. [ ] Apply the class change + doc comment
4. [ ] Live check at 320/375/393/844 widths on Focus AND Overlay (drive via `openFramingDraft` helper); screenshots
5. [ ] Run: `ActionBand.test.jsx`, `ExportButtonView.test.jsx`, `ExportButtonView.billableDisclosure.test.jsx`, e2e `T4880-mobile-editor-reachable.spec.js`
6. [ ] Push; CI verdict; provable by test + T4880 -> merge when green

### Progress Log

**2026-09-19**: Filed. Not started.

## Acceptance Criteria

- [ ] At 393px and 320px: status and cost captions render as full-width centered lines, never one word per line (screenshot evidence, Focus + Overlay)
- [ ] CTA renders first (top) on mobile; desktop row order/appearance unchanged at >= 640px (screenshot diff vs master)
- [ ] `T4880-mobile-editor-reachable.spec.js` passes (CTA reachable + clickable, no horizontal overflow)
- [ ] Unit test green; lint clean; Branch CI green

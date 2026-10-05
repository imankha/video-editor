# T11720: Compact locked Generate band on phones

**Status:** STAGING
**Impact:** 8
**Complexity:** 3
**Tier:** M (frontend only, ~3 files, ~90 LOC including tests)
**Created:** 2026-10-04
**Decision gate:** F2 (recommended option 1). Depends on T11700 and T11710 (same file). **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 3 of 3 in [Epic A: Frame Highlight unlock](EPIC.md). Milestone rules:
[README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [iphone/08](../../../ux/2026-10-04-parent-usability-audit/iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png).
At 390px portrait the sticky Generate band stacks a status caption, a 44px button and a cost line,
about 130-160px tall, while Generate is still disabled. It covers the timeline, Trim and slo-mo, and
the settings row: the very controls the parent needs to unlock it. `App.jsx:1009` adds `pb-48` below
the band, but that does not help, because the band floats over the content above it.

## Solution

Below the `sm` breakpoint, while the clip is unframed, render the band as one compact row (~52px):

```
[!] Set a focus point to unlock Generate        [ Generate ]  (disabled pill)
```

- Row: `flex items-center gap-2 px-3 py-2`
- Left: `AlertCircle` size 14 + text `text-xs text-amber-400 flex-1 min-w-0`, copy
  **Set a focus point to unlock Generate**
- Right: disabled pill `h-9 rounded-lg px-3 text-sm font-medium bg-blue-900/50 text-blue-300/60`,
  label **Generate**, `aria-disabled="true"`
- The cost line is hidden while locked.

When the first focus point exists, the full stacked band returns. The band growing reads as "unlocked".
Desktop and tablet (`sm` and up) are unchanged.

## Relevant Files (under `src/frontend/src/`)

- `modes/FocusModeView.jsx:998` - sticky wrapper `sticky bottom-0 z-30 ... relative overflow-x-clip`.
  It also anchors the mobile SettingsRail (`absolute bottom-full`, T10820). **Keep it sticky and
  `relative`.**
- `components/ActionBand.jsx:39` - band layout, stacked below `sm` (T10630).
- `components/ExportButtonView.jsx` - CTA, caption and cost line.
- `containers/ExportButtonContainer.jsx:1021-1034` - where `hasUnframedClips` is computed.
- `utils/clipSelectors.js:89-95` - `clipIsFramed`.

## Implementation Steps

1. Add `FOCUS_HINTS.GENERATE_LOCKED_SHORT: 'Set a focus point to unlock Generate'` to `displayNames.js`.
2. Pass a `compactLocked` boolean into `ActionBand` / `ExportButtonView`: true when the clip is
   unframed. Derive it from `clipIsFramed`; do not store it.
3. In `ActionBand`, when `compactLocked`, render the compact row **below `sm` only** (use Tailwind
   breakpoints, e.g. a `sm:hidden` compact row plus a `hidden sm:flex` full band; T10630 says layout
   switches use breakpoints, not `useIsMobile`).
4. Keep `data-testid="action-band"` on the outer element and keep the real CTA button in the DOM for
   `sm`+ so existing tests and the T4880 reachability spec still find it.
5. Add a one-line note to `.claude/references/ui-style-guide.md`: "Locked band compact row is an
   allowed exception to T9270's never-resize rule (that rule is about the settings rail)."

## Acceptance Criteria

1. At 390x844 with 0 focus points, the band is at most 56px tall and the timeline and the "Trim and
   slo-mo" control are visible on screen above it at some scroll position before the end of the page.
2. After the first focus point, the full band (CTA, cost line) returns.
3. The mobile settings panel still opens above the band in both states.
4. No horizontal overflow at 320, 360, 375, 390.
5. Desktop and 768 layouts unchanged (compare screenshots).

## Tests (red first)

- `components/ActionBand.test.jsx`: compact row renders when `compactLocked` and contains the new
  copy; full band otherwise.
- Regression: `FocusModeView.framingActionRow.test.jsx`, `FocusModeView.advancedEditing.test.jsx`,
  `ExportButtonView.billableDisclosure.test.jsx`.
- E2E: `e2e/T4880-mobile-editor-reachable.spec.js` looks for a button named "Export"; it is stale
  (known, T10640). Fix the locator to "Generate Highlight" and run it locally at 390.

## Landmines

- Never make the wrapper `position: fixed` or non-sticky: the SettingsRail is anchored inside it
  (T10820 backdrop-filter containing-block trap).
- No `h-screen` / `inset-0` (T4880 `h-dvh` rule).
- If the user picks F2 option 3 instead (CTA only, label "Set a focus point first"), drop the compact
  row and hide only the caption and cost line below `sm`.

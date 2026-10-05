# T11740: Editor header fits phones, game name always visible

**Status:** STAGING
**Impact:** 9
**Complexity:** 3
**Tier:** M (frontend only, ~4 files + 1 new e2e spec, ~80 LOC)
**Created:** 2026-10-04
**Decision gate:** M1 (recommended option A) **Ruled 2026-10-04: recommended option taken.**

## Epic Context

Task 1 of 4 in [Epic B: Fits on phones and tablets](EPIC.md). Milestone rules:
[README.md](../README.md#standing-rules-for-every-task-in-this-milestone).

## Problem

Evidence: [iphone/07](../../../ux/2026-10-04-parent-usability-audit/iphone/07-new-game-editor-overflow-and-hidden-title.png),
[iphone/08](../../../ux/2026-10-04-parent-usability-audit/iphone/08-focus-overflow-hidden-controls-and-unclear-focus-point.png).
On a 390px phone, Annotate and Focus scroll sideways, "Frame Highlight" and "Add Spotlight" are cut
off, and the game name is invisible (the title shrinks to 0px). See the EPIC for the exact mechanism.

## Solution (option A)

Below `md` (768px) the header becomes two rows. At `md` and up it stays one row exactly as today.

```
390px Annotate                          390px Focus
[<] at Oceanside Breakers      [≡ 6]    [<] Play 1               [52] [crop]
    Aug 30                                  at Oceanside Breakers Aug 30
[ scissors ][   crop    ][  lock   ]    [ scissors ][   crop    ][  lock   ]
[ Annotate ][Frame High.][Add Spotl.]   [ Annotate ][Frame High.][Add Spotl.]
```

- Wrapper: `flex flex-col gap-1 mb-2 md:flex-row md:items-center md:gap-2`
- Row 1: `flex items-start gap-2 min-h-11 md:flex-1 md:min-w-0`
  - Back button: `w-11 h-11 flex-shrink-0` (44px, up from 40)
  - Title block `flex-1 min-w-0 py-1`: primary `text-white font-medium text-sm leading-tight line-clamp-2 break-words`;
    on Focus/Spotlight only, a second line with the game name from the existing `breadcrumbGameName`
    prop: `text-xs text-gray-400 truncate`
  - Chips (plays count, credits, framing status): `flex items-center gap-2 flex-shrink-0 self-center`
- Row 2 (ModeSwitcher inline container): `grid grid-cols-3 gap-1 bg-white/5 rounded-lg p-1 md:flex md:bg-transparent md:p-0`,
  `role="group" aria-label="Editor steps"`
  - Each tab below `md`: `flex flex-col items-center justify-center gap-0.5 h-12 px-1 min-w-0 rounded-md`,
    icon 16 stacked over label `text-[11px] font-medium leading-tight text-center`
  - At `md`+: today's classes (`flex-row h-11 px-4 gap-2 text-sm whitespace-nowrap`)
  - Active styling, locked styling, gold hairline, `aria-disabled`, the T8480 locked-tab toast and
    every `data-testid` stay exactly as they are. Only layout classes change.

Use Tailwind `md:` for the row split, **not** `useIsMobile` (it sends 768-1023 tablets to the mobile
branch, and they fit one row).

## Relevant Files (under `src/frontend/src/`)

- `components/shared/UnifiedHeader.jsx:41-74` - mobile branch. `MODE_ICONS`/`ModeIcon` (`:10-14`,
  `:44`) are computed but never rendered; delete them if unused after the change.
- `components/shared/ModeSwitcher.jsx:132-151` - inline button layout.
- `screens/AnnotateScreen.jsx:783-810` - header props; plays-count chip at `:800-807`.
- `App.jsx:1011-1027` - Focus/Spotlight header props.
- `config/displayNames.js:166-170` - `MODE_SWITCHER_NAMES` (labels unchanged here; T11850 may rename "Annotate").

## Implementation Steps

1. In `UnifiedHeader.jsx`, wrap the mobile branch in the two-row structure above. Move the chips into
   row 1. Add the game-name second line for Focus/Spotlight using `breadcrumbGameName`.
2. In `ModeSwitcher.jsx`, give the `inline` variant the responsive classes above. Do not touch the
   click/lock logic.
3. Add the 44px Back button size.
4. Write the e2e spec (below) and run it locally at all widths.
5. Update `docs/plans/mobile-ux-spec.md` section 6.5 (the old `[<] Title ... [mode indicator]` spec)
   and the "ModeSwitcher icon-only on mobile" row in `src/frontend/.claude/skills/responsiveness`.

## Acceptance Criteria

1. At 320, 360, 375, 390: no page-level horizontal scroll on /annotate, /focus, /overlay.
2. The game name (Annotate) or play name + game name (Focus/Spotlight) is visible, wrapping to 2 lines
   when long.
3. All three steps are labeled and at least 44px tall; locked tabs still show the lock and the toast on tap.
4. At 768 and 1440 the header looks the same as today (compare screenshots).

## Tests (red first)

- New `e2e/T11740-editor-header-no-overflow.qa.spec.js`: for each width in [320, 360, 375, 390, 768]
  open an Annotate game and a Focus clip (dev-login, `reference_drive_app_as_user`), call
  `assertNoHorizontalOverflow` (`e2e/helpers/qa.js:47`) and assert the title element is visible with
  non-zero width. Run it red on master first and record the failure.
- Update `components/shared/ModeSwitcher.test.jsx` and add a `UnifiedHeader` class-contract test
  (row wrapper has `flex-col md:flex-row`; title has `line-clamp-2`).
- Regression: `multiClipReframeEntryPoints.test.jsx`, `AnnotateScreen.mobileToggle.test.jsx`,
  `e2e/T9920-annotate-narrow-layout.qa.spec.js`, `e2e/screen-usability.spec.js`.

## Landmines

- Do **not** hide the overflow with `overflow-x-hidden`; that just clips Add Spotlight.
- Locked tabs keep `aria-disabled`, not `disabled`, or the T8480 toast stops firing.
- The header grows from ~40px to ~100px on phones. That is accepted; Epic A's compact band offsets it on Focus.
- Branch CI never runs Playwright. The e2e proof must be run locally and its output recorded.

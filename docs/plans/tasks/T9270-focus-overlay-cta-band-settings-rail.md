# T9270: Focus/Overlay CTA action band + unified collapsible settings rail

**Status:** TODO
**Impact:** 8
**Complexity:** 7
**Created:** 2026-09-08
**Milestone:** Final Polish (moved 2026-09-09, user order)

## Problem

Two problems on Focus and Overlay, both hurting the conversion step this product exists to
produce (the user clicking Export / Publish).

**1. The primary CTA sits below the fold.** Measured against the actual Tailwind classes: on a
1440-wide viewport the Focus Export button's bottom edge lands at ~1270px for a single unsplit
clip (~1390px with a speed split plus the multi-clip Total row), and Overlay's "Add Overlay"
button at ~1410-1440px. That is driven almost entirely by the Overlay stage's `lg:h-[70vh]`
(`OverlayModeView.jsx:376`) and, on Focus, by the export section sitting after the video, the
timeline and the segment stack. On a 900px laptop both are 300-500px below the fold and never
paint on first load.

T8790 already fixed this **for phones only** - `FocusModeView.jsx:78-85` pins the export action
as a sticky bottom bar and then deliberately resets to normal flow at `lg` so the desktop layout
stayed byte-unchanged. Overlay has no equivalent at any width. The two `mobileReachable` tests
pin element PRESENCE, not visibility, so neither guards this.

**2. The settings are disjoint, in three idioms.** Focus splits its settings across a horizontal
toolbar above the video (`FocusModeView.jsx:361-412` - aspect selector, Background Dim/Dark
switch, Straighten toggle, ZoomControls) and a separate settings card ~900px further down, past
the timeline. Overlay uses a third idiom: a tabbed right rail of stacked label rows
(`OverlaySettingsCard.jsx`, `OverlaySettingsTabs.jsx`) plus a ZoomControls orphaned on its own
row above the split (`OverlayModeView.jsx:814-830`).

Related defects found while inventorying, all in scope because they are the same code:

- **The Overlay settings tabs are rendered TWICE** in `OverlayModeView.jsx` (a desktop copy and
  a mobile copy), each with its own independent `useState`, so the two can disagree about which
  tab is open.
- Focus hand-rolls a toggle switch with inline hex colors (`FocusModeView.jsx:376-387`) instead
  of the shared `Toggle` component.
- Four different accent colors currently mark a "selected" state across the two screens.
- Overlay's right rail is a fixed-height column beside the portrait stage; with only five
  controls in it, roughly 330px sits empty while Publish is 250px below the fold. The vertical
  room to fix problem 1 already exists on that screen.

## Design (approved 2026-09-08)

Canvas: https://claude.ai/code/artifact/2c86163e-c498-4bfb-a50d-1e29d999cfd7
(page "CTA placement" = the chosen Placement 1; page "Rail states" = the rail's two states plus
an interactive collapse; page "Mobile" = the below-lg drawer in both states plus an interactive
handle; page "Explored options" = the three rejected earlier directions.)
Working artboard sources: `C:\tmp\focus-overlay-canvas\` (`Main.dc.html` and `MobileMain.dc.html`
are the interactive ones; the stills are generated from them by `make-stills.mjs`).

### The governing rule

**One saturated element per screen, and it is the CTA.** The video is second. The settings rail
is third and carries NO accent color at all. This is the rule that was violated by the earlier
draft, which parked the CTA inside the settings rail and thereby let a tertiary container
dictate the primary action's size (it shrank to an icon button when the rail collapsed). The
CTA must never live inside the settings container.

### Three regions, and what goes in each

| Region | Contains | Rule |
|--------|----------|------|
| **Action band** | The primary CTA, plus a status cell and a cost cell | Anything that commits work or spends credits |
| **Stage + timeline** | Video, crop/spotlight overlays, timeline lanes | The work surface, unchanged in kind |
| **Settings rail** | Every persistent setting and every view-only preference | Anything that tunes but does not commit |

### Action band (solves problem 1)

- A `flex: none` band at the bottom of the screen shell, **76px tall**, spanning the FULL width
  under both the main column and the rail, so it reads as a page-level layer rather than a
  column footer.
- `background: #0b1220`, `border-top: 1px solid rgba(255,255,255,0.14)`,
  `box-shadow: 0 -8px 24px rgba(0,0,0,0.35)`.
- Three cells: `flex: 1` status (left), the CTA (auto, centered), `flex: 1` cost (right,
  `justify-content: flex-end`). Equal-flex sides is what centers the CTA on the viewport axis.
- CTA anatomy, identical on both screens except color: **56px tall**, `padding: 0 34px`,
  `border-radius: 10px`, icon + label, `font-size: 17px`, `font-weight: 600`.
  Focus `#2563eb` with `box-shadow: 0 4px 16px rgba(37,99,235,0.50)`;
  Overlay `#9333ea` with the purple equivalent.
- **The CTA never resizes, never collapses, and never moves.** The rail's state must have no
  effect on it whatsoever.
- Export progress, the failed/retry state, and the disabled reason all render in the band's LEFT
  cell, preserving T8510's "reason next to the button" property. This is the main reason this
  placement won over the two alternates (under-stage in flow, and a pill anchored on the stage).
- This generalizes T8790 rather than replacing it: the mobile sticky bar becomes the same
  component at every width, so `FocusModeView.jsx:85`'s `lg:static lg:bg-transparent` reset goes
  away.

### Settings rail (solves problem 2)

- Right-hand side on BOTH screens, `width: 300px`, `background: #0f172a`,
  `border-left: 1px solid #334155`, running floor to ceiling between the header and the action
  band.
- **Collapsible, defaulting to expanded.** A chevron button in the rail header collapses it to a
  **64px icon strip** that keeps the tab icons. The width transition is
  `320ms cubic-bezier(0.2, 0.8, 0.2, 1)` on the rail box only; the main column reflows for free
  and the stage grows into the space with no measuring code (the players are already
  container-sized: `object-contain max-w-full max-h-full` in `VideoPlayer.jsx:235`, and the
  Overlay stage is aspect-sized in `OverlayModeView.jsx:372-382`).
- Open/collapsed is **ephemeral view state** - local `useState`, NEVER persisted. This is the
  no-persisted-view-state rule (precedent: T5641 `straightenVisible`, T5610 `circleEditActive`,
  T5370 `spotlightPlayMode`).
- Rail header: chevron + the screen's tabs (Focus: `Clips | Settings`; Overlay:
  `Spotlight | Text | Thumbnail`).
- Rail body: `SettingRow`s in labelled groups. Group by WHAT A CONTROL CHANGES, which is the
  taxonomy the inventory produced: **Reel** (applies to every clip) / **This clip** or
  **This spotlight** / **View only** (zoom, background dim - never persisted).
- One `SettingRow` anatomy everywhere, lifted from the existing `OverlaySettingsCard` rows:
  `flex items-center justify-between`, left column `text-sm font-medium text-gray-200` label over
  `text-xs text-gray-400` live value, control on the right. Sliders `w-24 accent-blue-500`;
  segmented controls `px-2.5 py-1 rounded text-xs font-medium`, on = `bg-blue-600 text-white`,
  off = `bg-gray-700 text-gray-300`.
- **One accent color for "selected"** across both screens: `blue-600`. This retires the four
  competing accents.
- Coarse pointers keep the 44px floor (`coarse-pointer:` variants), as `OverlaySettingsCard`
  already does for its swatches.

### Geometry this produces at 1280x900

Stage box = 900 - 52 header - 76 band - 32 main padding - 36 meta row - 32 card padding
- 114 timeline - 12 gap = **546px tall**.

| Screen | Rail expanded | Rail collapsed |
|--------|---------------|----------------|
| Focus (16:9) | 908 x 511, width-bound by the rail | 971 x 546, height-bound (+14% area) |
| Overlay (9:16) | 307 x 546, height-bound | 307 x 546, unchanged |

On Overlay the portrait video is height-bound either way, so collapsing is a decluttering
gesture there, not a size one. That is expected, not a bug.

### Accepted tradeoffs (design decisions, do not "fix" these)

- The band costs 76px of height on every screen; the stage pays for it.
- The CTA centers on the VIEWPORT axis, so with the rail open it does not sit on the video's
  center line.
- Collapsed, the rail still spends 64px on the icon strip; the stage recovers 236 of 300px,
  never all of it. Reclaiming the last 64px would mean relocating the CTA, which the design
  explicitly rejects.

### Mobile (below `lg`, or any coarse pointer - `useIsMobile`'s query) - added 2026-09-09

The same three regions and the same rule, re-cut for a 390px-wide screen. Canvas page "Mobile".

- **The rail becomes a drawer, collapsed by default, and it expands HORIZONTALLY**: it slides in
  from the right edge over the stage. The opposite default from desktop (expanded), because on a
  phone an open panel and a usable stage cannot coexist.
- **Geometry (390x844):** header 48px; action band 100px at the bottom; the drawer occupies the
  region between them (top 48, bottom 100), `width: 300px`, `background: #0f172a`,
  `border-left: 1px solid #334155`, `box-shadow: -12px 0 32px rgba(0,0,0,0.45)`. Open leaves a
  90px sliver of stage visible; that is accepted (see tradeoffs).
- **It stops above the action band.** The CTA is fully visible in BOTH drawer states. This is
  the governing rule applied to mobile: settings may cover the video, never the action.
- **One property animates:** `transform: translateX(300px -> 0)`, `320ms cubic-bezier(0.2, 0.8,
  0.2, 1)`. Nothing reflows; the stage does not change size (it is already full width). A scrim
  (`rgba(0,0,0,0.35)`) fades over the stage behind the drawer.
- **The handle rides the drawer's left edge** as a child (`left: -28px`, vertically centred,
  28x72px, `border-radius: 10px 0 0 10px`, chevron + the screen's icon), so it is the SAME
  control in both states and pokes out 28px when the drawer is closed. It sits at the vertical
  middle of the right edge deliberately: top-right is the mobile fullscreen `Maximize` button
  (`absolute top-2 right-2`, Focus and Overlay), bottom is the playback controls. Visible at
  rest, `title` + `aria-label="Settings"`, >=44px hit target via an invisible padding
  pseudo-element (the discoverable-never-hover-only rule).
- **No backdrop-tap to close** (house rule, `feedback_no_backdrop_close`). The handle, now showing
  a right-pointing chevron, is the way out.
- **Drawer content is the desktop rail's content verbatim** (same tabs, same `SettingRow`s, same
  groups). Rows keep the 44px coarse-pointer floor. A row whose control is wider than the label
  column (the six 44px colour swatches) STACKS: label row, then control row, `flex-wrap`.
- **Focus keeps its current desktop-only exclusions**: zoom (pinch handles it) and background dim
  (there is no pillarbox to dim on a phone) do not appear in the mobile drawer, exactly as
  `FocusModeView.jsx:371-372` gates them today. Straighten's line-drag tool likewise stays
  desktop-only. The mobile Focus drawer therefore holds Reel (aspect ratio, include audio) and
  the Clips tab; Overlay's holds the full Spotlight / Text / Thumbnail set.
- **The aspect selector moves into the drawer.** T7130 rendered it at every width because gating
  it behind `lg:` stranded phone users on 9:16; it is still reachable at every width here, one
  tap further. Acceptable; noted so nobody re-adds a second copy above the video.
- **Action band on a phone stacks:** a single 12px status line (`text-gray-400`, truncating)
  above a FULL-WIDTH 56px CTA; `padding: 10px 16px 12px` + `env(safe-area-inset-bottom)`, 100px
  total. Export progress and the disabled reason take the status line's slot, so "reason next to
  the button" still holds. This IS T8790's sticky bar, now the same component as the desktop
  band.
- **In mobile fullscreen (`mobileFs`) the handle is hidden**, as the toolbar is today.
- Drawer open/closed is ephemeral view state, same as the desktop rail.

**Mobile tradeoffs (decisions, do not "fix"):** open, the drawer covers 300 of 390px, so a
spotlight is tuned while seeing a 90px sliver of it (changes are live; close to review). The
28px handle overlaps the stage's right edge; with the 40vh-capped portrait video centred at
190px wide it never touches the video, and on a 16:9 source it covers a 28px strip of the
right edge. A bottom sheet was considered and rejected per direction (horizontal expansion
keeps the mental model identical to the desktop rail).

## Scope

**In:** `FocusModeView.jsx`, `OverlayModeView.jsx`, a new shared `SettingRow` /
`SettingsPanel` / `SettingsRail` component set, `OverlaySettingsCard.jsx`,
`OverlaySettingsTabs.jsx`, `ExportButtonView.jsx` (band layout + progress in the left cell),
`FocusPublishActionBar.jsx`, `OverlayPublishActionBar.jsx`, `ZoomControls.jsx` and
`AspectRatioSelector.jsx` (re-homed into rail rows), the duplicate-tabs fix, the shared `Toggle`
swap, and the affected tests.

**Out:** Annotate (its own screen, its own idiom - a follow-up if this lands well); the mobile
FULLSCREEN layout (`mobileFs`, T4880) beyond hiding the drawer handle there; any change to what
the settings actually DO; any persistence or schema change (there is none in this task).
(The non-fullscreen mobile layout IS in scope as of 2026-09-09: see § Mobile.)

## Acceptance criteria

1. On both Focus and Overlay, at 1280x900, 1440x900 and 1280x768, the primary CTA is fully
   within the viewport on first paint with no scrolling. Evidence: Playwright
   `boundingBox()` assertions against the viewport, not `toBeVisible()` (presence is what the
   existing `mobileReachable` tests already prove and it is not enough here).
2. The CTA's rendered box is byte-identical with the rail expanded and collapsed, on both
   screens. Evidence: a test that toggles the rail and compares `boundingBox()`.
3. Every setting from the inventory is reachable in the rail on its screen, and each screen's
   rows use the same `SettingRow` component. No settings remain in a toolbar above the video or
   in a card below the timeline.
4. Exactly one accent color (`blue-600`) marks a selected state across both screens.
5. The Overlay settings tabs are rendered ONCE, with one source of truth for the active tab.
6. Rail open/collapsed does not survive a reload (no-persisted-view-state).
7. Collapsing the rail grows the Focus stage; the transition runs on the rail width only.
8. At 390x844 on both screens: the CTA is fully within the viewport on first paint
   (`boundingBox()`, as in criterion 1), the settings drawer is CLOSED on load, and the CTA's
   box is identical with the drawer open and closed. T8790's guarantee is subsumed, not lost.
10. The mobile drawer opens with a horizontal slide from the right (assert the drawer's
    `transform` before/after, not just presence), stops above the action band, does not close on
    a tap outside it, and its handle is visible at rest with a >=44px hit box, `title` and
    `aria-label`. Every control in the drawer meets the 44px floor on a coarse pointer.
11. On mobile, the aspect selector is reachable inside the drawer and is NOT also rendered above
    the video (exactly one instance, on every width).
9. Export progress, failed/retry and the disabled reason all render in the band beside the CTA.

## Test scope (relevant set, ~10)

- `FocusModeView.mobileReachable.test.jsx`, `OverlayModeView.mobileReachable.test.jsx`
  (both will need updating - their meaning changes from "present" to "in viewport")
- `FocusModeView.aspectRatio.test.jsx`, `FocusModeView.mobileAspect.test.jsx`
- `OverlayModeView.aspectStage.test.jsx` (the T5676 geometry test - the stage row changes)
- `OverlaySettingsTabs.test.jsx`
- `FocusPublishActionBar.test.jsx`, `OverlayPublishActionBar.test.jsx`
- New: a rail collapse/expand unit test and a CTA-above-fold e2e spec at three desktop viewports
- New: a mobile drawer e2e at 390x844 (closed on load, slide open, CTA box unchanged, no
  backdrop close, handle hit box) - run with a coarse-pointer emulation, since `useIsMobile`
  also keys on `(hover: none) and (pointer: coarse)`
- Note the T5380 precedent: pointer/layout behaviour gets a REAL browser check, not jsdom alone.

## Suggested sequencing (three shippable steps)

1. **Action band.** Generalize T8790's sticky bar into the full-width band on both screens, CTA
   centered at final size, progress and reasons moved into it. Closes problem 1 on its own.
2. **Rail components.** Extract `SettingRow` / `SettingsPanel` / `SettingsRail`, port Overlay's
   existing rows onto them, fix the duplicate-tabs bug, unify the accent.
3. **Re-home Focus's settings.** Move the toolbar and the below-timeline card into the rail with
   the Reel / This clip / View only grouping; add the collapse behaviour to both screens.
4. **Mobile drawer.** Below `lg`, render the same `SettingsRail` as the translateX drawer with
   the edge handle, collapsed by default; delete Overlay's second (`lg:hidden mt-6`) settings
   render and Focus's above-video aspect selector, since both now live in the drawer.

## Notes for the implementor

- T9150 landed 2026-09-09 (PR #375) and is the baseline for the Overlay stage row: the rail
  reservation is now a cap on the stage COLUMN, `lg:max-w-[calc(100%-22rem)]` at
  `OverlayModeView.jsx:873`, not on the stage box (its Reviewer caught the `100vw`-vs-`100%`
  bug; read that commit, `869f7a16`, before touching the row). 22rem = 352px against this
  design's 300px rail plus its gap, so the numbers already line up.
- The mobile drawer is a `transform`, not a width change: never animate `width` on the phone
  path, and never let the drawer's presence alter the stage box (it is `position: absolute`
  inside the body region). The desktop rail is the opposite (in-flow width tween). Same
  component, two layout modes, switched on `useIsMobile()`.
- Do NOT add a `useEffect` that writes rail state anywhere. Gesture-based persistence rule; and
  this state is not persisted at all.
- Read `.claude/knowledge/keyframes-framing.md` before touching the Focus stage or timeline, and
  `.claude/references/ui-style-guide.md` for the row/chip anatomy. Add the settings-rail and
  action-band patterns to the style guide in the same PR (refactoring rule 5).

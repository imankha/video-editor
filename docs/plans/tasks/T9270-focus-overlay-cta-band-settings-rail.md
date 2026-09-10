# T9270: Focus/Overlay CTA action band + unified collapsible settings rail

**Status:** STAGING (PR #384 merged 2026-09-10)
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

### Mobile (below `lg`, or any coarse pointer - `useIsMobile`'s query) - revised 2026-09-09 (v2)

The same three regions and the same rule, re-cut for a 390px-wide screen. Canvas page "Mobile".

**v1 is superseded.** It hid settings behind a 28px edge sliver and left 250-330px of dead
space below the timeline. Both were rejected on review: the sliver was undiscoverable AND
under the 44px floor, and the void was space the work surfaces needed. v2 keeps the horizontal
drawer; it changes what opens it and what fills the page.

#### Touch-target audit that drove this (390x844)

| Element | v1 | v2 | Floor |
|---------|----|----|-------|
| Primary CTA | 56px full width | unchanged | 44 - PASS both |
| Header back button | 18px icon, no hit box | 44x44 | 44 - v1 FAILED |
| Mode tabs (Annotate/Focus/Overlay) | ~28px tall, 11px type | 38px tall in a 44px group, 12px type | 44 - v1 FAILED |
| Settings entry | 28x72 edge sliver | 64px full-width row | 44 - v1 FAILED |
| Timeline lanes | 32 / 38 / 44 | 44 / 64 / 48 | legibility, not target |
| Slider knobs | 12px | 24px on a 6px track | 44 via row height |
| Colour swatches | 44px | 48px | 44 - PASS both |
| Drawer setting rows | 44px | 52px | 44 - PASS both |

Keyframe diamonds are NOT on this list: `KeyframeMarker.jsx:99` already gives them a 44px hit
box (`absolute -inset-3 coarse-pointer:-inset-4`) around the 12px visual. Do not "fix" that.

#### The settings entry: a labelled row, not a sliver

- A **64px full-width button** sitting between the timeline and the action band:
  `border: 1px solid #334155`, `border-radius: 10px`, `background: #0f172a`, `padding: 0 14px`.
- Three cells: the screen's icon (sliders on Focus, sparkle on Overlay), a two-line label, and
  a `chevron-left` at the right edge pointing the way the drawer will arrive.
- The label's second line is a **live summary of the current values**, so the row is useful
  before it is ever tapped: Focus `"9:16 vertical - Audio on - Level"`, Overlay
  `"White - Body ellipse - Dim 15%"`. Derive it from the same state the rows bind to; never
  store a second copy.
- Title: `"Settings"` on Focus, `"Spotlight settings"` on Overlay (naming the object it tunes).
- This replaces the v1 edge handle entirely. There is no sliver, and nothing is hover-gated.

#### The drawer

- Still **collapsed by default** and still **expands HORIZONTALLY**, sliding in from the right
  edge over the stage. Opposite default from desktop (expanded), because on a phone an open
  panel and a usable stage cannot coexist.
- **Geometry:** header 56px; action band ~102px; the drawer occupies the region between them,
  `width: 316px`, `background: #0f172a`, `border-left: 1px solid #334155`,
  `box-shadow: -12px 0 32px rgba(0,0,0,0.5)`.
- **It stops above the action band.** The CTA is fully visible in BOTH drawer states. This is
  the governing rule applied to mobile: settings may cover the video, never the action.
- **One property animates:** `transform: translateX(316px -> 0)`, `320ms cubic-bezier(0.2, 0.8,
  0.2, 1)`. Nothing reflows; the stage does not resize. A scrim (`rgba(0,0,0,0.45)`) fades over
  the content behind it.
- **The drawer's own header carries the close control**: title + a 44x44 `X` button. With the
  entry row outside and the close inside, each state has exactly one obvious control.
- **No backdrop-tap to close** (house rule, `feedback_no_backdrop_close`).
- **Content is the desktop rail's content verbatim** (same tabs, same `SettingRow`s, same
  groups), at mobile sizes: rows 52px, swatches 48px, segmented controls 44px tall. A row whose
  control is wider than the label column (the six swatches) STACKS: label row, then control row,
  `flex-wrap`.
- **Focus keeps its current desktop-only exclusions**: zoom (pinch handles it) and background dim
  (a phone has no pillarbox to dim) do not appear in the mobile drawer, exactly as
  `FocusModeView.jsx:371-372` gates them today. Straighten's line-drag tool likewise stays
  desktop-only. The mobile Focus drawer therefore holds Reel (aspect ratio, include audio),
  This clip (straighten angle), and the Clips tab.
- **The aspect selector moves into the drawer.** T7130 rendered it at every width because gating
  it behind `lg:` stranded phone users on 9:16; it is still reachable at every width here, one
  tap further, and now also *reported* on the entry row without opening anything. Exactly one
  instance - do not re-add a copy above the video.
- **In mobile fullscreen (`mobileFs`) the entry row is hidden**, as the toolbar is today.
- Drawer open/closed is ephemeral view state, same as the desktop rail.

#### What the reclaimed space buys

- **Overlay: drop the 40vh video cap.** `VideoPlayer.jsx:197`'s `max-h-[40vh]` is why the
  portrait reel renders 190x338 with a void beneath it. Letting the stage take the space left
  after the header, timeline, entry row and band gives **242x430, +62% area** - on the exact
  surface the user taps to place a spotlight. This is the single biggest mobile win in the task.
- **Focus: a horizontal clip strip.** 84px-tall 9:16 thumbnails, horizontally scrollable, active
  clip ringed `#2563eb`, trailing "+" affordance; a count line ("1 of 4 framed"). This uses the
  width the portrait thumbnails want and surfaces the Clips tab's content without a tap.
  **NEW SCOPE, not in the approved desktop design - droppable** if this task needs to stay tight;
  say so at classification rather than silently cutting it.
- **Focus: legible timeline lanes** (44 / 64 / 48 instead of 32 / 38 / 44). Targets were already
  legal; this is about being able to see and land on what you are dragging.
- **Header that clears the floor**: 56px tall, 44x44 back button, mode tabs in a 44px grouped
  segmented control at 12px type.

**Mobile tradeoffs (decisions, do not "fix"):** open, the drawer covers 316 of 390px, so a
spotlight is tuned against a 74px sliver of video (changes are live; close to review). A 16:9
source on a 390px phone tops out at 366x206 no matter the layout - only rotating or fullscreen
helps, and neither is in scope here. A bottom sheet was considered and rejected per direction
(horizontal expansion keeps the mental model identical to the desktop rail).

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
10. The mobile drawer opens from a 64px full-width labelled Settings row (not an edge sliver),
    slides in horizontally from the right (assert the drawer's `transform` before/after, not just
    presence), stops above the action band, and does not close on a tap outside it. Its close
    control is a 44x44 button in the drawer's own header.
11. On mobile, the aspect selector is reachable inside the drawer and is NOT also rendered above
    the video (exactly one instance, on every width). The Settings row's summary line reflects
    the current values and is derived, never a second stored copy.
12. Touch-target floor at 390x844 on both screens: the header back button, every mode tab, the
    Settings row, and every control inside the drawer are >=44px on a coarse pointer. Assert with
    `boundingBox()` over the actual set, not spot checks.
13. On Overlay at 390x844 the video stage is taller than the old 40vh cap would allow (the cap is
    gone); on Focus the 16:9 stage is width-bound and unchanged.
9. Export progress, failed/retry and the disabled reason all render in the band beside the CTA.

## Test scope (relevant set, ~10)

- `FocusModeView.mobileReachable.test.jsx`, `OverlayModeView.mobileReachable.test.jsx`
  (both will need updating - their meaning changes from "present" to "in viewport")
- `FocusModeView.aspectRatio.test.jsx`, `FocusModeView.mobileAspect.test.jsx`
- `OverlayModeView.aspectStage.test.jsx` (the T5676 geometry test - the stage row changes)
- `OverlaySettingsTabs.test.jsx`
- `FocusPublishActionBar.test.jsx`, `OverlayPublishActionBar.test.jsx`
- New: a rail collapse/expand unit test and a CTA-above-fold e2e spec at three desktop viewports
- New: a mobile drawer e2e at 390x844 (closed on load, Settings row opens it, slide asserted via
  `transform`, CTA box unchanged, no backdrop close) plus a touch-target sweep over the header,
  tabs, Settings row and drawer controls - run with coarse-pointer emulation, since `useIsMobile`
  also keys on `(hover: none) and (pointer: coarse)`
- `FocusModeView.mobileAspect.test.jsx` and any test asserting the Overlay `max-h-[40vh]` stage
  cap, which this task removes on the Overlay path
- Note the T5380 precedent: pointer/layout behaviour gets a REAL browser check, not jsdom alone.

## Suggested sequencing (three shippable steps)

1. **Action band.** Generalize T8790's sticky bar into the full-width band on both screens, CTA
   centered at final size, progress and reasons moved into it. Closes problem 1 on its own.
2. **Rail components.** Extract `SettingRow` / `SettingsPanel` / `SettingsRail`, port Overlay's
   existing rows onto them, fix the duplicate-tabs bug, unify the accent.
3. **Re-home Focus's settings.** Move the toolbar and the below-timeline card into the rail with
   the Reel / This clip / View only grouping; add the collapse behaviour to both screens.
4. **Mobile drawer + reclaimed space.** Below `lg`, render the same `SettingsRail` as the
   translateX drawer opened by the 64px Settings row, collapsed by default; delete Overlay's
   second (`lg:hidden mt-6`) settings render and Focus's above-video aspect selector, since both
   now live in the drawer. Same step: raise the header to 56px with 44px targets, drop Overlay's
   `max-h-[40vh]` stage cap, and grow the Focus timeline lanes. The Focus clip strip is the one
   droppable piece here.

## Notes for the implementor

- T9150 landed 2026-09-09 (PR #375) and is the baseline for the Overlay stage row: the rail
  reservation is now a cap on the stage COLUMN, `lg:max-w-[calc(100%-22rem)]` at
  `OverlayModeView.jsx:873`, not on the stage box (its Reviewer caught the `100vw`-vs-`100%`
  bug; read that commit, `869f7a16`, before touching the row). 22rem = 352px against this
  design's 300px rail plus its gap, so the numbers already line up.
- Overlay's mobile video cap is `VideoPlayer.jsx:197` (`max-h-[40vh] sm:max-h-none
  sm:min-h-[60vh]`). Removing it for the Overlay path is what buys the +62% stage area; check
  what the `sm:` branch does to tablets before deleting the whole expression, and keep Focus's
  behaviour (its 16:9 stage is width-bound, so the cap never binds there anyway).
- The mobile drawer is a `transform`, not a width change: never animate `width` on the phone
  path, and never let the drawer's presence alter the stage box (it is `position: absolute`
  inside the body region). The desktop rail is the opposite (in-flow width tween). Same
  component, two layout modes, switched on `useIsMobile()`.
- Do NOT add a `useEffect` that writes rail state anywhere. Gesture-based persistence rule; and
  this state is not persisted at all.
- Read `.claude/knowledge/keyframes-framing.md` before touching the Focus stage or timeline, and
  `.claude/references/ui-style-guide.md` for the row/chip anatomy. Add the settings-rail and
  action-band patterns to the style guide in the same PR (refactoring rule 5).

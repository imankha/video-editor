# T10840 Design: Focus on a landscape phone — the cockpit layout

**Status:** APPROVED (user, 2026-09-21)
**Scope:** Frontend only. No schema, no API, no new persistence path.
**Governs:** T10830, T10840, T10850 (the whole `focus-landscape` epic).
**Mockup artifact:** https://claude.ai/artifact/FMzKSFwwAKLsZ8hRJuzVCx
(6 artboards: Today / Proposed cockpit (interactive) / First-entry hint / Portrait nudge / Zones + budget / Clips sheet open)

---

## 1. Current state

### 1.1 There is no landscape handling on Focus

`useIsLandscape()` (`src/frontend/src/hooks/useIsMobile.js:49`, query
`(orientation: landscape) and (max-height: 500px)`) has exactly **two** consumers today, both in
Annotate: `screens/AnnotateScreen.jsx:77` and `modes/AnnotateModeView.jsx:266`. Focus, Overlay,
`FocusModeView`, `FocusTimeline`, `VideoPlayer` and `ActionBand` import `useIsMobile` only.

### 1.2 What a landscape phone actually gets: two breakpoint systems that disagree

Measured from the user's own staging screenshot (2026-09-21, Samsung 2340x1080 physical,
DPR 2.625, Chrome, rotated left):

| Band | CSS px |
|---|---|
| Glass | 891 x 411 |
| System status bar (top) | 22 |
| Browser address bar (bottom) | 55 |
| System nav bar (right edge) | 48 |
| Display cutout (left edge) | 31 |
| **Web viewport** | **812 x 334** |

At 812 px wide the screen clears Tailwind's `sm:` (min-width 640) while `useIsMobile()` is still
`true` (`max-width: 1023px`). Focus therefore renders **tablet CSS driven by phone JS**:

| Symptom | Source |
|---|---|
| A permanent 224 px clip rail appears, and the phone toggle that would dismiss it is CSS-hidden | `screens/FocusScreen.jsx:1392` — `{(hasClips && clips.length > 0) ? (<div className="hidden sm:flex"><ClipSelectorSidebar/></div>)` ; the mobile `{n} clips` toggle is `flex sm:hidden` at line ~1431. `ClipSelectorSidebar.jsx:175` is `w-56 bg-gray-900/95`. |
| Stage pinned to 60vh = 200 px | `components/VideoPlayer.jsx:202,219` — `max-h-[40vh] sm:max-h-none sm:min-h-[60vh]` and `.video-container` `h-[40vh] sm:h-[60vh]`. A **width** breakpoint setting a **height** quantity. |
| Action band 76 px, two near-empty equal-flex cells | `components/ActionBand.jsx:39` — `sm:flex-row sm:min-h-[76px]`. On the real screenshot the band renders ~90 px because the credit-rounding sentence wraps. |
| Page padding jumps | `App.jsx:1000` — `px-3 pt-4 pb-48 sm:px-4 sm:pt-8 sm:pb-8` |

Meanwhile `useIsMobile() === true` keeps the 40 px mobile `UnifiedHeader`, the mobile
`FocusTimeline` layer heights, `TimelineBase`'s `lg:hidden` 64 px scrub row, the 64 px
`mobile-settings-row` and the 55dvh bottom settings sheet.

### 1.3 Consequences, confirmed on the screenshot

1. **The crop box is cut off.** Only its bottom handles are on screen. The user is framing an
   athlete they cannot see.
2. **You cannot see the reticule and the framing timeline at once.** The core loop is
   *drag the box -> step along the timeline -> drag again*; every step needs a scroll, on the same
   surface that hosts the drag gesture.
3. **The 224 px rail (28% of the width) shows one clip row and a disabled `Transition:` control.**
4. **The action band takes ~90 px (27% of the viewport)**, most of it the sentence
   "6.5s of video - 6 credits - 1 credit per second, rounded to the nearest second."
5. The full stack is ~900 px of content in 334 px of viewport.

### 1.4 Pre-existing issues this design must not inherit

- `FocusMode` (the whole timeline block) is **already rendered twice** in
  `modes/FocusModeView.jsx` (lines ~670 and ~780) with ~30 duplicated props. A third call site
  would triple the prop-drilling surface. **T10830 extracts it first** (house rule: abstract on the
  3rd duplication; moves are mechanical commits).
- `useIsLandscape` lacks the `typeof window.matchMedia !== 'function'` guard that
  `useIsCoarsePointer` has (same file, line ~33). Harden it while widening its blast radius.

---

## 2. The core tension, and why landscape wins

The **output is 9:16**, the **device is landscape**, and — decisively — **the source footage is
16:9** (Veo sideline cameras). The user is framing a 9:16 window inside a wide field shot to find
one child. The reticule is height-bound in both orientations, so the metric that matters is
**displayed video height**.

| | video | 9:16 reticule | reticule area |
|---|---|---|---|
| Portrait 393 x 852 | 345 x 194 | 109 x 194 | 1.00x |
| Landscape today (812 x 334) | not visible in one screen | — | — |
| **Landscape, cockpit** | **494 x 278** | **156 x 278** | **2.05x** |

Landscape also makes the framing timeline native: a **572 px** scrub track instead of portrait's
~265 px (2.9 px/frame on a 6.5s clip at 30fps), and side sheets that leave the video on screen
while the aspect ratio changes — impossible with a bottom sheet on a 334 px viewport.

What it costs is every gram of stacked chrome. 334 px cannot carry header + instructions +
controls + timeline + disclosure + action row + settings row + action band. **The design moves
chrome off the scarce axis (height, 334) onto the abundant one (width, 812 — of which the reticule
needs 156).**

**Landscape Focus is not "the portrait screen, wider". It is a distinct precision layout:
full-bleed stage, edge rails, one horizontal timeline, zero scroll.**

---

## 3. Target state — the cockpit

### 3.1 Wireframe at 812 x 334

```
 |<--56-->|<------------------- 684 -------------------->|<--72-->|
 +--------+----------------------------------------------+--------+  -+-
 | [<]    |  Play 23 - at Beach FC Apr 26      Output 0:06|[Film]  |   |
 |        |                                               | Clips 3|   |
 |        |            +------------+                     |[Slid]  |   |
 | [<<]   |  b l a c k | 9:16 crop  |  b l a c k          | Setup  |  278
 | ( > )  |            | 156 x 278  |                     |[Undo]  |   |
 | [>>]   |  16:9 video|            |                     | Undo   |   |
 |        |  494 x 278 |            |                     |[Eye]   |   |
 |        |            +------------+                     | Preview|   |
 |        |                                               |        |   |
 |00:00:04|                                               | ~6 cr  |   |
 |   .976 |                                               |+------+|   |
 |        |                                               ||Gener.||   |
 |        +----------------------------------------------+|Framing||  -+-
 |        |[crop] ====o---<>-------<>-------<>--- [fork]  |+------+|   56
 +--------+----------------------------------------------+--------+  -+-
          |<-44->|<------- 572 track ------->|<-44->|
```

### 3.2 Regions

| Zone | Size | Contents | Notes |
|---|---|---|---|
| **Shell** | 812 x 334 (`h-dvh`) | — | Replaces the scrolling page entirely. **No scroll anywhere.** |
| **A - Transport rail** (left) | 56 x 334 | Back (top) / step-back + play + step-fwd (v-centered) / two-line mono timecode (bottom) | Left-thumb arc; play at the easiest point on the screen |
| **B - Stage** | 684 x 278 | `VideoPlayer fitToAspect` + `CropOverlay`; clip-name chip top-left; output chip top-right; transient export strip on the top edge | The only flexing region |
| **C - Timeline strip** | 684 x 56 | `[crop]` add-focus-point cap / 572 px scrub pill with keyframe diamonds + playhead / `[fork]` trim-and-slo-mo cap | **In flow, not floating** over the stage |
| **D - Action rail** (right) | 72 x 334 | Clips / Setup / Undo / Preview (4 x 44 px, top) then `~N cr` + compact CTA 64 x 60 (bottom) | Right-thumb arc; CTA in the best-reachable corner |
| **E - Side sheets** | 320 wide, full height, from the right | Clips / Setup / Trim and slo-mo | 364 px of stage stays visible |

Height check, action rail: `py-1.5` 12 + 4x44 + 3x2 gap = 194; CTA block 10 + 3 + 60 = 73 -> **267 of
322**. Transport rail: 44 + (44+6+52+6+44) + 26 = 222 of 322. Both comfortable.

### 3.3 Disposition of every element

| Element today | In the cockpit |
|---|---|
| Crop reticule + handles | **Visible, primary.** 156 x 278 |
| Framing timeline (crop keyframes) | **Visible, promoted.** 572 px track, its own strip |
| Playback controls (`Controls.jsx`) | **Moved to the left edge rail** |
| Primary CTA | **Moved to the bottom-right rail cell**, compact variant |
| Segment / speed / trim track | **Sheet only** (the `fork` cap) |
| Clip selector (`ClipSelectorSidebar`) | **Sheet only.** The `hidden sm:flex` rail is gated off |
| Settings (aspect, audio) | **Sheet only** — same `focusRailBody(false)` mobile subset |
| Credits explainer sentence | **Setup sheet.** Rail shows `~N cr` only |
| `FramingInstructions` | **Off the stage.** A "How framing works" row in the Setup sheet |
| `UnifiedHeader` / breadcrumb | **Gone.** Back chevron in the transport rail's top cell |
| Clip title + game name | Overlay chip, stage top-left, `bg-black/60` scrim |
| `OutputLengthChip` | Overlay chip, stage top-right |
| Export progress / failed-retry | Transient strip on the stage's top edge. Never permanent rail space |
| `mobile-settings-row` (64 px) | Replaced by the rail's Setup button |
| Zoom buttons | Gesture only (pinch) |
| Crop/View `touchMode` toggle | **Dropped** — gesture disambiguation replaces it (D11) |
| Technical readouts (dims/fps) | Dropped (already `hidden lg:flex`) |
| Red floating delete FAB on the keyframe track | Replaced by a popover above the strip (D10) |

---

## 4. Decision ledger

All settled. A worker implements these; it does not re-litigate them.

### D1 — Entry is a pure derivation, never stored state

```js
// hooks/useIsMobile.js
export function useIsCockpit() {
  return useIsMobile() && useIsLandscape();
}
```

No `useEffect`, no `useState`, no store field. Annotate's `useEffect` auto-enter
(`AnnotateModeView.jsx:339-348`) is precedent but adds a state that can desync when the user
rotates mid-drag; a pure derivation cannot. **Auto-enter on rotation is the approved behaviour**
(user ruling, 2026-09-21).

### D2 — One breakpoint source of truth: the JS hook. No new Tailwind variant.

The cockpit is a separate subtree rendered only when `useIsCockpit()` is true, so its markup needs
no responsive prefixes at all. A `short-landscape` Tailwind variant was considered and **rejected**:
it would duplicate `LANDSCAPE_QUERY` in `tailwind.config.js` where it can silently drift from
`hooks/useIsMobile.js`. Greppability beats a second definition.

### D3 — Two mount points, one derivation

- `screens/FocusScreen.jsx` gates the sidebar: `{!cockpit && hasClips && clips.length > 0 && (...)}`
  and likewise the `flex sm:hidden` mobile clips toggle.
- `modes/FocusModeView.jsx` early-returns `<FocusCockpit ... />` **above** the
  `bg-white/10 backdrop-blur-lg` card (line ~479), so no `backdrop-filter` ancestor exists over the
  sheets (the T10420 / T10820 containing-block trap).

### D4 — `hidden sm:flex` stays `sm:` outside the cockpit

Gating the sidebar off *inside* the cockpit branch only. Changing it to `lg:` globally would alter
portrait-tablet behaviour, which is out of scope and arguably correct as-is (a tablet has the
width). Recorded as a follow-up question, not done here.

### D5 — `max-height: 500px` threshold is unchanged

Covers 334 (this device) and 390 (iPhone 14/15 landscape). A landscape viewport 500-600 px tall
falls back to the existing scrolling layout, which is fine — it has the room.

### D6 — Sheets are `absolute` inside the shell, never `fixed`

`absolute inset-y-0 right-[72px] w-80`, `translateX` in. Scrim is `pointer-events-none` (no
backdrop-tap close — house rule, matches T10820); closed only by a 44x44 `X` in the sheet header.
The action rail sits above the scrim's z-index so the CTA is never dimmed, matching the existing
`ActionBand` contract.

**Bottom sheets are rejected here.** `MOBILE_PANEL_MAX_VH` 55dvh = 184 px of 334; it would cover the
stage *and* the strip, leaving a 94 px sliver. On a short viewport, drawers come from the side.

### D7 — `h-dvh`, and `env(safe-area-inset-*)` is load-bearing

Shell is `fixed inset-x-0 top-0 z-[100] h-dvh`, **never** `inset-0` / `h-screen` (T4880 iOS-toolbar
invariant), with `paddingLeft/Right/Bottom: env(safe-area-inset-*)`.

On iOS rotate-left the notch owns the **left 44 px, full height** — without the inset the play
button sits behind it. Pad **both** sides (`env()` resolves to 0 on the non-notch side) so the
layout does not jump when the phone is flipped. On this Android device the insets are 0 because
Chrome already excludes the system bars from the viewport; the browser address bar is covered by
`h-dvh`.

### D8 — The CTA's neighbour is the system Back button

On Android landscape the nav bar abuts the right edge. Keep the action rail's `px-1` padding so a
missed tap lands on padding, not on Back.

### D9 — `PrimaryCta` gains a `compact` variant; no new component

Same `data-testid="primary-cta"`, same accent tokens, a second size (64 x 60, icon + two 10 px
lines). The T9270 box-invariance rule is scoped **per variant**: the compact box must be
byte-identical regardless of sheet state, exactly as the full box is regardless of rail state.

### D10 — Timeline strip interactions

| Gesture | Result |
|---|---|
| Tap the pill | Seek |
| Drag the pill | Scrub. Pointer Events + `setPointerCapture(e.pointerId)` + `touch-none`; `pointermove/up/cancel` on `window` filtered by `pointerId` (shared T5450 pattern) |
| **Long-press then drag** | **Jog mode, movement / 4.** This replaces timeline zoom, which has nowhere to put a readout |
| Drag a diamond | Move that focus point in time -> `move_crop_keyframe` |
| **Tap a diamond** | Seek to it **and select it** -> popover **above** the strip with Copy / Delete (the existing `KeyframeMarker` actions). This replaces today's free-floating red delete FAB, which overlaps the track |
| Tap `[crop]` left cap | Add a focus point at the playhead |
| Tap `[fork]` right cap | Open the Trim and slo-mo sheet |

- **No timeline zoom in the cockpit.** 572 px covers the common case; jog covers the tail.
- Marker positioning keeps the shared formula
  `left: calc(${EDGE_PADDING}px + (100% - ${EDGE_PADDING * 2}px) * ${pct})`
  (`components/timeline/TimelineBase.jsx:114`, `EDGE_PADDING = 20`). **Never a bare `%`.**
- Diamonds are 13 px visual and need a 44 px transparent hit box (an `absolute -inset-4` child),
  the same treatment `RegionLayer`'s `leverHitWidth` already gives coarse pointers.

### D11 — Stage gestures; the `touchMode` toggle is dropped

| Gesture | Result |
|---|---|
| 1-finger drag **inside** the reticule | Move the focus point. Unchanged path: `onCropComplete` -> `resolveTargetFrame` -> `addOrUpdateKeyframe` + `persistKeyframeEdit` |
| 1-finger drag on a **corner handle** | Resize. Handles already ship 12 px visual / 44 px touch via `::after` (`CropOverlay.jsx:651`) |
| 1-finger drag **outside** the reticule | Pan when `zoom > 1`; otherwise **nothing**. Explicitly not play/pause — an accidental play mid-framing is the worst misfire here |
| **2-finger pinch** | Inspection zoom. Unambiguous (1 finger = frame, 2 fingers = inspect), so the crop/view mode button is not needed |
| Double-tap / long-press on the stage | **Nothing.** Play is one thumb-width away; long-press belongs to the timeline |

### D12 — Rotating mid-drag must not write a partial keyframe

A layout change during a drag fires `pointercancel`. `CropOverlay` must treat `pointercancel` as
**abandon the drag, keep the last committed keyframe** — no `onCropComplete`, no persist. This is
the one behavioural change T10840 makes to `CropOverlay` beyond props.

### D13 — Resolved open questions

| Question | Ruling |
|---|---|
| Strip auto-expands to the segment/speed lane when a clip already has splits? | **No. Sheet only.** 334 px cannot afford another 40; T9950's disclosure already teaches users where advanced editing lives. |
| CTA also has a "Back to Preview" state (T10650 `deriveFramingCtaState`) | **Two 10 px lines in the same 64 x 60 box:** "Back to" / "Preview". No rail widening. |
| 3+ clips: a persistent filmstrip on the stage's top edge? | **No. Sheet only in v1.** A filmstrip costs 56 px of stage height. Revisit after real use. |
| Move the credit-rounding sentence? | **Setup sheet.** Rail shows `~N cr`; the sheet carries cost, balance and the rounding note. |

### D14 — Hint persistence is written on a gesture, never on render

Two hints, two `localStorage` keys. **Neither is written when the hint appears** — that would be
reactive persistence. Both are written by a named gesture:

| Hint | Key | Shown when | Written on |
|---|---|---|---|
| Portrait nudge (a dismissible bar under the stage: "Turn sideways for a bigger frame") | `rb.focus.rotateNudgeDismissed` | `isMobile && !isLandscape && !dismissed && clip has no crop keyframes yet` | the X tap |
| Landscape first-entry card (over the stage, with rings on Play and Generate) | `rb.focus.cockpitIntroSeen` | `cockpit && !seen` | the "Got it" tap, **or** the first `pointerdown` on the stage |

`localStorage` only — this is a per-device UI preference, not user data; it never reaches the
backend and needs no sync. Both reads are lazy `useState` initializers (not effects).

### D15 — The completion preview is untouched

`FocusScreen.jsx:1555` renders `previewOpen && <CollectionPlayer ... actionBar={<FocusPublishActionBar/>}>`
as a **full-surface sibling** of the editor. It already covers the cockpit, already has transport
controls (T10680) and already lays out in horizontal rows on phones (T10670). The cockpit needs no
special case; its job ends when the export fires.

### D16 — `VideoPlayer` needs no new prop

`fitToAspect` already means "fill the parent, `object-contain`" (`VideoPlayer.jsx:202,219`), which
is exactly right for a fixed-box stage. `CropOverlay` keeps `chromeHidden` (T9950) and stays
**mounted** during preview — unmounting it would clear the rotation and silently un-straighten the
preview.

---

## 5. File plan

### New files

| File | Purpose |
|---|---|
| `src/frontend/src/modes/focus/cockpit/FocusCockpit.jsx` | The shell: safe-area padding, the 3-column flex, sheet host |
| `src/frontend/src/modes/focus/cockpit/TransportRail.jsx` | Zone A |
| `src/frontend/src/modes/focus/cockpit/ActionRail.jsx` | Zone D, incl. `RailButton` and the compact CTA cell |
| `src/frontend/src/modes/focus/cockpit/CockpitTimelineStrip.jsx` | Zone C |
| `src/frontend/src/modes/focus/cockpit/CockpitSheet.jsx` | Zone E shell (header + X + scrollable body) |
| `src/frontend/src/modes/focus/cockpit/CockpitIntroCard.jsx` | D14 first-entry hint |
| `src/frontend/src/modes/focus/RotateNudge.jsx` | D14 portrait nudge |
| `src/frontend/src/modes/focus/FocusTimelineBlock.jsx` | **T10830** — the extracted twice-rendered block |

### Modified files

| File | Change |
|---|---|
| `src/frontend/src/hooks/useIsMobile.js` | Add `useIsCockpit()`; harden `useIsLandscape`'s matchMedia guard |
| `src/frontend/src/modes/FocusModeView.jsx` | T10830: two call sites -> `<FocusTimelineBlock/>`. T10840: early return to `<FocusCockpit/>`. T10850: mount `<RotateNudge/>` |
| `src/frontend/src/screens/FocusScreen.jsx` | Gate the sidebar + mobile clips toggle on `!cockpit` |
| `src/frontend/src/modes/focus/overlays/CropOverlay.jsx` | D12 `pointercancel` handling |
| `src/frontend/src/components/PrimaryCta.jsx` | D9 `compact` variant |
| `src/frontend/src/config/displayNames.js` | Hint copy + rail labels |

### Explicitly NOT modified

`VideoPlayer.jsx` (D16), `ActionBand.jsx` (not rendered in the cockpit), `TimelineBase.jsx`,
`ClipSelectorSidebar.jsx` (reused verbatim inside the Clips sheet), any backend file.

---

## 6. Named Tailwind strings

Tokens from `.claude/references/ui-style-guide.md`: `gray-900` `#111827`, `gray-800` `#1f2937`,
`gray-700` `#374151`, rail surface `#0f172a`, Focus accent `#2563eb`, play `#a855f7` (matches the
shipped `Controls` play button), keyframe diamonds `#3b82f6`, crop cap `#fbbf24`, trim cap
`#c084fc`. Lucide icons throughout, never emoji.

### Shell

```jsx
<div
  data-testid="focus-cockpit"
  className="fixed inset-x-0 top-0 z-[100] h-dvh flex overflow-hidden bg-black"
  style={{
    paddingLeft:   'env(safe-area-inset-left)',
    paddingRight:  'env(safe-area-inset-right)',
    paddingBottom: 'env(safe-area-inset-bottom)',
  }}
>
```

### A - Transport rail

```jsx
<div data-testid="cockpit-transport"
     className="flex w-14 flex-none flex-col items-center justify-between
                border-r border-gray-700 bg-gray-900 py-1.5">
```
Back / step buttons: `flex h-11 w-11 items-center justify-center rounded-lg text-gray-300 hover:bg-white/10 transition-colors`
Play: `flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[#a855f7] text-white shadow-lg shadow-purple-500/40 active:bg-purple-400`
Timecode: two stacked spans, `font-mono tabular-nums text-xs text-gray-300` over `text-[10px] text-gray-400` (`00:00:04` / `.976` — full precision preserved in a 56 px rail).

### B - Stage

```jsx
<div data-testid="cockpit-stage" className="relative flex min-w-0 flex-1 flex-col">
  <div className="relative min-h-0 flex-1 bg-black">   {/* VideoPlayer + CropOverlay */}
```
Chips: `pointer-events-none absolute left-2 top-2 max-w-[55%] truncate rounded bg-black/65 px-2 py-1 text-xs text-gray-200`
Transient export strip: `absolute inset-x-0 top-0 z-20 flex h-7 items-center justify-center bg-black/70 text-xs text-gray-200`

### C - Timeline strip

```jsx
<div data-testid="cockpit-timeline"
     className="flex h-14 flex-none items-center gap-2 border-t border-gray-700 bg-gray-900 px-1">
```
Caps: `flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-gray-800 active:bg-gray-700 transition-colors` (+ `text-amber-400` / `text-purple-400`)
Track: `relative h-9 min-w-0 flex-1 touch-none select-none rounded-full bg-gray-800`
Diamond: `absolute top-1/2 h-[13px] w-[13px] -translate-x-1/2 -translate-y-1/2 rotate-45 border border-white bg-blue-500` + `<span aria-hidden className="absolute -inset-4"/>`

### D - Action rail

```jsx
<div data-testid="cockpit-actions"
     className="flex w-[72px] flex-none flex-col items-center justify-between
                border-l border-gray-700 bg-[#0f172a] px-1 py-1.5 relative z-50">
```
`RailButton`: `flex h-11 w-16 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors disabled:opacity-40` + active `bg-blue-600/20 text-blue-300`, idle `text-gray-400 hover:bg-white/10`
Compact CTA: `flex h-[60px] w-16 flex-col items-center justify-center gap-0.5 rounded-[10px] text-white active:opacity-95 disabled:opacity-50 disabled:shadow-none` with the `PrimaryCta` accent + shadow.

### E - Side sheet

```jsx
<div aria-hidden className={`pointer-events-none absolute inset-y-0 left-14 right-[72px] z-30
                             bg-black/45 transition-opacity duration-300
                             ${open ? 'opacity-100' : 'opacity-0'}`} />

<div data-testid="cockpit-sheet" role="dialog" aria-label={title} aria-hidden={!open}
     className={`absolute inset-y-0 right-[72px] z-40 flex w-80 flex-col
                 border-l border-gray-700 bg-[#0f172a] ${open ? '' : 'pointer-events-none'}`}
     style={{
       boxShadow: '-12px 0 32px rgba(0,0,0,0.5)',
       transform: open ? 'translateX(0)' : 'translateX(100%)',
       visibility: open ? 'visible' : 'hidden',
       transition: open
         ? 'transform 320ms cubic-bezier(0.2,0.8,0.2,1)'
         : 'transform 320ms cubic-bezier(0.2,0.8,0.2,1), visibility 0s linear 320ms',
     }}>
```

---

## 7. Touch ergonomics (the rules the layout encodes)

Two-handed landscape grip, both thumbs anchored near the bottom corners. On 812 x 334 CSS px at
DPR 2.625 (~146 x 60 mm of glass) each thumb's comfortable sweep is roughly the outer ~130 px
column and the lower ~200 px, easiest at each bottom corner.

| Zone | Assignment |
|---|---|
| Left edge, mid-height | **Play/pause** — the highest-frequency tap, at the easiest point |
| Bottom-right corner | **Primary CTA** |
| Right edge, upper | Clips / Setup / Undo / Preview |
| Bottom strip, outer thirds | Timeline caps |
| Bottom strip, centre | Scrub track — fine, it is a drag, not a precision tap |
| **Top centre** | **Passive only**: clip name, output chip, transient export status. Never a control |

**44 x 44 minimum everywhere**, explicit (`h-11 w-11`) — do not rely on the `coarse-pointer:`
variant; the cockpit is coarse by definition.

---

## 8. Test plan

### Unit (Vitest) — the relevant set, ~10 files

| File | Covers |
|---|---|
| `hooks/__tests__/useIsCockpit.test.js` (new) | derivation truth table; matchMedia-missing guard |
| `modes/focus/cockpit/__tests__/FocusCockpit.test.jsx` (new) | renders all 4 zones; no scroll container; sheets are `absolute` not `fixed`; safe-area padding present |
| `modes/focus/cockpit/__tests__/CockpitTimelineStrip.test.jsx` (new) | diamond hit box >= 44; `calc(EDGE_PADDING...)` formula, never a bare `%`; tap-diamond opens the Copy/Delete popover |
| `modes/focus/cockpit/__tests__/ActionRail.test.jsx` (new) | 4 rail buttons + CTA; `data-testid="primary-cta"` present; CTA not dimmed while a sheet is open |
| `modes/focus/__tests__/RotateNudge.test.jsx` (new) | shown only with no keyframes + not dismissed; X writes the key; render alone writes nothing |
| `modes/focus/cockpit/__tests__/CockpitIntroCard.test.jsx` (new) | "Got it" and first stage `pointerdown` both write the key; render alone does not |
| `modes/FocusModeView.test.jsx` / `.framingActionRow` / `.advancedEditing` | **must stay byte-identical** — jsdom's `matchMedia` returns `matches: false`, so `useIsCockpit()` is false and every existing test takes the unchanged path |
| `modes/focus/FocusTimeline.test.jsx`, `FramingActionRow.test.jsx` | T10830 regression: extraction changed nothing |
| `components/CropOverlay.test.jsx` | D12 `pointercancel` abandons without persisting; `chromeHidden` block unchanged |
| `components/PrimaryCta.test.jsx` | compact variant box-invariance |

**No existing test should need editing.** If one does, that is a signal the branch leaked into the
portrait path — stop and re-check.

### E2E (Playwright)

`e2e/T10840-focus-landscape-cockpit.qa.spec.js` at **812 x 334** and **844 x 390**:
1. Focus opens with no vertical scrollbar (`document.scrollingElement.scrollHeight <= clientHeight`).
2. The reticule and the timeline strip are both in the viewport simultaneously.
3. The clip sidebar is absent; the Clips rail button opens a sheet with the same rows.
4. Every interactive element has a >= 44 px hit box.
5. Rotating to 393 x 852 restores the scrolling layout with no console error and no lost keyframe.

Reuse `screens/__tests__/focusScreenStaleClipGuard.test.jsx` as the render harness for anything
that must mount the real `FocusScreen` — it is the only existing harness that does, and rebuilding
its mock set is wasted work.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **Safe-area insets forgotten -> play button behind the iOS notch** | The single most likely shipping bug. Unit test asserts the padding style; E2E cannot catch it (no notch in headless) — real-device iOS check is **owed** before the task is called done |
| A `backdrop-filter` ancestor reappears above the shell | D3 puts the early return above the blur card; unit test asserts the sheet's offset parent |
| The branch leaks into portrait | Existing `FocusModeView` tests must stay byte-identical (section 8) |
| Rotating mid-drag writes a partial keyframe | D12 |
| Jog mode (long-press + drag) conflicts with the diamond long-press | Long-press on the **track** = jog; long-press on a **diamond** is not used (tap selects instead, D10) |
| 9:16 source footage | A phone-shot 9:16 source at 278 tall is 156 wide, so landscape buys nothing for it. Not a blocker — the layout still beats the broken hybrid — but worth a data check before investing further (deferred, section 10) |

---

## 10. Deliberately deferred

- Whether `hidden sm:flex` should become `hidden lg:flex` globally (D4).
- What share of real source footage is already 9:16 — decides whether auto-entry deserves a
  smarter heuristic.
- Applying the cockpit to **Overlay**, which has the same short-viewport problem. Out of scope;
  file a sibling task once Focus is proven on staging.
- Landscape viewports 500-600 px tall (D5).

---

## 11. Rejected alternatives

| Rejected | Why |
|---|---|
| "Please rotate to portrait" prompt | A refusal, not a design. Landscape genuinely delivers 2.05x the reticule area |
| Scale the portrait layout down | ~900 px of content into 278 px is a 0.31x scale; every touch target lands near 14 px, three times under the floor |
| Reuse the existing `mobileFs` expand mode | `mobileFs` deliberately hides the CTA and every below-timeline control — that *was* the T4880 bug. It is a **viewing** mode; landscape needs an **editing** mode where the CTA and timeline are permanent |
| Bottom sheet for settings (the T10820 pattern) | 55dvh = 184 px of 334; covers the stage *and* the strip (D6) |
| Keep `ActionBand` as a full-width bottom bar | ~90 px = 27% of the scarce axis for one button and a rounding sentence. The rail costs 72 px of the abundant axis (8.9%) |
| Float the timeline strip over the stage's bottom edge | Recovers 56 px but hides the reticule's bottom resize handle — the crop box is height-bound, so that handle is exactly what the thumb reaches for |
| Horizontal-scrolling chrome row under the stage | Banned by the style guide: never `flex-nowrap` + `overflow-x-auto` on an action row |
| Split screen: source \| live output preview | 684 / 2 = 342 each, barely better than portrait; and T9950 established the output preview is a **re-framing of the same player**, not a second one |
| `useEffect` auto-enter (Annotate's precedent) | Adds state that can desync on rotate-mid-drag (D1) |
| Floating FABs for Undo/Preview over the stage | They collide with the reticule at exactly its width. The rail is collision-free by construction |
| A `short-landscape` Tailwind variant | Duplicates `LANDSCAPE_QUERY` where it can drift (D2) |

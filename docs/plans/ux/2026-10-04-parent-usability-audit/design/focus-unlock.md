# Design Proposal: Unlocking Generate on Frame Highlight (DRAFT)

Status: DRAFT, design-gated. Nothing implemented.

## Existing patterns found
- Cockpit "add focus point at playhead": `modes/focus/cockpit/FocusCockpit.jsx:135-143` calls `onCropComplete({x,y,width,height})` from `currentCropState`. The button is an amber `Plus` (`CockpitTimelineStrip.jsx:146-155`), label `FOCUS_COCKPIT.ADD_FOCUS_POINT` = "Add focus point". Amber is already this app's focus-point color.
- Secondary editor button: `FramingActionRow.jsx:27-31` (`rounded-lg border px-3 py-2 text-sm font-medium coarse-pointer:min-h-11`, idle `border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700`).
- Tinted hint bar: `RotateNudge.jsx:52` (`rounded-lg border border-blue-500/40 bg-blue-500/10 px-3 py-2`).
- Disabled reason: `ExportButtonView.jsx:150-158`, `text-xs text-amber-400` + `AlertCircle`, hardcoded string.
- ActionBand: `ActionBand.jsx:39`. Below `sm:` it stacks status, CTA and cost in a column. Sticky wrapper `FocusModeView.jsx:998` also anchors the mobile SettingsRail (`absolute bottom-full`, T10820).

## Issues identified
1. **Stale empty hint** (`CropLayer.jsx:120`): `visibleKeyframes.length === 2 && !isEndKeyframeExplicit` comes from the old permanent-boundary model, so with 0 keyframes nothing shows. Fix as part of this task.
2. **The disabled caption is hardcoded** in the view, not in `displayNames.js`, which breaks the T9550 single-source rule. Move it as part of this task.
3. **The instructions never name the gesture.** "Each spot you set" doesn't say how to set one.
4. **The preview line says "follows your athlete"**, which edges toward a tracking claim. Reword it.
5. **The rotate nudge's "nothing scrolls"** is false while portrait overflows horizontally (separate overflow finding; fix that first).
6. **Mixed nouns** ("athlete", "player", and "child" in the audit). New strings below use "your player", which matches `STAGE_REASONS.FRAMING`.

---

## Part 1: Options for unlocking Generate

### Option A: Teach the drag (gate unchanged)
**Desktop:** while `focusPointCount === 0`, the stage shows:
- A pulsing ring on the crop box: `ring-2 ring-amber-400/70 animate-pulse motion-reduce:animate-none rounded-sm`.
- A coach chip at stage top-center: `absolute top-2 left-1/2 -translate-x-1/2 pointer-events-none flex items-center gap-1.5 whitespace-nowrap rounded-full border border-amber-400/60 bg-gray-900/90 px-3 py-1 text-xs font-medium text-amber-100 shadow-lg`, with a `Move` icon (14) and the copy **"Drag the box onto your player"**.

The chip is hidden while dragging and while playing. The band caption becomes **"Drag the box onto your player to set a focus point"**.

After the first release, ring and chip disappear (derived from the count, no state), a diamond appears on the timeline, Generate enables, and the caption is gone.

**390 portrait:** same chip, anchored to the stage top (not to the box, which is about 70px wide). The caption wraps to 2 lines in the stacked band.

- **Pros:** smallest change. No new write path. The T8510 gate is fully intact.
- **Cons:** still depends on a drag, and drag on a small box on touch is the weakest gesture. A parent who thinks "it's already on my kid" has no button to confirm that. The audit tester explicitly looked for a button.
- **Credit-burn risk:** none.
- **Effort:** about 4 files, about 110 LOC including tests (`CropOverlay`/stage, `ExportButtonView`, `displayNames.js`, `CropLayer.jsx`).
- **How to implement:** pass `focusPointCount` to the crop overlay and render the chip and ring when it is 0 and `!isDragging && !isPlaying`. Move the caption into `displayNames` as `FOCUS_HINTS.GENERATE_LOCKED`.

### Option B: Explicit "Set focus point" button on all layouts (gate unchanged)
**Desktop:** a new first button in `FramingActionRow`, left of "Preview highlight", under the stage.
- **0 points:** label **"Set focus point"**, icon `Plus` (16), amber call-to-attention style: `flex items-center gap-1.5 rounded-lg border border-amber-500/60 bg-amber-500/15 px-3 py-2 text-sm font-medium text-amber-100 hover:bg-amber-500/25 coarse-pointer:min-h-11`. Tooltip: "Sets a focus point using the box where it is now".
- **1+ points:** label **"Add focus point"** (same string as the cockpit), demoted to the gray secondary style.
- **On click:** an inline `Check` (14) with `text-xs text-green-400` and **"Focus point set at 0:02"** sits beside the button for about 2.5s. This is ephemeral state set inside the click handler, not a `useEffect`, and the copy deliberately says "set", never "saved".
- **Band caption:** **"Move the box onto your player, then tap Set focus point"**.

**390 portrait:** the button sits directly under the stage, above RotateNudge, full-width (`w-full justify-center`, 44px tall). The confirmation renders as one centered line under it.

- **Pros:** one obvious tap that always works, also for a parent whose child is already inside the box. It reuses the cockpit's exact write path (`onCropComplete(currentCropState)` to `handleCropComplete` to surgical `add_crop_keyframe`), so it creates no second write path. It also makes portrait, desktop and landscape cockpit match.
- **Cons:** a parent can tap it without moving the box. On its own it doesn't teach dragging, which is the gesture they need for focus point 2 and later.
- **Credit-burn risk:** low to moderate. The untouched centered box can be confirmed with one deliberate tap. That is still a conscious gesture after reading "Move the box onto your player", which is unlike T8510's zero-interaction export. Accept the risk, and watch the share of exports whose only keyframe matches the default centered crop.
- **Effort:** about 5 files, about 170 LOC including tests (`FramingActionRow.jsx`, `FocusModeView.jsx`, `FocusContainer`/screen wiring, `displayNames.js`, `ExportButtonView.jsx`).
- **How to implement:** copy `addFocusPointAtPlayhead` from FocusCockpit (or lift it into FocusScreen and pass it to both). Pass `onAddFocusPoint` and `focusPointCount` into `FramingActionRow`. Add the strings `FOCUS_EDITOR.SET_FOCUS_POINT`, `ADD_FOCUS_POINT` and `FOCUS_POINT_SET_AT`.

### Option C: Allow Generate with the untouched box behind an inline confirm
**Desktop:** Generate stays enabled. The first click on an unframed clip swaps the band status cell to an amber inline confirm:
- **"Your player may not be in the frame. Generate with the centered box for ~8 credits?"**
- Buttons: **"Generate anyway"**, ghost `text-amber-300 underline`, and **"Frame it first"**, secondary gray, which scrolls to the stage and focuses it.

**390:** the same confirm stacks above the CTA.

- **Pros:** never a dead end.
- **Cons:** it partially reverses T8510, which the user approved on 2026-09-03 after a real 12-credit burn. The confirm also asks a question that most parents will skip past.
- **Credit-burn risk:** high. This is exactly the failure T8510 closed.
- **Effort:** about 4 files, about 150 LOC, plus rewriting T8510 tests and a decision record.
- **How to implement:** add `confirmUnframed` state in `ExportButtonContainer`, change the 1021-1034 gate to "confirm-required", and render the confirm in `ExportButtonView`.

### Option D: A + B combined (recommended)
- **Button:** the B button on all layouts.
- **Coach chip:** the A chip, with copy that covers both paths, **"Drag the box onto your player"**. The chip stays short. The button below is self-labeled.
- **Ring:** the pulsing ring on the box, shown only at 0 points.
- **Caption:** the B caption.
- **Timeline hint:** fixed (see Part 3).

After the first point, everything instructional disappears. The button becomes the gray "Add focus point", the diamond shows, and Generate enables.

- **Effort:** about 7 files, about 250 LOC. It splits cleanly into two M tasks: B first, then A's chip/ring.
- **Credit-burn risk:** same as B.

## Recommendation: D (ship B first, then A)
- **The gate stays.** The T8510 rationale is real, and C undoes it in exchange for a confirm dialog that people click through.
- **B turns the dead end into an obvious affordance.** It has the single write path the cockpit already uses, and it covers the dominant "the box is already on my kid" belief seen in both audits.
- **A teaches the gesture they need from focus point 2 onward.** That is where framing quality actually comes from.
- **Watch the default-crop exports.** If the share of exports whose only keyframe is the default centered crop climbs, add a soft tooltip on the 0-point button ("Move the box first so your player is inside it"). Don't remove the button.

---

## Part 2: iPhone sticky ActionBand while disabled

Today, at 390px and while disabled, the band holds a caption, a 44px CTA and a cost line, with padding, for about 130-160px. It covers the timeline, "Trim and slo-mo" and the settings row.

### Option 1: Compact one-line status row while locked (recommended)
Below `sm:` and while `hasUnframedClips`, the band renders as a single row: `flex items-center gap-2 px-3 py-2`, about 52px.
- **Left:** `AlertCircle` (14), `text-xs text-amber-400 flex-1 min-w-0`, **"Set a focus point to unlock Generate"**.
- **Right:** a small disabled pill, `h-9 rounded-lg px-3 text-sm font-medium bg-blue-900/50 text-blue-300/60`, label **"Generate"**.
- The cost line is hidden until unlocked.

When the first point lands, the full stacked band returns. Its growth reads as the unlock moment.

- **Pros:** frees about 90px. The sticky wrapper stays, so the SettingsRail anchoring (T10820) keeps working.
- **Cons:** the CTA changes size between states. T9270's "never resizes" rule is about rail/drawer state, not lock state, but it needs an explicit exception noted in the style guide.

### Option 2: Non-sticky until framed
Use `sticky` only when unlocked, and let the band sit at page end while locked.
- **Pros:** nothing is covered.
- **Cons:** the mobile SettingsRail is `absolute bottom-full` inside this wrapper, so it would open at the page bottom, off-screen. The locked reason also leaves the viewport, which hides the instruction that matters most. Rejected unless the rail is re-anchored.

### Option 3: Collapse to the CTA only
Drop the caption and cost lines under `sm:` while locked. The reason moves into the disabled button label: **"Set a focus point first"**.
- **Pros:** about 60px, minimal code.
- **Cons:** a disabled button carrying instructions is low contrast, and it loses the amber reason color.

**Recommendation: Option 1.** Separately, the portrait horizontal overflow (iPhone #12/#13) must be fixed for any of these to read well. That is a separate task.

---

## Part 3: Revised copy (no em dashes; all strings go into `displayNames.js`)

**FramingInstructions** (`FramingInstructions.jsx:59-87`)
- Header (expanded): "Frame your player"
- Headline (`STAGE_REASONS.FRAMING`, unchanged): "Focus the action on your player, crop out everything else."
- Steps paragraph: "Drag the box onto your player. Letting go sets a focus point at that moment in the video. If your player is already inside the box, tap Set focus point."
- Second paragraph: "Play the video and drag the box again whenever your player moves out of it. Your highlight moves smoothly between the focus points you set."
- Third paragraph: "Use Trim and slo-mo to slow down the key moment."
- Preview prompt: "Press play to preview your framing before you generate."

**Disabled caption** (band status cell, desktop and stacked mobile): "Move the box onto your player, then tap Set focus point". With Part 2 Option 1, the compact mobile row uses: "Set a focus point to unlock Generate".

**Empty-timeline hint** (CropLayer). Show it when the clip has 0 crop keyframes (condition `visibleKeyframes.length === 0`, which matches the flat-list keyframe model). Copy: "No focus points yet. Drag the box on the video to add one." Keep "Keep your athlete in frame" out of this state. The `CropLayer.test.jsx:100` expectation needs updating.

**Button and confirmation**
- 0 points: "Set focus point"
- 1+ points: "Add focus point"
- Confirmation: "Focus point set at {m:ss}"
- Tooltip: "Sets a focus point using the box where it is now"

**Coach chip:** "Drag the box onto your player"

**Rotate nudge** (`FOCUS_HINTS`)
- `ROTATE_TITLE`: "Optional: rotate your phone for a larger video"
- `ROTATE_SUBTITLE`: "Everything here also works upright"

This subtitle is only true once the portrait overflow is fixed. Ship it together with, or after, that fix. Also order the stage stack as: Set focus point button, then RotateNudge. The nudge's 0-point condition then competes less with the unlock action.

## Consistency notes
- The button reuses the cockpit's amber `Plus` and "Add focus point" string, so all three layouts now share one affordance and one write path.
- The amber tint ties the caption, button, ring and chip together as "the thing to do next". Blue stays reserved for the Generate CTA (one saturated element).
- No copy claims automatic framing, tracking, centering or following. The only motion claim is "moves smoothly between the focus points you set".
- No new state is persisted on load or mount. The chip, ring and hint are all derived from `focusPointCount`. The confirmation is ephemeral and set inside the click handler.
- Implementation should update `.claude/references/ui-style-guide.md` with the "locked-band compact row" exception and the "amber = next framing action" pattern once approved.

# Focus + Overlay: Settings Unification and Above-the-Fold CTA (design spec)

**Status:** DRAFT, awaiting product-owner pick of an option. Design only; no code changed, no PLAN.md entry created.
**Author:** UI Designer agent, 2026-09-08
**Scope:** `FocusModeView`, `OverlayModeView`, their settings/toolbar/export sub-components, and the shared style guide. The post-export preview footers (`FocusPublishActionBar`, `OverlayPublishActionBar`) are OUT of scope: they render inside the `CollectionPlayer` modal after an export completes and are unaffected by every option below.

---

## 0. The two problems, restated with numbers

Both problems are visible in the class names alone. The figures below are derived from the Tailwind classes in the current source (not measured in a browser yet; the implementing task must confirm them with Playwright `boundingBox()` at 1440x1250, 1440x900 and 1366x768 before and after).

### 0.1 Where the primary CTA lands today

Shell (both screens, `App.jsx:961-997`): `flex-1 overflow-auto` scroll container, then `container mx-auto px-4 pt-8`. At 1440px wide the Tailwind `container` is 1280px. Focus subtracts the `w-56` clip sidebar (224px) and the editor card's `p-6`, leaving a ~976px stage column.

| Focus (single clip, no split) | px | Overlay | px |
|---|---|---|---|
| `pt-8` | 32 | `pt-8` | 32 |
| `UnifiedHeader` + `mb-8` | ~72 | same | ~72 |
| metadata card `p-4` + `mb-4` | ~92 | same | ~92 |
| editor card `p-6` top | 24 | same | 24 |
| controls bar (aspect chips ~56px) + `mb-6` | ~80 | zoom bar (~40px) + `mb-6` | ~64 |
| stage: 976px wide, 16:9 source | ~549 | stage `lg:h-[70vh]` at 1250 | 875 |
| transport `Controls` | ~48 | same | ~48 |
| timeline `mt-6` + `6.5rem` | 128 | `mt-6` + `6.5rem`..`8.5rem` | 128..160 |
| export section `mt-6` | 24 | `mt-6` | 24 |
| "Focus Settings" card (audio row + copy) | ~160 | none | 0 |
| `space-y-3` + `Button size="lg"` | ~60 | button | ~48 |
| **CTA bottom edge** | **~1270** | **CTA bottom edge** | **~1410..1440** |

Add `+84` for a Focus clip with a speed split (`11.75rem` timeline) and `+36` for the multi-clip "Total output" row: ~1390. On a 1250px-tall viewport the Focus Export button is at or just past the fold in the best case and ~140px past it in the common case; the Overlay CTA is 160-190px past it. On a 900px laptop both are 300-500px past the fold. The Overlay number is dominated by one class, `lg:h-[70vh]` (`OverlayModeView.jsx:373`); the Focus number is dominated by the stack of vertical chrome (toolbar, timeline, settings card) that sits between the stage and the button.

The codebase already knows this is a problem: `FocusModeView.jsx:78-85` (T8790) pins the export section `sticky bottom-0 z-30 bg-gray-900/95 backdrop-blur-sm` on phones and deliberately resets it to normal flow at `lg:`. `OverlayModeView` has no equivalent at any width. The two `*.mobileReachable.test.jsx` files (T4880) pin only that the export control is RENDERED on mobile; nothing pins that it is VISIBLE on first paint at any width.

### 0.2 Two settings idioms

Focus: a horizontal toolbar strip above the stage (`FocusModeView.jsx:360-413`) holding a mix of a persistent reel setting (aspect ratio) and view-only tools (dim switch, Straighten toggle, zoom stepper), PLUS a "Focus Settings" card below the timeline inside `ExportButtonView` (`ExportButtonView.jsx:85-112`) holding the Audio toggle and explainer copy.

Overlay: a right-hand tabbed card (`OverlaySettingsTabs` -> `OverlaySettingsCard` / `TextManagementPanel` / `ThumbnailPanel`) using a stacked label + sublabel + control row idiom, PLUS a floating zoom stepper above the stage (`OverlayModeView.jsx:814-826`) with nothing else in that bar.

The row idiom in `OverlaySettingsCard` is already good and already reused by the Audio row in `ExportButtonView` (same `text-sm font-medium text-gray-200` label, `text-xs text-gray-400` sublabel, `flex items-center justify-between`). The unification below promotes that idiom to the system and gives every Focus control a home under it.

---

## 1. Current state: control inventory

Categories used throughout:

- **P-reel**: persistent, reel/project level (one value for all clips).
- **P-clip**: persistent, per working clip.
- **P-element**: persistent, per overlay text element / region.
- **X**: export option (changes the rendered output; held in a store, sent with the export request, not a per-clip datum).
- **V**: view-only preference. Local `useState` or view-store field, NEVER persisted (project rule: no persisted view state).
- **A**: one-shot action.
- **R**: read-only readout.

### 1.1 Focus

| # | Control | Where today | Control type | Cat. | Write path (if persistent) | Notes |
|---|---|---|---|---|---|---|
| F1 | Reel aspect ratio 9:16 / 16:9 | Toolbar strip, left (`AspectRatioSelector`), rendered at EVERY width (T7130) | Two icon+label chips, purple selected ring | P-reel | `POST /projects/{id}/aspect-ratio` (server re-fits every clip's crop, T3910) | Must stay rendered once, interactive, never inside a `hidden` ancestor (`FocusModeView.mobileAspect.test.jsx`) |
| F2 | Background Dim / Dark | Toolbar strip, right cluster (`hidden lg:flex`) | Hand-rolled switch with inline hex colors (`#2563eb` / `#4b5563`) | V | none (`dimOpacity` local state) | Not the shared `Toggle`; flagged in 1.3 |
| F3 | Straighten (reveal) | Toolbar strip, right cluster | Pressed-state button, `RotateCw` | V | none (`straightenVisible` local state, T5641) | Reveals F4 on the stage |
| F4 | Straighten dial: -0.1, slider, +0.1, readout, reset | Stage-anchored floating pill at `bottom-2` of the video (`CropOverlay.jsx:697-765`) | Nudge buttons, `range` slider, mono readout, reset | Value is P-clip; dial is A | `set_rotation` surgical action via `useCrop.setRotation` -> `clampRotation` | Stage tool by nature (line-drag on the video). Stays on the stage in every option |
| F5 | Zoom - / % / + / reset | Toolbar strip, right cluster (`ZoomControls`) | Stepper in its own bordered pill with "Zoom:" label | V | none (`useZoom`) | Also wheel-zoom on the stage |
| F6 | Fullscreen | Transport `Controls` bar (right end) | Icon button | V | none | Gated by `useFullscreenWorthwhile`; mobile has a separate expand button on the stage |
| F7 | Timeline layer select (Video / Crop / Segments) | Timeline label column | Click-to-select rows | V | none | Stays on the timeline; not a "setting" |
| F8 | Segment speed / split / trim | Timeline segment lane | Timeline affordances | P-clip | `set_segment_speed`, `split_segment`, `set_trim_range` | Stays on the timeline (editing, not settings) |
| F9 | Audio include | "Focus Settings" card below the timeline (`ExportButtonView`) | Shared `Toggle` (purple) | X | `focusStore.includeAudio`, sent with export | Only Focus has it; Overlay forces `includeAudio=true` |
| F10 | Export explainer copy | Same card | Static text | R | none | "Builds your reel: applies your follow-focus crop..." |
| F11 | Output length chip / Total output chip | Metadata card (desktop) or under video (mobile); Total above the export section (multi-clip) | Chip | R | none | T5780; derived, never persisted |
| F12 | Export Focused Video + credit estimate + unframed caption + progress/error/success | Bottom of the editor card; `sticky bottom-0` below `lg` only (T8790) | `Button variant="primary" size="lg" fullWidth` | A (CTA) | export request | THE primary CTA |
| F13 | Clip transition (multi-clip) | `ClipSelectorSidebar` (`w-56`, `hidden sm:flex`) | Sidebar control | P-reel | `setGlobalTransition` | Lives in the sidebar, not the settings surface; only Option B relocates it |
| F14 | Touch mode Crop / Pan | Mobile-fullscreen only (stage corner) | Icon button | V | none | Unchanged by every option |

### 1.2 Overlay

| # | Control | Where today | Control type | Cat. | Write path | Notes |
|---|---|---|---|---|---|---|
| O1 | Zoom - / % / + / reset | Floating bar above the stage, `hidden lg:flex`, `ml-auto` | `ZoomControls` pill | V | none | The only thing in that bar |
| O2 | Fullscreen | Transport `Controls` | Icon button | V | none | Same as F6 |
| O3 | Play spotlight / Play full (loop mode) | Transport `Controls` (`secondaryPlay`) | Icon buttons | V | none | T5370; transport, not settings |
| O4 | Tab: Spotlight / Text / Thumbnail | Right card header (`OverlaySettingsTabs`) | Tabs, `border-cyan-400` active underline, dimmed-but-clickable Text tab | V | none (`activeTab` local state) | Constant measured body height (T6630 r6); testids `overlay-tab-*`, `overlay-tabpanel-*` |
| O5 | Highlight Color | Spotlight tab, row 1 | Swatch row (`w-6 h-6`, 44px coarse hit) | P-reel | `setHighlightColor` action | Always shown; disabled when no region |
| O6 | Shape Body / Ground | Spotlight tab | Segmented buttons, `bg-blue-600` selected | P-reel | `setHighlightShape` | Shown only when a region exists |
| O7 | Stroke Width 1..3px | Spotlight tab | `range` slider `w-24 accent-blue-500` | P-reel | `setStrokeWidth` | same |
| O8 | Fill 0..40% | Spotlight tab | slider | P-reel | `setFillOpacity` + `setFillEnabled` | same; one gesture, two actions |
| O9 | Outside Dim 0..40% | Spotlight tab | slider | P-reel | `setDimStrength` + `setEffectType` | same |
| O10 | Text regions at playhead: expand, select, delete region | Text tab left column | Tree rows | P-element (delete) / V (expand, select) | `deleteRegion` | Region CREATE lives on the timeline lane only |
| O11 | + Add text (element), per-element eye, delete | Text tab left column | Icon buttons | P-element | `createText`, `toggleElement`, `deleteElement` | |
| O12 | Text spec editor (text, font, size, color, align, position grid, ...) | Text tab right column (`TextSpecEditor`, `PositionPresetGrid`) | Inputs, segmented, grid | P-element | `updateElementSpec` | Fixed-position column so adding rows never moves it |
| O13 | Thumbnail readout + preview | Thumbnail tab | `PosterFramePreview` + caption | R | none | Frame is set ONLY by dragging the timeline marker (T6590) |
| O14 | Use a frame instead | Thumbnail tab (only when a custom upload is in use) | Small button | A | `removeUpload` | |
| O15 | Text layer show / hide | Timeline label column (`Type` icon with red slash) | Lane-label toggle | V | none (`textLayerHidden`) | Distinct from per-element eye (O11) |
| O16 | Player boxes show / hide | Timeline label column (`Crosshair`, green / gray + slash) | Lane-label toggle | V | none (`showPlayerBoxes`) | Also gates spotlight editability (T5610) |
| O17 | Re-run Focus (framing outdated) | Amber banner above the metadata card | Button | A | navigation | Contextual, unchanged |
| O18 | Add Overlay + progress/error/success | Bottom of editor card, normal flow at every width | `Button variant="primary" size="lg" fullWidth` | A (CTA) | export request | THE primary CTA. Label reads "Add Overlay" while the tab was renamed "Spotlight" (T7710) and Focus's post-export copy says "Add Spotlight"; flagged in 1.3 |

### 1.3 Issues found (fix or explicitly defer in the chosen option)

| Issue | Where | Problem | Recommendation |
|---|---|---|---|
| Hand-rolled switch with inline hex colors | `FocusModeView.jsx:376-386` (F2) | Duplicates `shared/Button.jsx` `Toggle`; magic colors `#2563eb`/`#4b5563`; no `role="switch"` | Replace with `Toggle size="sm"` (fix in this work) |
| Settings tabs rendered TWICE | `OverlayModeView.jsx:871-873` (`hidden lg:block`) and `:1091-1095` (`lg:hidden`) | Two live instances of `OverlaySettingsTabs`, each with its own `bodyHeight` state, and two `TextManagementPanel` instances with independent `expandOverrides`. `FocusPublishActionBar`'s doc comment already bans this pattern ("ONE DOM instance per choice, no duplicate mobile/desktop trees") | Render the settings panel ONCE and place it with CSS (grid areas / `order`), same as the approach the action bars use (fix in this work; all three options need it) |
| Four accent colors for "selected" | Aspect chips purple ring; segmented rows `bg-blue-600`; tabs `border-cyan-400`; `Button primary` purple | Style guide names `bg-blue-600` as Active/Selected and `blue-500` as primary, but `Button` primary is purple. Nothing tells the user which color means what | Settings rows: selected = `bg-blue-600 text-white` (matches existing rows + style guide). Tabs: keep `border-cyan-400` (cyan already means "reel / thumbnail" in this app). CTA: `Button variant="primary"` purple, unchanged. The aspect chips move to a blue-selected segmented row and drop the purple ring. Record in the style guide |
| CTA label drift | `ExportButtonView.jsx:150` "Add Overlay" vs tab "Spotlight" (T7710) vs `FOCUS_PUBLISH.ADD_SPOTLIGHT_LABEL` | Same feature, three names | Rename the Overlay CTA to "Add Spotlight" in `displayNames.js` (copy change, S-tier, can ride along) |
| Sticky bar resets at `lg` | `FocusModeView.jsx:85` | The one shipped fix for the CTA problem was scoped to phones by design ("shared DESKTOP editor layout is byte-unchanged"). The product owner is now asking for the desktop fix | Option A reverses that decision deliberately; call it out in the task file |
| Zoom pill duplicates the label | `ZoomControls.jsx:25` "Zoom:" + `%` readout | Label is redundant with the readout and the icons | Drop the text label when the stepper moves into the stage toolbar |
| Card chrome mismatch | Editor/metadata cards `bg-white/10 backdrop-blur-lg border-white/20`; settings `bg-gray-900/85` or `bg-gray-800/50` | Three surface treatments in one screen | Settings panel adopts ONE chrome (2.3). The outer editor cards are out of scope; note in the style guide as known debt |

---

## 2. The unified settings system

### 2.1 Regions

Four named regions, identical on Focus and Overlay. The region a control lives in is decided by its CATEGORY from section 1, never by which screen it is on.

```
+----------------------------------------------------------------------+
| UnifiedHeader (mode switcher)                                         |
+----------------------------------------------------------------------+
| [metadata card]                                                       |
| +------------------------------------------------------------------+ |
| | STAGE TOOLBAR      view-only tools that affect the whole stage    | |
| | +--------------------------------------------------------------+ | |
| | | STAGE (video + overlays + stage-anchored tools)              | | |
| | +--------------------------------------------------------------+ | |
| | | transport Controls (play, step, loop, fullscreen)            | | |
| | +--------------------------------------------------------------+ | |
| | TIMELINE           lane labels keep lane-scoped view toggles     | |
| |                                                                  | |
| | SETTINGS RAIL      persistent settings + export options          | |
| |                    (placement varies by option, chrome does not) | |
| |                                                                  | |
| | ACTION BAR         primary CTA + its captions/progress/errors    | |
| +------------------------------------------------------------------+ |
+----------------------------------------------------------------------+
```

| Region | Rule: what goes here | Focus contents | Overlay contents |
|---|---|---|---|
| **Stage toolbar** | Category V controls whose scope is the WHOLE stage image. Icon-first, compact, `hidden lg:flex` for precision-pointer tools (as today) | Zoom stepper (F5), Background dim (F2), Straighten reveal (F3) | Zoom stepper (O1) |
| **Stage-anchored tools** | Category A editing tools that need the video under the pointer | Straighten dial (F4), crop reticle | Spotlight circle levers, text drag, detection boxes |
| **Timeline lane labels** | Category V toggles whose scope is ONE lane | layer select (F7) | Text layer hide (O15), Player boxes (O16), layer select |
| **Settings rail** | Categories P-reel, P-clip, P-element, X, plus their R readouts. Sectioned or tabbed. One instance in the DOM | Reel format (F1), Audio (F9), explainer (F10) | Spotlight (O5-O9), Text (O10-O12), Thumbnail (O13-O14) |
| **Action bar** | The single primary CTA and everything that explains its state: credit estimate, unframed caption, progress, disconnected/error/success panels | F12 (+ F11 Total chip when multi-clip) | O18 |
| **Transport** | Playback only | F6 | O2, O3 |

Two rules make this a system rather than a relayout:

1. **A control's region follows its category, so a new control has exactly one legal home.** A future "Export at 60fps" is X, so it is a rail row. A future "Show safe-area guides" is V and stage-wide, so it is a toolbar icon. A future per-lane "mute" is V and lane-scoped, so it is a lane label.
2. **The rail's CHROME and ROW pattern never vary; only its PLACEMENT does**, and placement is decided per option below (not per screen ad hoc).

### 2.2 The one control row: `SettingRow`

A single presentational component used by every rail row on both screens. It is the existing `OverlaySettingsCard` row, named and made reusable.

```jsx
// src/frontend/src/components/settings/SettingRow.jsx  (proposed)
<div
  data-testid={`setting-row-${id}`}
  className="flex items-center justify-between gap-4 py-1.5 coarse-pointer:min-h-11"
>
  <div className="flex flex-col min-w-0">
    <span className="text-sm font-medium text-gray-200">{label}</span>
    {sublabel && <span className="text-xs text-gray-400 truncate">{sublabel}</span>}
  </div>
  <div className="flex items-center gap-1.5 shrink-0">{children /* the control */}</div>
</div>
```

- **Label** is the noun (`Reel format`, `Audio`, `Shape`). **Sublabel** is the current value in words (`9:16 Portrait`, `Include audio in export`, `Ground spotlight`) or a unit readout (`3px`, `20%`). Style guide rule "label the noun a value measures" applies.
- Rows stack with `space-y-1` inside a section; sections are separated by `border-t border-gray-700 pt-3 mt-3` with an optional section header `text-[11px] font-medium text-gray-500 uppercase tracking-wide` (the style guide's borderless filter-row label).
- **Disabled** rows: `opacity-50` on the control only, sublabel explains why (`Add a spotlight on the timeline to tune it`). Absent features are ABSENT, not disabled (Overlay has no Audio row).

Approved control vocabulary for the right-hand slot (all already in the codebase):

| Kind | Component / classes | Used by |
|---|---|---|
| Segmented 2-4 choices | buttons `px-2.5 py-1 rounded text-xs font-medium`, selected `bg-blue-600 text-white`, rest `bg-gray-700 text-gray-300 hover:bg-gray-600`, `coarse-pointer:min-h-11` | Shape (O6), Reel format (F1, chips keep their `w-4 h-6` / `w-6 h-4` rectangle glyph inside) |
| Slider | `<input type="range" className="w-24 accent-blue-500">` + sublabel readout | O7, O8, O9 |
| Switch | `Toggle size="sm"` from `shared/Button.jsx` (purple accent, `role="switch"`) | Audio (F9), Background dim if it ever moves to the rail |
| Swatches | existing 24px circle swatches with 44px coarse hit area | O5 |
| Stepper | `Button variant="secondary" size="sm" iconOnly` pair around a `font-mono text-sm` readout | Zoom (toolbar only) |
| Small action | `px-2.5 py-1 rounded text-xs font-medium bg-gray-700 text-gray-300 hover:bg-gray-600` | O14 |

### 2.3 Panel chrome: `SettingsPanel`

One card wrapper for the rail, derived from `OverlaySettingsTabs` (keeps its hard-won behavior) and used by Focus too:

```jsx
<div data-testid="settings-panel" className="bg-gray-900/85 backdrop-blur-lg rounded-lg border border-gray-700 overflow-hidden">
  {tabs && (
    <div role="tablist" className="flex border-b border-gray-700">
      {/* tab: flex-1 flex items-center justify-center gap-1.5 px-2 py-2.5 text-sm font-medium border-b-2 -mb-px coarse-pointer:min-h-11
          active: border-cyan-400 text-white bg-white/5
          rest:   border-transparent text-gray-400 hover:text-gray-200
          dimmed: border-transparent text-gray-600 opacity-50 (STILL clickable, never disabled / aria-disabled) */}
    </div>
  )}
  <div role="tabpanel" className="p-3 lg:p-4 overflow-y-auto" style={{ height: measuredBodyPx }}>
    {/* SettingRows */}
  </div>
</div>
```

Invariants carried over from `OverlaySettingsTabs` (all pinned by `OverlaySettingsTabs.test.jsx`, keep the testids `overlay-settings-tabs`, `overlay-tab-{id}`, `overlay-tabpanel-{id}` as aliases or update the tests in the same commit):

- Body height is measured ONCE on mount and on window resize, clamped `[416, 768]`, never on content change (0px reflow when a text block is selected).
- Dimmed tabs stay clickable; no `disabled`, no `aria-disabled`.
- Thumbnail tab icon is always `text-cyan-400`.
- Tab labels: Spotlight / Text / Thumbnail.

When a screen has no tabs (Focus), the tablist is omitted and the body is `h-auto` (there is no constant-height requirement because nothing swaps inside it).

### 2.4 Stage toolbar idiom: `StageToolbar`

Style-guide "Toolbar items `px-2 py-1` gap-1" applied literally:

```jsx
<div className="flex items-center gap-1 bg-gray-800 border border-gray-700 rounded-lg px-2 py-1" role="toolbar" aria-label="View tools">
  <Button variant="ghost" size="sm" iconOnly icon={ZoomOut} title="Zoom out (scroll down)" />
  <span className="min-w-[3.5rem] text-center text-sm font-mono text-white">{pct}%</span>
  <Button variant="ghost" size="sm" iconOnly icon={ZoomIn}  title="Zoom in (scroll up)" />
  {isZoomed && <Button variant="primary" size="sm" iconOnly icon={Maximize2} title="Reset to 100%" />}
  <span className="mx-1 h-5 w-px bg-gray-700" aria-hidden="true" />
  <Button variant="ghost" size="sm" iconOnly icon={SunDim}   aria-pressed={dark}       title="Darken area outside the crop" className={dark ? 'bg-blue-600 text-white' : ''} />
  <Button variant="ghost" size="sm" iconOnly icon={RotateCw} aria-pressed={straighten} title="Straighten: level tilted footage" className={straighten ? 'bg-blue-600 text-white' : ''} />
</div>
```

- Pressed state is `bg-blue-600 text-white` + `aria-pressed`, the same selected color as rail rows.
- Every icon button carries `title` AND `aria-label` (icon-only rule).
- Focus and Overlay render the SAME component with different children; Overlay passes only the zoom group.
- Stays `hidden lg:flex` (precision-pointer tools) exactly as today; the reel aspect ratio is no longer in this bar, so nothing here needs to be reachable on phones.

### 2.5 Action bar idiom: `EditorActionBar`

Wraps `ExportButtonView` (unchanged internals: button, credit estimate, unframed caption, progress, error, success) in ONE wrapper used by both screens:

```jsx
<div data-testid="editor-action-bar" className={`${placementClasses} bg-gray-900/95 backdrop-blur-sm border-t border-gray-800 px-3 py-2 sm:px-4`}>
  {children /* optional leading readouts, e.g. the multi-clip Total chip */}
  <ExportButtonView ... />
</div>
```

`placementClasses` is the ONLY thing that differs between options (sticky footer vs rail bottom vs header). Do not name it `*PublishActionBar`; those two components are the post-export preview footers and must stay distinct.

Landmines to carry into the implementation (from T8790's own comments): pin with `sticky` against the `flex-1 overflow-auto` scroll container, NOT `fixed`, because the editor card's `backdrop-blur-lg` creates a containing block that traps `fixed` children mid-screen. Give the content under a sticky bar bottom padding equal to the bar height so the last row of the timeline is never permanently hidden.

---

## 3. Layout options

All three options adopt sections 2.2-2.5 (same rows, same panel chrome, same toolbar, same action-bar wrapper) and fix the issues in 1.3. They differ in WHERE the rail and the action bar live, which is what decides whether the CTA is above the fold.

### Option A: Pinned action bar + rail placed by stage aspect

**Strategy.** Keep the vertical single-column editor. Make the action bar a `sticky bottom-0` footer at EVERY width (extend T8790's phone fix to desktop). Cap stage heights so the timeline also tends to be above the fold. The rail sits beside the stage when the stage is portrait (Overlay, where T5676 already reclaimed pillarbox width for it) and below the timeline as a compact multi-column card when the stage is landscape (Focus, whose 16:9 source video would shrink to ~370px tall if a 320px rail sat beside it).

**Desktop wireframe (1440x1250).**

```
Focus                                              Overlay
+--------+---------------------------------------+   +-----------------------------------------------+
| clips  | [meta card]                           |   | [meta card]                                   |
| w-56   | +-----------------------------------+ |   | +-------------------------------------------+ |
|        | | TOOLBAR (right): zoom | dim | str  | |   | | TOOLBAR (right): zoom                     | |
|        | | +-------------------------------+ | |   | | +-------------+ +-----------------------+ | |
|        | | | STAGE 16:9, w-full            | | |   | | | STAGE 9:16  | | RAIL (tabs)           | | |
|        | | | max-h 56vh                    | | |   | | | h 60vh      | | Spotlight|Text|Thumb  | | |
|        | | +-------------------------------+ | |   | | |             | | rows...               | | |
|        | | | transport                     | | |   | | +-------------+ |                       | | |
|        | | | TIMELINE                      | | |   | | | transport   | |                       | | |
|        | | +-------------------------------+ | |   | | +-------------+ +-----------------------+ | |
|        | | RAIL (no tabs, 3 cols):           | |   | | TIMELINE                                  | |
|        | | Reel format | Audio | Output      | |   | |                                           | |
|        | +-----------------------------------+ |   | +-------------------------------------------+ |
|        | ~~ ACTION BAR sticky bottom-0 ~~~~~~~ |   | ~~ ACTION BAR sticky bottom-0 ~~~~~~~~~~~~~~ |
+--------+---------------------------------------+   +-----------------------------------------------+
```

**Where the CTA lives and why it is above the fold.** `EditorActionBar` with `sticky bottom-0 z-30` inside the `flex-1 overflow-auto` shell, at every width. Sticky positioning makes the bar's visibility independent of page length: it is on screen on first paint at 1250, 900 and 768 tall, and stays there while the user scrolls the timeline. Height ~64px (`py-2` + `Button size="lg"`); progress/error/success panels expand the bar upward when present (they already render inside `ExportButtonView`). This is the guarantee-by-construction option.

**Secondary fold improvements.** Overlay stage `lg:h-[70vh]` -> `lg:h-[60vh]` (tunable; the rail beside it measures its own body height to the viewport bottom already). Focus stage gets `lg:max-h-[56vh]` with `object-contain` so a very wide window does not push the timeline down (today it is purely width-bound).

**Narrow / laptop viewport.** Below `lg` (1023px, which is also `useIsMobile`'s width query): everything stacks in document order (toolbar hidden as today, stage, transport, timeline, rail, then the sticky bar), which is exactly T8790's shipped phone layout, now on both screens. At `lg`..`xl` laptops (1024-1366 wide, 700-900 tall): the sticky bar is the whole point; the timeline may start below the fold on a 768px-tall laptop and is one scroll away, with the CTA never leaving the screen.

**Focus mapping.** Toolbar: F5, F2 (as `Toggle`/icon), F3. Stage: F4. Rail (below timeline, `grid grid-cols-1 sm:grid-cols-3 gap-x-6`): F1 as a segmented `SettingRow` "Reel format" (rendered ONCE, at every width, satisfying T7130 and `mobileAspect.test`), F9 "Audio", and F11's Total chip as a read-only row when multi-clip. F10 explainer becomes the rail's footer caption. Action bar: F12.

**Overlay mapping.** Toolbar: O1. Rail (beside stage, single DOM instance placed with `lg:grid lg:grid-cols-[auto_minmax(0,1fr)]`): O4-O14 unchanged in content. Lane labels: O15, O16 unchanged. Action bar: O18 (relabeled "Add Spotlight").

**Tradeoffs (what gets worse).**
- ~64px of permanent vertical real estate is spent on the bar on every viewport, including tall ones that did not need it.
- Focus's persistent settings sit BELOW the timeline, below the fold on laptops. Acceptable because they are set-once values (reel format, audio) but the aspect chips lose their top-of-page prominence that T7130 fought for on phones (they remain reachable and interactive, just one scroll down on small screens).
- The Focus and Overlay rails end up in different places (below vs beside). The chrome is identical and the placement rule is stated, but a user switching modes sees the settings move.
- The sticky bar overlays the bottom of the timeline until the user scrolls; needs `pb-20` on the card body and a QA check that the segment lane's bottom handles are not covered at rest on 768px-tall viewports.
- Reverses T8790's explicit "desktop byte-unchanged" decision; every desktop e2e that measures the export section's position needs re-baselining (`T5676-aspect-stage-alignment.qa.spec.js` measures stage geometry and should be unaffected, but run it).

**Files / components.**

| Change | Files |
|---|---|
| New shared presentational components | `components/settings/SettingRow.jsx`, `components/settings/SettingsPanel.jsx` (absorbs `OverlaySettingsTabs.jsx` behavior; that file becomes a thin re-export or is deleted with its testids moved), `components/settings/StageToolbar.jsx`, `components/EditorActionBar.jsx` |
| Focus | `modes/FocusModeView.jsx` (toolbar -> `StageToolbar`; delete hand-rolled switch; render `FocusSettingsPanel` below the timeline; wrap `ExportButtonSection` in `EditorActionBar` sticky at all widths; `lg:max-h-[56vh]` stage), new `components/focus/FocusSettingsPanel.jsx` (Reel format + Audio + Total rows), `components/AspectRatioSelector.jsx` (segmented-row variant, blue selected), `components/ExportButtonView.jsx` (delete the `isFramingMode` "Focus Settings" block; keep the button + captions) |
| Overlay | `modes/OverlayModeView.jsx` (single rail instance placed by CSS; zoom -> `StageToolbar`; `EditorActionBar`; `60vh`), `components/OverlaySettingsCard.jsx` (rows -> `SettingRow`, output byte-similar), `components/ZoomControls.jsx` (restyle or fold into `StageToolbar`) |
| Copy | `config/displayNames.js` ("Add Spotlight") |
| Tests to update | `FocusModeView.mobileReachable/mobileAspect/aspectRatio.test.jsx` (selector now inside the rail; still one instance, still no `hidden` ancestor), `OverlayModeView.mobileReachable/aspectStage/textTabPlayhead/thumbnailMarkerClick.test.jsx` (single settings instance), `OverlaySettingsTabs.test.jsx` (-> `SettingsPanel.test.jsx`), `ExportButtonView.test.jsx:254` ("Focus Settings names the follow-your-athlete crop feature" moves to `FocusSettingsPanel.test.jsx`), `AspectRatioSelector.test.jsx` |
| Tests to add | `EditorActionBar.test.jsx` (sticky classes present at all widths; renders `ExportButtonView`), real-browser `e2e/focus-overlay-cta-above-fold.qa.spec.js`: at 1440x1250, 1440x900, 1366x768 the CTA's `boundingBox().y + height <= viewportHeight` on first paint for BOTH screens, and the segment lane's bottom edge is not under the bar at rest |
| Style guide | `.claude/references/ui-style-guide.md`: new "Settings system" section (regions, `SettingRow`, `SettingsPanel`, `StageToolbar`, `EditorActionBar`, accent rule), changelog row |

**Tier.** **L** as one task (new shared pattern, ~12 files, both screens). Strongly recommended split into three sequenced M tasks so each lands independently and reviewably: **A1** `EditorActionBar` sticky at all widths on both screens + the above-fold e2e (this alone solves Problem 1; ~4 files); **A2** `SettingRow` + `SettingsPanel` extraction, Overlay single-instance rail, Focus `FocusSettingsPanel` with Audio moved out of `ExportButtonView`; **A3** `StageToolbar` + Focus toolbar re-home (aspect into the rail, dim -> `Toggle`, zoom restyle) + style-guide update. A1 is M; A2 and A3 are M each (new pattern justifies a Reviewer; no Architect needed once this spec is approved).

### Option B: Left workbench rail (clips + settings + CTA in one viewport-height column)

**Strategy.** Turn the existing Focus clip sidebar (`ClipSelectorSidebar`, `w-56`) into a shared left **rail** used by BOTH screens: a `lg:sticky lg:top-4 lg:h-[calc(100vh-6rem)] flex flex-col` column whose top is tabs (Focus: Clips | Settings; Overlay: Spotlight | Text | Thumbnail), whose body scrolls, and whose BOTTOM is the `EditorActionBar` (`mt-auto`). The stage + transport + timeline own the remaining width at full height. The CTA is above the fold because the rail is exactly one viewport tall and the bar is pinned to its bottom edge; nothing about the page's scroll length can move it. Overlay's right column disappears (its content moves left), so its portrait stage centers in the remaining width.

**Desktop wireframe (1440x1250).**

```
Focus                                                 Overlay
+-----------+------------------------------------+    +-----------+------------------------------------+
| RAIL w-72 | [meta card]                        |    | RAIL w-72 | [meta card]                        |
| Clips|Set | +--------------------------------+ |    | Spot|Txt|T| +--------------------------------+ |
|-----------| | TOOLBAR: zoom | dim | straighten| |    |-----------| | TOOLBAR: zoom                  | |
| clip 1    | | +----------------------------+ | |    | Color  oo | |        +-------------+         | |
| clip 2 *  | | | STAGE 16:9, w-full         | | |    | Shape [B] | |        | STAGE 9:16  |         | |
| clip 3    | | | (~888px wide, ~500 tall)   | | |    | Stroke -- | |        | h 60vh      |         | |
| + add     | | +----------------------------+ | |    | Fill   -- | |        |             |         | |
| transition| | | transport                  | | |    | Dim    -- | |        +-------------+         | |
|           | | | TIMELINE                   | | |    |           | |        | transport   |         | |
| (Settings | | +----------------------------+ | |    |           | | TIMELINE                       | |
|  tab:     | +--------------------------------+ |    |           | |                                | |
|  Reel fmt |                                    |    |           | +--------------------------------+ |
|  Audio)   |                                    |    |           |                                    |
|-----------|                                    |    |-----------|                                    |
| ACTION BAR|  <- pinned to rail bottom          |    | ACTION BAR|                                    |
+-----------+------------------------------------+    +-----------+------------------------------------+
```

**Where the CTA lives and why it is above the fold.** Bottom of a sticky, viewport-height left rail. At 1250 tall the bar's top edge is at ~1250 - 16 - 64 = 1170px, always visible; at 768 tall it is at ~690px, always visible. The rail body (`overflow-y-auto`) absorbs any content growth, so neither a long clip list nor the Text tab's tree can push the bar off screen. No overlap with the timeline ever, because the bar is in a different column.

**Narrow / laptop viewport.** Below `lg`: the rail collapses to the existing mobile pattern, generalized: a top row with a `List` button ("N clips") and a `Settings` button that open the rail as a left drawer (`fixed inset-0 z-50 flex sm:hidden` already exists for clips in `FocusScreen.jsx:1252-1268`), and the action bar falls back to Option A's sticky footer. Between `lg` and `xl` (1024-1279 wide) the rail narrows to `w-64` and tab labels drop to icons + `title`.

**Focus mapping.** Rail tab "Clips": today's `ClipSelectorSidebar` body (clip tiles, add, reorder, F13 transition). Rail tab "Settings": F1 Reel format, F9 Audio, F11 Total (read-only). Toolbar: F5, F2, F3. Stage: F4. Rail bottom: F12. Stage width at 1440: 1280 - 32 - 288 (rail) - 24 (gap) - 48 (card padding) = ~888px -> 16:9 video ~500px tall (today ~549px; a 9% reduction, versus ~35% if the rail sat on the right in addition to the sidebar).

**Overlay mapping.** Rail tabs: O4 with O5-O14 inside (unchanged content). Rail bottom: O18. Toolbar: O1. Lane labels: O15, O16. Stage centered at `lg:h-[60vh]` in the main column. Overlay gains a left column it never had; there is no clip list to show (a working video is one asset), so the rail is settings + CTA only. If a multi-clip reel's clip list is ever wanted on Overlay for navigation, the tab already has a home.

**Tradeoffs (what gets worse).**
- Biggest structural change: `FocusScreen.jsx` layout (`flex h-full` sidebar + main), `ClipSelectorSidebar` refactor into a tab body, and a brand-new column on Overlay. Touches the mobile sidebar drawer and every e2e that clicks clip tiles.
- Focus stage loses ~9% height on 1440-wide monitors (~549 -> ~500px) and more on 1280-wide ones (rail `w-64` at 1024-1279 leaves a ~650px stage, ~365px tall). Precision crop dragging gets harder on small laptops; a collapsible rail (`w-12` icon strip) mitigates but adds state and a fourth layout stage.
- Overlay's rail is far from the spotlight it tunes (left edge vs a centered stage), whereas today the card is adjacent to the video. Slider-to-preview eye travel roughly doubles.
- A viewport-height sticky column inside `flex-1 overflow-auto` needs `align-self: flex-start` and a known top offset; the metadata card above the stage is in the other column, so the rail's top aligns with the header, not the stage. Minor visual asymmetry.
- Tabs on Focus put the clip list and settings behind a click from each other; today both are visible at once (sidebar + toolbar chips).
- `OverlayModeView.aspectStage.test.jsx` and `e2e/T5676-aspect-stage-alignment.qa.spec.js` encode the right-column geometry (`lg:w-fit`, `lg:h-[70vh]`, settings in the reclaimed pillarbox); they must be rewritten, not just re-baselined.

**Files / components.** Everything in Option A's shared list, plus: new `components/EditorRail.jsx` (sticky column: tabs, scrolling body, `EditorActionBar` at `mt-auto`), `components/ClipSelectorSidebar.jsx` (extract the list body from the `w-56` shell so it can be a tab panel; keep the mobile drawer), `screens/FocusScreen.jsx` (layout + mobile drawer generalization; the rail needs `exportButtonRef`, clips props and settings props, so the screen composes it, not the view), `screens/OverlayScreen.jsx` (compose the rail; pass settings + export props to it instead of to `OverlayModeView`), `modes/FocusModeView.jsx` and `modes/OverlayModeView.jsx` (remove inline export section and settings; keep stage/toolbar/timeline), `containers/ExportButtonContainer.jsx` unchanged (the bar still hosts `ExportButtonView`). Tests: all of Option A's plus `ClipSelectorSidebar*.test.jsx`, `FocusModeView.mobileReachable/OverlayModeView.mobileReachable` (the export control moves OUT of the mode views into the rail; these two tests must be re-pointed at the screen or at `EditorRail`, otherwise they fail by design), the e2e clip-selection flows, and a rewritten `T5676` geometry spec.

**Tier.** **L**, not splittable below L for the rail introduction itself (schema-free, but 3+ layers of the frontend, 15+ files, new abstraction, geometry-sensitive e2e rewrites). Architect design gate is this document; include a Reviewer fan-out and a real-browser Tester pass at 1280/1440/1920 widths.

### Option C: Header-anchored CTA + inspector drawer (progressive disclosure)

**Strategy.** Move the primary CTA UP: a compact `Button variant="primary"` ("Export Focused Video" / "Add Spotlight") lives at the right end of the `UnifiedHeader` mode-switcher row, which becomes `sticky top-0 z-30` inside the scroll shell. Export progress uses the already-global `GlobalExportIndicator`. Settings leave the page flow entirely: a `Settings` (gear) button in the `StageToolbar` opens a right-side **inspector drawer** (portaled, `Z.DROPDOWN`, ~`w-80`, full viewport height, explicit close, no backdrop-close per project rule) containing the same `SettingsPanel` + `SettingRow`s. Gestures that today force the Text tab (select a text block, click the thumbnail marker) open the drawer on that tab. The page below the header is stage + transport + timeline only, so the timeline itself moves up ~200-250px on both screens.

**Desktop wireframe (1440x1250).**

```
+----------------------------------------------------------------------------------+
| UnifiedHeader (sticky top-0): home > reel   [Annotate][Focus][Overlay]  [Export ▸]|  <- CTA
+----------------------------------------------------------------------------------+
| clips |  [meta card]                                                              |
| w-56  |  +----------------------------------------------------------------------+ |
|       |  | TOOLBAR: zoom | dim | straighten | ⚙ Settings                        | |
|       |  | +------------------------------------------------------------------+ | |
|       |  | | STAGE (Focus: 16:9 w-full; Overlay: 9:16 centered, 60vh)         | | |     +------------------+
|       |  | +------------------------------------------------------------------+ | |     | INSPECTOR DRAWER |
|       |  | | transport                                                        | | |     | (portal, right)  |
|       |  | | TIMELINE                                                         | | |     | tabs / rows      |
|       |  | +------------------------------------------------------------------+ | |     | explicit X       |
|       |  +----------------------------------------------------------------------+ |     +------------------+
+----------------------------------------------------------------------------------+
```

**Where the CTA lives and why it is above the fold.** Top of the page, in a header that is `sticky top-0`; it is on screen on first paint at any height and stays on screen while scrolling. The plumbing exists: `App.jsx` already owns `exportButtonRef` and passes it into both screens, and `FocusScreen.handlePublish` already fires `exportButtonRef.current.triggerExport()` from outside `ExportButtonView`. The header button calls the same ref; the hidden `ExportButtonView` instance keeps owning the export logic (or `ExportButtonContainer` is hoisted to `App.jsx`).

**Narrow / laptop viewport.** Header stays sticky at every width; on phones the CTA shrinks to an icon + short label (`Download` icon, "Export") at the row's right end, replacing T8790's bottom bar. The drawer becomes a bottom sheet (`fixed inset-x-0 bottom-0 max-h-[85vh]`), the same takeover pattern `AddDetailsPopup.jsx` uses for narrow surfaces.

**Focus mapping.** Header: F12 (button only). Toolbar: F5, F2, F3, gear. Stage: F4. Drawer, section "Reel": F1, F13 transition (optional, else stays in the sidebar); section "Export": F9 Audio, F11 Total, credit estimate line, unframed caption, F10 explainer. Note the credit estimate and unframed caption leave the CTA's side and live in the drawer; the header button's `title` and a compact caption under it carry the short form (`~9 credits`).

**Overlay mapping.** Header: O18. Toolbar: O1, gear. Drawer: O4-O14 as today (tabs inside the drawer). Lane labels: O15, O16. The drawer's `SettingsPanel` keeps the constant-height invariant trivially (the drawer is viewport-height).

**Tradeoffs (what gets worse).**
- The CTA is separated from its feedback. Today the button, the credit estimate, the "set at least one focus point" caption, the progress bar and the error panel are one visual unit; `ExportButtonView` was built around that. Splitting them means the header shows a button and the explanations live in a drawer or a toast. T8510 specifically added the inline disabled-reason caption because the amber banner sat "far off-screen on tall panels"; C reintroduces that distance.
- Settings become one click further away for every adjustment. For Overlay's slider-heavy tuning (stroke, fill, dim, with live preview) the drawer must stay open while the user drags on the stage, so it cannot be modal and it covers ~320px of the stage's right side, which on a 9:16 centered stage is empty pillarbox, but on Focus's 16:9 stage it covers video.
- The "select a text block opens the Text tab in place" behavior (T6630, built to avoid layout shift) becomes "select a text block opens a drawer", a bigger visual event than the one it replaced.
- Both `mobileReachable` tests encode "the export control renders inside the mode view"; C moves it to the header, so they fail by design and must be rewritten at the App level. `data-tutorial-target` anchors and the guided tutorial steps that point at the export button move too.
- `UnifiedHeader` is shared with Annotate; it needs a `rightSlot` prop that Annotate leaves empty, and Annotate's own T8600 strip must not be affected.
- Discoverability of settings drops (a gear is a learned convention, but the style guide's "discoverable, never hover-only" rule is satisfied because the gear is rendered at rest).

**Files / components.** Option A's shared list, plus: `components/shared/UnifiedHeader.jsx` (`rightSlot`, `sticky top-0` variant), `App.jsx` (render the header CTA, read export state from `exportStore` for the compact label/spinner, wire `exportButtonRef`), new `components/HeaderExportButton.jsx`, new `components/settings/InspectorDrawer.jsx` (portal to `document.body`, `Z.DROPDOWN`, explicit close, focus trap, bottom-sheet variant), `modes/FocusModeView.jsx` and `modes/OverlayModeView.jsx` (remove inline settings + export section; add gear; `handleSelectRegion` / `handlePosterMarkerClick` also open the drawer), `components/ExportButtonView.jsx` (split into `ExportCta` + `ExportFeedback`, or keep it mounted invisibly for logic), `components/GlobalExportIndicator.jsx` (verify it carries progress for the current project when the inline panel is gone). Tests: Option A's plus `UnifiedHeader` tests, drawer tests (open on gesture, explicit-close only, portal escapes the `backdrop-blur` stacking context), rewritten `mobileReachable` tests, tutorial anchor tests.

**Tier.** **L** (touches `App.jsx` and a shared header, new portal component, changes the tutorial anchors and two test contracts). Not splittable below L because the header CTA and the removal of the inline settings/export block must land together or the page shows two CTAs.

---

## 4. Ranking and recommendation

| Rank | Option | Problem 1 (CTA above fold) | Problem 2 (one settings idiom) | Risk / blast radius |
|---|---|---|---|---|
| **1** | **A: pinned action bar + aspect-placed rail** | Solved by construction at every viewport (sticky). Extends a fix that already shipped and was verified on phones (T8790) | Same rows, same panel chrome, same toolbar on both screens; placement differs by a stated rule | Lowest. No screen-level layout rewrite, no App.jsx change, splittable into 3 M tasks, existing geometry e2e stays valid |
| 2 | B: left workbench rail | Solved by construction (rail is viewport-tall). Also frees the timeline from ever being covered | Strongest unification: both screens are literally the same shell | Highest. New column on Overlay, sidebar refactor, ~9-35% smaller Focus stage depending on width, rewrites the T5676 geometry contract |
| 3 | C: header CTA + inspector drawer | Solved (sticky header), but the CTA loses its captions/progress | One idiom, but hidden behind a gear and a drawer | High. Shared header + App.jsx + tutorial anchors + both reachability tests change meaning; regresses T8510's "reason next to the button" |

**Recommendation: Option A, delivered as A1 -> A2 -> A3.** A1 alone (sticky `EditorActionBar` on both screens + the above-fold Playwright spec) closes Problem 1 in one M task with a pattern the codebase already trusts. A2 and A3 then close Problem 2 without touching screen composition. If, after living with A, the product owner wants the Focus settings beside the stage as well, Option B's rail is the follow-up and reuses every component A introduced (`SettingRow`, `SettingsPanel`, `StageToolbar`, `EditorActionBar` are all placement-agnostic by design).

Reject C unless the product direction is explicitly "Figma-style top-right Export": it trades the tight CTA-plus-reasons unit this project has iterated on (T5790, T8280, T8510) for a header slot.

---

## 5. Cross-cutting requirements for whichever option is picked

1. **No new write paths.** Every component in section 2 is presentational; every persistent value keeps its existing gesture handler (`changeAspectRatio`, `setIncludeAudio`, `wrappedSet*` overlay actions, `set_rotation`). No `useEffect` may persist anything (project rule). View state (dim, zoom, straighten reveal, active tab, drawer open) stays local `useState`.
2. **One DOM instance per control.** No `hidden lg:block` + `lg:hidden` duplicate trees for the rail or the action bar (fixes 1.3's double settings instance; matches `FocusPublishActionBar`'s documented rule). Place with CSS grid / `order`.
3. **Reachability tests extend, never contradict.** Keep `FocusModeView.mobileReachable.test.jsx` and `OverlayModeView.mobileReachable.test.jsx` green (Options A and B keep the export control rendered in non-fullscreen at all widths; A keeps it inside the mode views). Add the above-the-fold real-browser spec named in Option A; it is the first test in this codebase that asserts VISIBILITY on first paint, not just presence.
4. **Preserve pinned invariants:** constant-height settings body (0px reflow on tab switch), dimmed-but-clickable tabs, cyan thumbnail icon, "Spotlight" label, aspect selector rendered once and interactive with no `hidden` ancestor, `data-tutorial-target="focus-publish"` untouched (it is on the post-export bar, out of scope).
5. **Accent rule** (record in the style guide): selection inside settings = `bg-blue-600 text-white`; tab-active underline = `border-cyan-400`; the primary CTA = `Button variant="primary"` (purple). Do not introduce a fifth.
6. **Copy:** Overlay CTA "Add Spotlight". No em dashes in any shipped copy.
7. **Style guide update** in the same PR as A2/A3 (or the single L task): new "Settings system" section with the region table, `SettingRow` / `SettingsPanel` / `StageToolbar` / `EditorActionBar` snippets, the accent rule, and a changelog row. Note the outer editor/metadata card chrome (`bg-white/10`) as known debt, not fixed here.
8. **Knowledge doc touch:** `.claude/knowledge/keyframes-framing.md` "Entry points" gains the new component paths once implemented; no invariant in that doc changes (rotation, aspect refit and segment persistence are unaffected).

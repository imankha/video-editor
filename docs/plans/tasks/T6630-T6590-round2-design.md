# T6630 + T6590 — Round 2 combined design (Overlay editor UI)

**Status:** WAITING ON USER (design gate — approve before this is called done)
**Branch:** `feature/T6630-overlay-text-add-remove-drag-ux` (one branch, two task subjects)
**Rebased onto:** `origin/master` @ 450b081b (brings T6620 shadow-blur/eye-toggle, T6600 `zLayers.js`, and the T6590 task file).

This document answers the round-2 direction for **T6630** (text add/remove/drag + the
UI restructure that makes selection non-destructive) **and T6590** (thumbnail rename +
drag-to-set marker + un-occlude), because tab 3 *is* T6590's subject and both tasks share
one z-order decision. A working prototype backs every screenshot; nothing here is a mockup.

Rendered evidence lives in `qa/` (gitignored) and is referenced inline. All of it was
captured on the **real `/overlay` screen** with an **existing DB-loaded record** (draft 50)
whose text blocks the evidence spec did **not** create — via
`e2e/T6630-T6590-round2-evidence.qa.spec.js` (7/7 pass).

---

## 1. The headline: selecting a text block must not move it

**Root cause (confirmed).** The old "Edit Text" rail was rendered as
`selectedTextBlock ? <rail/> : null` — it **mounted on selection**, growing the layout and
shoving the block the user had just clicked. This is the "it opened a big piece of UI that
moved the thing i clicked on" report.

**Mechanism chosen: a constant-height tabbed section.** The settings area is now a
persistent three-tab section (`OverlaySettingsTabs.jsx`) whose **body is a fixed height**
(`h-[26rem]`, internal `overflow-y-auto`). Selecting a block only **swaps which tab's
content is shown inside that fixed box** — the section's outer dimensions never change, so
nothing downstream (the timeline, and thus the block) reflows. This is "reserved space /
fixed panel height", stated explicitly.

**Evidence — 0px delta on an existing DB block** (`G3-select-no-reflow.png`, test G3):

```
block bbox before = {x:233.39, y:404, w:234.97, h:40}
block bbox after   = {x:233.39, y:404, w:234.97, h:40}
dx = 0   dy = 0
```

The spec starts on the Overlay tab, re-measures the block, asserts `elementFromPoint` is the
block, clicks it, waits for the Text tab to become selected, and re-measures. **Delta is
exactly 0px** on a block the spec did not create.

---

## 2. The three-tab settings section — placement & anatomy

`OverlaySettingsTabs.jsx` (presentational; the three tab bodies are passed in as nodes).

- **Tabs:** `Overlay` (default) | `Text` | `Thumbnail`, each with an icon; `role=tablist` /
  `role=tab` / `aria-selected`; `data-testid="overlay-tab-{id}"`.
- **Placement:** exactly where the old settings card lived — the reclaimed pillarbox column
  **beside** the video on desktop (`hidden lg:block`), and **stacked** below on mobile
  (`lg:hidden`). One instance per slot (test G1 + `overlay-settings-tabs` ×2).
- **Overlay tab** = `OverlaySettingsCard` reduced to spotlight tuning only (highlight
  color/shape/stroke/fill/dim). Its old poster section was removed.
- **Text tab** = the shared `TextSpecEditor` for the selected block + a destructive "Delete
  text" action, OR an empty-state ("No text block selected. Click a text block… or use
  **+ Add text** in the text lane"). It is **always mounted** — selection updates it in place.
- **Thumbnail tab** = `ThumbnailPanel` (see §6).

Selecting a block flips to the Text tab via a **gesture-wrapped** `handleSelectText` (the
select handler also sets `activeTab='text'`) — no reactive `useEffect`.

Evidence: `G1-tab-overlay.png`, `G1-tab-text.png`, `G1-tab-thumbnail.png`, and the constant
box height is visible across `smoke-desktop-overlay-tab` vs `-text-tab` (same body size).

---

## 3. "Add Text" lives inside the text lane

The round-1 full-width `Add Text` button below the timeline (next to Add Spotlight) is
**removed**. The affordance is now a small **`+ Add text`** button **inside the text lane**
(`TextLayer.jsx`, `data-testid="add-text-in-lane"`), in the previously-inert lower band so it
never overlaps a block or lever. It adds a block at the current playhead and `stopPropagation`s
so it doesn't double-fire the whole-lane click-to-add (that click target is kept from round 1).

Evidence: `G2-add-text-in-lane.png` (test G2 also asserts **no** full-width "Add Text"
button remains below the timeline). Visible in every timeline screenshot at lane bottom-left.

---

## 4. Layer z-order = true paint order

**Preview paint order (already correct):** the `overlays={[Highlight, Detection, Text]}`
array in `OverlayModeView` renders Text **last → on top**. Text paints over spotlight and
tracking. No change needed there.

**Timeline lane order (fixed):** the lanes were listed Video → Detection → Highlight → Text
(text at the *bottom*), contradicting the paint order. They are now **Video → Text →
Detection → Highlight** — like every editor's layer list, topmost-painted layer directly
under the ruler. Both the left label column and the timeline body were reordered together so
each row's label and lane stay height-aligned; the bottom-left rounding moved to the new
bottom lane (Highlight).

Evidence — test G4: `text-track` top = **404**, `region-track` top = **556** → the text lane
sits above the highlight lane. Visible in `G4-lane-order.png` / any timeline screenshot
(cyan Text lane directly under the Film ruler, orange Highlight at the bottom).

**One z-order story (text · spotlight/tracking · thumbnail marker · playhead):**
- *App-wide* stacking uses the `Z` ladder in `constants/zLayers.js` (modals/players/toasts).
  That module **explicitly excludes intra-timeline stacking** (its own docstring: the
  timeline levers at `z-100` are "not migrated here"). So the timeline's internal stack is a
  documented **local** scale, consistent with zLayers' stated scope — I did **not** invent
  new app-wide rungs.
- *Preview* compositing = DOM order of the overlays array (Highlight < Detection < Text).
- *Timeline* local stack, low→high: lane content < **thumbnail guide line `z-20`** <
  **thumbnail handle `z-30`** < region/text levers `z-100`. The playhead line sits below the
  thumbnail handle — verified: with the playhead seeked exactly onto the marker, the marker
  handle is still the topmost element at its center (test G6, both zooms).

---

## 5. Whole-text-layer hide toggle (distinct from the per-block eye)

Clicking the **Text layer label icon** now toggles visibility of the **entire** text layer in
the preview (`textLayerHidden` gates `<TextOverlayPreview>`). This mirrors the existing
Detection label idiom (icon click toggles `showPlayerBoxes`), with a red slash over the icon
in the hidden state and `aria-pressed`/`data-testid="text-layer-toggle"`.

- It is a **view-only, memory toggle** (like `showPlayerBoxes`) — never persisted, so it does
  not violate gesture-based persistence and never writes to the backend.
- It is **orthogonal to the per-block eye** (T6620's `enabled`, which persists and hides one
  block): the layer toggle hides *all* blocks at once for a clean look while editing; the
  per-block eye is a per-block property. The timeline text **lane still shows every block**
  when the layer is hidden, so blocks remain editable.

Evidence — test G5: `aria-pressed` flips `true→false→true`; `G5-text-layer-hidden.png` shows
the slashed Text icon with the lane still populated.

---

## 6. Thumbnail tab contents (T6590) — feedback, not a control

- **Rename:** every user-visible Overlay string now says **"thumbnail"** (tab, panel heading,
  marker tooltip, `aria-label`). The `poster_*` **data model is unchanged**; one boundary
  comment in `ThumbnailPanel.jsx` / `PosterMarkerLayer.jsx` records "UI = thumbnail, model =
  poster". Test G1 asserts **no** "preview image" / "cover photo" / "use current frame" text
  remains on Overlay.
- **The "Use current frame" button is deleted.** Dragging the marker is the **only** way to
  set the frame. The Thumbnail tab now **shows the chosen still + its time as feedback**
  ("Thumbnail" / "Frame you picked · 0:03") plus the caption "Drag the thumbnail marker on the
  timeline to choose the frame." A grandfathered custom upload keeps only its one-way "Use a
  frame instead" revert (not a frame-picker).

Evidence: `G1-tab-thumbnail.png` (heading + feedback time + preview area, **no** set-frame
button).

---

## 7. The thumbnail marker — new position, affordance, occlusion (T6590)

**Old defects:** the chip was pinned to the video-track top rail at `-top-3` →
(a) **clipped** by the `.timeline-scroll-container` `overflow-x-auto` (which clips the
negative top offset), and (b) **occluded** by the playhead, which is guaranteed to coincide
because setting the frame parks the playhead at the marker.

**New shape:** a **full-height vertical guide line** (reads through the lanes like a secondary
playhead) with a **draggable handle at the vertical middle**. Only the small handle is
pointer-interactive (`pointer-events-auto`, 44px on coarse); the line is `pointer-events-none`
so it never blocks editing the lanes it crosses. Draggable **at rest** (`cursor-grab`, solid
chip, no hover gate). The tooltip/`aria-label` **state the interaction**: "Thumbnail marker —
drag to choose the thumbnail frame". Persistence is unchanged: one surgical write on drag end
via `wrappedSetPosterMarkerTime` (no mid-drag writes, no second path).

**Cut-off — fixed:** `top-0/bottom-0` is never clipped. Test G6: at default and 500% the
handle's box is within the scroll container's vertical bounds.

**Occlusion — fixed, with evidence.** The playhead's *handle* is in the top rail; the marker
handle is at mid-height — a different band. With the **playhead seeked exactly onto the
marker's time** (marker centre x = 544 ≈ playhead left = 544 at 100%; 704 ≈ 704 at 500%), the
marker handle is still the **topmost element** at its centre (`z-30` > playhead line). See
`G6-marker-zoom-100.png` (playhead line through the marker, chip fully readable) and
`G6-marker-zoom-500.png`.

**Region-drag-handle collision — evaluated.** The top rail originally protected against
RegionLayer's levers (bottom-anchored in the Highlight lane). With the reorder, the Highlight
lane is at the **bottom** and its levers stay there; the marker handle is at mid-height (Text-
lane band), so it does **not** collide with the region levers — G6's hit-test confirms the
marker is the topmost element at its centre. **Trade-off to confirm at the gate:** because the
reorder moved the tall Text lane directly under the ruler, "the middle" now falls in the Text
lane's lower band. The handle is a compact 44px chip and only that chip is interactive, so it
overlaps at most a small region of one lane at the marker's x. If you'd prefer zero overlap, a
**dedicated slim "Thumbnail" band** is the clean alternative — I recommend deciding this at
the gate rather than guessing.

---

## 8. Rendered evidence index (all in `qa/`)

| Artifact | Shows |
|---|---|
| `G1-tab-overlay/-text/-thumbnail.png` | three tabs; Overlay default; constant-height body |
| `G2-add-text-in-lane.png` | `+ Add text` inside the lane; no button below the timeline |
| `G3-select-no-reflow.png` | selecting an existing DB block → **dx=0, dy=0** |
| `G4-lane-order.png` | Text lane above Detection/Highlight (paint order) |
| `G5-text-layer-hidden.png` | whole-layer hide (slashed icon), lane still editable |
| `G6-marker-zoom-100.png` / `-500.png` | marker uncut + readable with playhead **on** it, default + 500% |
| `G7-mobile-375.png` | full layout at 375px, no horizontal overflow |

Verification method (all binding rules honoured): real screen + real DB block never
delete-then-recreated; geometry re-measured immediately before each pointer press with
`elementFromPoint` asserted; video paused before pixel work; **Playwright's own summary line
parsed** ("7 passed"), not the wrapper exit code. A newer-version "Could not save to the
cloud" toast appears on this draft — it is the T4315 restore-if-newer guard reacting to R2
versions advanced by round-1 QA writes on the same draft; it is **environmental**, not a
round-2 code path (no new write path was added).

---

## 9. Files changed (prototype backing this design)

New: `components/overlay/OverlaySettingsTabs.jsx`, `components/overlay/ThumbnailPanel.jsx`,
`e2e/T6630-T6590-round2-evidence.qa.spec.js`.
Changed: `modes/OverlayModeView.jsx`, `components/OverlaySettingsCard.jsx`,
`components/timeline/TextLayer.jsx`, `modes/overlay/OverlayMode.jsx`,
`modes/overlay/layers/PosterMarkerLayer.jsx`, `screens/OverlayScreen.jsx`, plus the two
characterization tests updated for the new copy/DOM (`PosterMarkerLayer.test.jsx`,
`OverlayModeView.aspectStage.test.jsx`). 38 related unit tests pass; eslint clean.

## 10. Open question for approval
The only genuinely open call is **§7's marker home**: keep the mid-height "secondary
playhead" handle (implemented, evidenced), or move to a dedicated slim Thumbnail band. Please
confirm; everything else above is implemented and evidenced.

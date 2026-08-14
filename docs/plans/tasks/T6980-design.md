# T6980 — Overlay double-click / double-tap text element → inline edit + Text-tab sync (Design)

**Status:** DESIGN — awaiting approval gate
**Tier:** L (Architect design gate, per kickoff)
**Scope:** Frontend only, ~5-6 files, no schema / no new backend action
**Task file:** `docs/plans/tasks/T6980-overlay-double-click-text-inline-edit.md`

> Facts below were re-verified against current source; the task file's file:line refs were
> stale and are NOT used. Line numbers here are as of the reads done for this design.

---

## 1. Current State Analysis

### 1.1 What exists today

**Canvas (`src/frontend/src/modes/overlay/overlays/TextOverlayPreview.jsx`)**
- Click-vs-drag gate is `TAP_SLOP = 6` px / `TAP_SLOP_SQ` (lines 79-80). There is **no**
  `DRAG_THRESHOLD_PX` (task file was wrong).
- Unified pointer path: `handlePointerMove` (305-321) promotes to `moved` past `TAP_SLOP_SQ`;
  `endDrag` (323-334) commits **once** with `commit=true` **only if `d.moved`** — a pure tap
  commits nothing (element already selected); `beginDrag` (336-363) does
  `preventDefault + stopPropagation + setPointerCapture` and installs a non-passive touchmove
  blocker.
- The **grab frame** (377-409) renders only for the selected element while `dragActive`;
  `onPointerDown={beginDrag}`. Every other visible element gets a **select-target** hit-box
  (417-445) whose `onClick` calls `onSelectElement(element.id, element.regionId)`.
- **T6080 trailing-click guard:** both the grab frame (389-392) and select-targets (431-433)
  carry `onClick={(e)=>e.stopPropagation()}` so a synthetic click can't bubble to
  `OverlayModeView.handleVideoAreaTap` (mobile-fullscreen `togglePlay`). A `dblclick` will bubble
  there too unless we stop it.
- **T6880 editability:** `visibleElements` (206-210) = elements of `activeRegions`
  (under playhead) **or** the paused, Text-tab-only `ghostRegion` (193-198),
  each filtered by `element.enabled !== false`. `isTextTabActive` + `isPlaying` are props
  (143-144). An element is editable **iff it is in `visibleElements`**.
- Each element renders inside an absolutely-positioned host `text-preview-element-{id}`
  (453-465) containing a `<RichText>` (464). Geometry is measured live by `measureBoxFor`
  (233-248) into `elementBoxes` state; metrics settle async over several rAFs (ResizeObserver
  on the selected span, 295-298).

**RichText (`src/frontend/src/components/RichText.jsx`)**
- Pure presentational. Renders **pre-wrapped** `lines` with `whiteSpace: 'pre'`,
  `display: inline` (379-402) — the browser does no soft-wrapping; wrap decisions are
  pre-computed to mirror the backend `wrap_lines`. `spec.text` is a **single string**;
  multi-line comes from the renderer's own wrapping + explicit `\n`, not from the input.

**Single write path (must be reused, never duplicated)**
- Panel keystroke: `TextSpecEditor` text `<input>` (89-94) `onChange → emit({text}) →
  onChange({...spec, text})` → `TextManagementPanel` (223-226) `onUpdateTextSpec(id, nextSpec)`.
- `wrappedUpdateTextSpec(id, nextSpec)` in `src/frontend/src/screens/OverlayScreen.jsx`
  (1082-1095): optimistic local `updateElementSpec` **every keystroke** + a **per-element-id
  250 ms debounce** (`updateTextSpecTimersRef` Map, 1051) → `overlayActions.updateTextSpec`
  → `update_text_spec` action carrying `{spec}`.
- `useTextOverlays.updateElementSpec(id, nextSpec)` (217-224) is synchronous local state and
  returns `{id, spec, regionId}`. Selection (`selectedRegionId` / `selectedElementId`,
  lines 40-41) also lives in this hook and is passed by props to **both** canvas and panel —
  one selection state, two ways to set it.

**Orchestration**
- `OverlaySettingsTabs`: `activeTab` / `onTabChange` are props; the `text` tab id; host owns it.
- `OverlayModeView.handleSelectRegion` (315-327) **already** does `setActiveTab('text')` +
  seeks the playhead into range on region select — the exact precedent for the dblclick flow.
- `TextManagementPanel` has **no** focus / scroll-into-view mechanism and **no**
  blur/Escape/Enter commit semantics — today only the 250 ms debounce commits.
  `expandOverrides` + `toggleExpanded` (72-79) drive expand; the selected region auto-expands
  (91-92).

**Keyboard shortcuts (`src/frontend/src/hooks/useKeyboardShortcuts.js`, called from
`FramingScreen.jsx:805`, covers overlay mode via `editorMode`/`selectedLayer`)**
- Space (57-73) guards only `tagName === 'input' | 'textarea'` — does **not** cover
  `contentEditable`.
- Ctrl+C / Ctrl+V (76-100) and Arrows (103-228) have **no** input guard at all.
- There is **no** shared `isEditing` / `isInputFocused` flag anywhere.

### 1.2 Code smells / gaps this task must respect (not "fix while here")
| Gap | Location | Consequence for this task |
|-----|----------|---------------------------|
| No shared "is user typing" flag | `useKeyboardShortcuts.js` | arrows/copy leak into any canvas editor; drives decision #1 + #4 |
| No focus/scroll/commit-on-blur in panel | `TextManagementPanel.jsx` | must be built, minimally (#5) |
| 2nd click of a native dblclick lands on a **different** node | canvas (select-target → grab-frame swap on 1st click) | detector must not assume same-node (#2) |

---

## 2. Target State

Double-click (desktop) / double-tap (touch two-tap ≤ ~300 ms) on an editable text element:
1. selects that element (existing `onSelectElement` path — unchanged),
2. flips the settings panel to the **Text** tab, seeks the playhead into range, expands +
   scrolls the panel tree to that element and focuses its `<input>` (caret at end),
3. enters **inline canvas edit mode** — a caret-bearing editor positioned over the rendered
   text,
4. typing in **either** the canvas editor **or** the panel input live-updates **both** and
   commits through the **one** existing debounced `update_text_spec` path,
5. overlay keyboard shortcuts (Space / arrows / copy) are suppressed while editing,
6. blur / Escape / Enter end inline edit,
7. single-click-select and drag-to-position (T6720) are byte-identical to today,
8. inline edit is offered **only** when the element is in `visibleElements` (T6880 rule).

### Recommended mechanism (see §4 Decisions for full rationale + rejected alternatives)
- **Inline editor = a transparent, single-line `<input type="text">`** absolutely positioned
  over the element's measured box, **not** `contentEditable`. RichText stays mounted and
  visible underneath (the live preview the user already sees); the input is
  `color: transparent` / `background: transparent` / `caret-color: <visible>` and sits on top,
  so the caret shows over the real rendered text and every keystroke drives the shared draft
  which re-renders RichText live. It reuses `measureBoxFor` geometry (no new geometry code).
- **Edit-mode flag lives in `useTextOverlays`** as `inlineEditingElementId`
  (next to `selectedElementId`), so canvas + panel + keyboard hook all read one source.
- **Keyboard suppression = a boolean derived from that flag**, threaded into
  `useKeyboardShortcuts` and checked at the top of all three handlers.

### 2.1 Dataflow (single commit path)

```
      double-click / double-tap (canvas)          click a tree row (panel) — unchanged
                    │                                         │
                    ▼                                         │
   TextOverlayPreview.onBeginInlineEdit(id, regionId)         │
                    │                                         │
                    ▼                                         │
   OverlayModeView.handleBeginInlineEdit ──────────┐         │
     • onSelectElement(id, regionId)               │         │
     • setActiveTab('text')                        │         │
     • seek playhead into range (if needed)        │         │
     • beginInlineEdit(id)  ─────────────┐         │         │
                                         ▼         ▼         ▼
                        useTextOverlays: selectedElementId + inlineEditingElementId
                                         │
              ┌──────────────────────────┴───────────────────────────┐
              ▼                                                        ▼
   Canvas inline <input> (transparent)                    Panel <input> (TextSpecEditor)
   value = selectedElement.spec.text                      value = selectedElement.spec.text
   onChange → onUpdateTextSpec(id,{...spec,text})         onChange → onUpdateTextSpec(id,{...spec,text})
              └──────────────────────────┬───────────────────────────┘
                                         ▼
              OverlayScreen.wrappedUpdateTextSpec(id, nextSpec)   ← THE ONE PATH
                • updateElementSpec (optimistic local, re-renders BOTH inputs + RichText)
                • per-element 250 ms debounce → update_text_spec action
                                         │
                                         ▼
                  blur / Escape / Enter → endInlineEdit()  (clears inlineEditingElementId;
                                          debounce already persists — no extra write)
```

No `useEffect` persists anything. Every write traces to a keystroke gesture through the
existing debounce (unchanged). `beginInlineEdit` / `endInlineEdit` mutate **local view state
only** (selection + edit flag), never the backend.

---

## 3. Implementation Plan (per file)

### 3.1 `useTextOverlays.js` — own the edit-mode flag
- Add state `inlineEditingElementId` (string | null) beside `selectedElementId`.
- Add `beginInlineEdit(elementId)` — sets `inlineEditingElementId` (and defensively clears it
  if the id is falsy); **does not** itself select or seek (caller composes those, mirroring how
  `selectElement` stays single-purpose).
- Add `endInlineEdit()` — sets `inlineEditingElementId = null`.
- `deleteElement` / `deleteRegion` / `reset` clear `inlineEditingElementId` when the edited
  element/region goes away (same guard style already used for `selectedElementId`).
- Export the new value + two setters.
- **No write path added.** This hook stays local-only, exactly as today.

### 3.2 `OverlayScreen.jsx` — thread state, no new write
- Pass `inlineEditingElementId`, `beginInlineEdit`, `endInlineEdit` down to `OverlayModeView`.
- Compute `isTextEditing = inlineEditingElementId != null` and pass it to `useKeyboardShortcuts`
  (see 3.6). This is the ONLY new prop the hook gains.
- `wrappedUpdateTextSpec` is **unchanged** — both inputs already funnel here.

### 3.3 `OverlayModeView.jsx` — compose the gesture
- New `handleBeginInlineEdit(id, regionId)` — the single orchestration point, modeled on the
  existing `handleSelectRegion`:
  1. `onSelectElement(id, regionId)`,
  2. `setActiveTab('text')`,
  3. seek into range if the owning region is not already under the playhead
     (reuse `isRegionUnderPlayhead`, same as `handleSelectRegion`),
  4. `beginInlineEdit(id)`.
- Pass `onBeginInlineEdit={handleBeginInlineEdit}`, `inlineEditingElementId`,
  and `onEndInlineEdit={endInlineEdit}` into `<TextOverlayPreview>`.
- Pass `inlineEditingElementId` + `onEndInlineEdit` into `<TextManagementPanel>` (panel focus,
  3.5).
- **Mobile-fullscreen note:** the existing `handleVideoAreaTap`/`togglePlay` bubble is already
  guarded by the T6080 `stopPropagation` on the canvas hit-boxes; the dblclick/dbltap handler
  adds its own `stopPropagation` (3.4) so entering edit never toggles play.

### 3.4 `TextOverlayPreview.jsx` — detect gesture + render inline editor
**Detection (robust to the node-swap + touch):**
- Attach a `dblclick` listener **on each element's hit affordance** — but route both the
  grab frame (selected element) and the select-targets (non-selected) to **one**
  `handleActivateEdit(element)` callback, so it fires regardless of which node the 2nd click
  lands on. On desktop use the native `dblclick` event on those same nodes (the browser fires
  `dblclick` on the common ancestor of the two clicks, and both the grab frame and
  select-target sit inside the same `overlayRef` host — attach a single `onDoubleClick` on the
  `overlayRef` container and resolve the element by hit-testing the pointer against
  `elementBoxes`, which is the swap-proof option).
  **Chosen:** single `onDoubleClick` on the `overlayRef` frame → hit-test `(clientX,clientY)`
  against each `elementBoxes[id]` (same fraction math the select-targets already use) → the
  matched element is the target. This is immune to the select→grab-frame node swap because it
  never depends on which child node received the clicks.
- Touch two-tap: a small ref-based detector (`lastTapRef = { id, t }`) on the hit-box
  `onPointerUp` for `pointerType === 'touch'`: if a second tap on the **same element id**
  arrives within `DOUBLE_TAP_MS` (≈300) **and** the gesture was a tap (not a drag — reuse the
  `TAP_SLOP` result already computed in the pointer path), fire `handleActivateEdit`. Because
  we key on element id + time (not node identity), the swap is irrelevant. Pinch/scroll are
  excluded because a moved pointer (`d.moved`) never counts as a tap.
- `handleActivateEdit(element)`: guard `element ∈ visibleElements` (it always is, since
  `elementBoxes` only holds visible elements), `e.stopPropagation()` (kill the mobile
  `togglePlay` bubble), then `onBeginInlineEdit(element.id, element.regionId)`.

**Inline editor render:**
- When `inlineEditingElementId === element.id`, render a transparent `<input>` positioned with
  the SAME `leftPx/topPx/widthPx/heightPx` math the grab frame uses (from `elementBoxes` +
  `rect`), `pointerEvents:'auto'`, `caret-color` visible, text transparent. RichText stays
  underneath (visible).
- `value={selectedElement.spec.text}`; `onChange` → `onMoveTextPosition`? **No** —
  a new `onEditText(id, spec)` prop that maps to `onUpdateTextSpec(id, {...spec, text})`
  (the debounced path). (We reuse the existing `onUpdateTextSpec` already available to the panel;
  thread the same callback into the canvas rather than inventing a second.)
- `autoFocus` + set caret to end on mount; `onBlur`, `onKeyDown` (Escape / Enter) →
  `onEndInlineEdit()`. `stopPropagation` on the input's own `keydown` so Space/arrows typed
  into it never reach the document listener even before the flag propagates (belt-and-braces
  with #4).
- Multiline: the input is single-line (matches `spec.text` being a single string; the
  renderer owns wrapping). Left/center/right align of the caret follows `spec.align` via the
  input's `text-align`, positioned over the measured box — acceptable because the transparent
  input only needs the caret roughly co-located with the ink, not glyph-perfect.

### 3.5 `TextManagementPanel.jsx` (+ `TextSpecEditor.jsx`) — focus + scroll + commit-end
- Accept `inlineEditingElementId` + `onEndInlineEdit` props.
- When `inlineEditingElementId` is set (and matches the selected element), imperatively:
  - ensure its region row is expanded (set an `expandOverrides` entry — reuse `toggleExpanded`),
  - `scrollIntoView` the element's tree row (a ref keyed by element id),
  - focus the `TextSpecEditor` text `<input>` and place the caret at end.
- `TextSpecEditor` gains an **optional** `inputRef` (and optional `onCommitEnd` for
  blur/Escape/Enter) — additive, all existing callers pass nothing and are unaffected.
- Blur/Escape/Enter on the panel input → `onEndInlineEdit()` (symmetric with the canvas).
  Commit itself is unchanged (the 250 ms debounce already fired on the last keystroke).

### 3.6 `useKeyboardShortcuts.js` — suppress while editing
- New optional param `isTextEditing = false`.
- Guard the top of **all three** handlers (Space, Ctrl+C/V, Arrows) with
  `if (isTextEditing) return;`. This is the real fix — arrows/copy have no `tagName` guard at
  all, so relying on the input's `tagName` is insufficient (and would miss the canvas overlay
  entirely if it were contentEditable). The flag is derived from `inlineEditingElementId`.
- Add `isTextEditing` to the effect dep arrays.

### New symbols / props summary
| File | Adds |
|------|------|
| `useTextOverlays.js` | state `inlineEditingElementId`; `beginInlineEdit`, `endInlineEdit`; clears on delete/reset |
| `OverlayScreen.jsx` | threads the three above + `isTextEditing` into hook + view |
| `OverlayModeView.jsx` | `handleBeginInlineEdit`; passes `onBeginInlineEdit`/`inlineEditingElementId`/`onEndInlineEdit` to canvas + panel |
| `TextOverlayPreview.jsx` | `onBeginInlineEdit`, `inlineEditingElementId`, `onEndInlineEdit` props; `onDoubleClick` hit-test + touch two-tap detector; transparent inline `<input>` |
| `TextManagementPanel.jsx` | `inlineEditingElementId`, `onEndInlineEdit` props; expand+scroll+focus effect; per-row refs |
| `TextSpecEditor.jsx` | optional `inputRef`, optional `onCommitEnd` (additive) |
| `useKeyboardShortcuts.js` | `isTextEditing` param + 3 guards |

---

## 4. Design Decisions

| # | Decision | Options | Choice | Rationale |
|---|----------|---------|--------|-----------|
| 1 | Inline editor element | transparent `<input>` overlay vs `contentEditable` mirror | **transparent `<input>`** | (a) Space guard in `useKeyboardShortcuts` already covers `input`; contentEditable leaks Space/arrows/copy and would still need the flag. (b) `spec.text` is a single string; RichText owns wrapping — an input matches the data shape exactly, contentEditable invites stray `<div>`/`<br>` and rich paste we'd have to sanitize. (c) Caret over transparent-fill input above a still-visible RichText keeps the live preview honest with zero geometry duplication (reuse `measureBoxFor`). Rejected contentEditable: multi-node model + wrapping mismatch + no built-in shortcut guard = more surface, more risk. |
| 2 | Double-click detection site | native `dblclick` per hit-node vs `onDoubleClick` on `overlayRef` + hit-test | **`onDoubleClick` on `overlayRef`, hit-test against `elementBoxes`** | The 1st click swaps the target node (select-target → grab frame), so per-node dblclick is unreliable. Hit-testing the pointer against the already-measured `elementBoxes` is swap-proof and reuses existing fraction math. |
| 3 | Touch double-tap | native (none on touch) vs ref two-tap keyed by id+time | **ref two-tap, keyed by element id + ≤300 ms, gated on `!moved`** | Keying on id (not node) survives the swap; `!moved` reuses the existing `TAP_SLOP` result so pinch/scroll/drag never trigger it. |
| 4 | Edit-mode flag location | local to canvas vs `useTextOverlays` | **`useTextOverlays.inlineEditingElementId`** | Selection already lives there and is the single source both canvas and panel read; the keyboard hook + panel focus + canvas render all need it. One source, no duplicate state (state-management rule). |
| 5 | Keyboard suppression | rely on `tagName` guard vs shared flag into the hook | **shared `isTextEditing` flag, guards all 3 handlers** | Arrows and Ctrl+C/V have **no** tagName guard today; only Space does. A flag is the correct, complete fix and ties naturally to #4. |
| 6 | Second write path? | new inline-edit action vs reuse `wrappedUpdateTextSpec` | **reuse** | Persistence rule: one write path per datum. Both inputs emit `{...spec, text}` into the existing debounced `update_text_spec`. No new action, no schema change, no reactive `useEffect`. |
| 7 | Escape semantics | cancel (revert) vs commit | **Escape commits (ends edit; keeps last-typed text)** — see Open Question | Simplest, matches "commit per existing semantics": every keystroke already updated the draft + armed the debounce, so there is no separate uncommitted buffer to revert. A true cancel would require snapshotting pre-edit text and issuing a *revert write* — that is a second, reactive-ish write path we explicitly avoid. Flagged for the approver in case product wants cancel. |

---

## 5. Risks / Landmines

| Risk | Mitigation |
|------|-----------|
| **Drag regression (T6720).** dblclick/dbltap must not perturb the `TAP_SLOP`/`beginDrag` path. | Detection is additive: desktop uses a separate `onDoubleClick` on the frame; touch two-tap reads the existing `d.moved` result and never calls `onMoveTextPosition`. Re-run T6720 e2e as the guard. |
| **dblclick node swap.** 1st click re-renders select-target → grab frame. | Decision #2: hit-test against `elementBoxes` on the stable `overlayRef`, never per-child-node. |
| **Mobile `togglePlay` bubble.** dblclick would reach `handleVideoAreaTap`. | `stopPropagation` in `handleActivateEdit` + existing T6080 guards. |
| **Keyboard leak.** arrows/copy have no tagName guard. | Decision #5 flag guards all 3 handlers; plus `stopPropagation` on the inline input's keydown. |
| **Async metrics.** `elementBoxes` settles over rAFs; a too-early inline input mis-positions or hit-test misses. | Only offer edit for elements present in `elementBoxes` (already the visible set); position the input from the same live box the grab frame trusts, which the ResizeObserver keeps fresh. |
| **T6880 gating.** Must not offer edit for a non-visible element. | `handleActivateEdit` only runs for an element matched in `elementBoxes`, which is derived from `visibleElements` — structurally can't fire on a hidden/out-of-range element. |
| **T6990 merge surface.** `feature/T6990-overlay-text-fade-out-burn` edits the same per-element render block (opacity at ~462) — unmerged. | Rebase concern only, not a design conflict: fade-out touches OPACITY, this touches the inline-edit affordance in the same block. On rebase, re-verify click/drag + fade tests; do not drop the fade import during conflict resolution. |

---

## 6. Open Questions (for the approver)

- [ ] **Mechanism (Decision #1): transparent `<input>` overlay (recommended) vs
  `contentEditable` mirror?** Recommendation is the input for shortcut-guard reuse, data-shape
  fit, and zero geometry duplication.
- [ ] **Escape semantics (Decision #7): commit (recommended) vs cancel/revert?** Cancel would
  require a pre-edit snapshot + a revert write (a second, effectively reactive write path we
  otherwise avoid). Confirm commit-on-Escape is acceptable, or accept the added revert path.
- [ ] Should double-tap also work on **desktop touchscreens** (pointerType `touch` on a
  desktop) — the ref detector covers this for free; confirm no objection.

---

**This document is ready for the approval gate.** No source has been written. On approval,
implementation proceeds per §3 with T6720 regression + real-browser e2e as the QA gate.

Relevant paths:
- `src/frontend/src/modes/overlay/overlays/TextOverlayPreview.jsx`
- `src/frontend/src/modes/OverlayModeView.jsx`
- `src/frontend/src/screens/OverlayScreen.jsx`
- `src/frontend/src/modes/overlay/hooks/useTextOverlays.js`
- `src/frontend/src/components/overlay/TextManagementPanel.jsx`
- `src/frontend/src/components/textspec/TextSpecEditor.jsx`
- `src/frontend/src/hooks/useKeyboardShortcuts.js`

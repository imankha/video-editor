# T8600 UI Spec: Inline Play Editor strip, details disclosure, button-row swap

**Author:** ui-designer agent
**Status:** Draft for Architect — not yet implemented, not yet folded into the style guide
**Feeds:** [T8600](./T8600-inline-play-editor-under-canvas.md) (locked decisions), [UX review](../ux/UX-inline-play-editor-2026-09-03.md) (rationale)
**Does not re-open:** Create Reel placement, no-mini-timeline-v1, single-task scope — all treated as decided.

This spec gives exact Tailwind classes for the pieces the task file left at
mockup/prose level: the strip's tint/heights/spacing, the desktop
expand-in-place vs. mobile full-screen popup split for "Add details", and the
Layer+Focus button row at the 1024–1440px range. Every token below is traced
to an existing pattern already in `AnnotateModeView.jsx` /
`AnnotateFullscreenOverlay.jsx` / `ClipDetailsEditor.jsx` — nothing here
invents a new color or spacing scale.

---

## 0. Files this spec maps onto

| Region | Current code | New behavior |
|---|---|---|
| Timeline block | `AnnotateModeView.jsx:761-777` | Replaced by the **editor strip** (§2) when the desktop under-canvas editor is open |
| CTA + Playback/Share block | `AnnotateModeView.jsx:823-927` | Replaced by the **Layer + Focus row** (§4) in the same state |
| Docked/inline form body | `AnnotateFullscreenOverlay.jsx` `formBody` (L355-532) | New `layout="strip"` variant (§2) for the desktop case; existing `layout="inline"` (mobile sheet) gets the Tags/Notes block swapped for an "Add details" button (§3.2) |
| Mobile Tags+Notes | `AnnotateFullscreenOverlay.jsx:403-457` | Move into a new full-screen popup component (§3.2) |

A new boolean drives the branch in `AnnotateModeView.jsx`:

```js
const desktopEditorOpen = showAnnotateOverlay && !annotateFullscreen && !isMobile;
```

(`mobileInlineForm` already covers the mobile case; `desktopEditorOpen` is its
sibling. The two are mutually exclusive by construction — `isMobile` gates
both.)

---

## 1. Tint tokens (add = green, edit = yellow)

Both tints are lifted verbatim from the existing "source video expired" panel
already in this file (`AnnotateModeView.jsx:462`, amber variant of the same
pattern), not invented:

```
container : bg-{color}-950/20  border border-{color}-800/40
inner rule: border-{color}-800/30   (one step lighter than the outer border —
                                      same "outer > inner" hierarchy used for
                                      the header/details dividers below)
icon/text : text-{color}-400
```

| Mode | color | Icon | Header copy |
|---|---|---|---|
| Add | `green` | `Plus` (matches primary CTA icon, `AnnotateModeView.jsx:851`) | `Adding new play` |
| Edit | `yellow` | `Pencil` (matches primary CTA icon, `AnnotateModeView.jsx:851`) | `Editing: {clipName}` |

This is the same green/yellow language already carried by the primary CTA
button (`bg-green-500`/`bg-yellow-600`, `AnnotateModeView.jsx:843-849`) and by
`AnnotateControls`' `variant={isEditMode ? 'warning' : 'success'}` — the strip
just extends that vocabulary from "one button" to "the whole surface," which
is the loud mode-signal the UX review calls for (§f of the review).

---

## 2. The editor strip (desktop, `layout="strip"`)

Root:

```jsx
<div className={`rounded-lg border ${
  isEditMode ? 'bg-yellow-950/20 border-yellow-800/40' : 'bg-green-950/20 border-green-800/40'
}`}>
```

Sits exactly where `AnnotateMode` (timeline) currently renders, same `mt-6`
outer wrapper — same vertical rhythm as what it replaces, no new margin scale.

### 2.1 Header row (h-11 equivalent, always visible, never scrolls)

```jsx
<div className={`flex items-center justify-between gap-3 px-4 py-2.5 border-b ${
  isEditMode ? 'border-yellow-800/30' : 'border-green-800/30'
}`}>
  <div className="flex items-center gap-2 min-w-0">
    {isEditMode
      ? <Pencil size={16} className="text-yellow-400 shrink-0" />
      : <Plus size={16} className="text-green-400 shrink-0" />}
    <span className="text-sm font-semibold text-white truncate">
      {isEditMode ? `Editing: ${clipDisplayName}` : 'Adding new play'}
    </span>
  </div>
  <button onClick={onClose} title="Cancel (Esc)" className="p-1.5 hover:bg-gray-700/50 rounded transition-colors shrink-0">
    <X size={18} className="text-gray-400" />
  </button>
</div>
```

Save/Cancel are **not** duplicated here — they live at the end of the
controls row (§2.3), matching the task file's explicit row-2 ordering
("...Teammates input..., Add details button, Save/Cancel"). The header's `X`
is a secondary/redundant cancel affordance (mirrors the existing docked-panel
header `X`, `AnnotateFullscreenOverlay.jsx:366-372`) — both call `onClose`.

### 2.2 Scrub row

```jsx
<div className="px-4 pt-3">
  <ClipScrubRegion /* non-compact variant — full width now, no `compact` prop */ ... />
</div>
```

Use the **non-compact** `ClipScrubRegion` (the `h-10` track with tick marks
and the time-range label row, `ClipScrubRegion.jsx:351-474`), not the
`compact` variant used in the old 352px sidebar form. The strip is full
canvas-width now, so the roomier variant is legible and its own time chips
(`00:12.0 → 00:15.0`) satisfy "live start/end time chips" without a new
component. Its built-in `mb-4` becomes the gap to the controls row below —
don't add a duplicate margin on the wrapper.

### 2.3 Controls row

```jsx
<div className="px-4 pb-3 flex flex-wrap items-center gap-3">
  <StarRating rating={rating} onRatingChange={handleRatingChange} size={22} />

  {/* Create Reel — placed immediately next to Rating per the locked decision
      (its state auto-flips with rating; adjacency keeps that visible) */}
  {isEditMode ? (
    existingClip?.autoProjectId
      ? <span className="text-xs text-green-400 shrink-0">Reel created</span>
      : <Button variant="cyan" size="sm" icon={Plus} onClick={...}>Create Reel</Button>
  ) : (
    <div className="flex items-center gap-1.5 shrink-0" title="Auto-create a reel from this play">
      <span className={`text-xs font-medium ${createProject ? 'text-cyan-400' : 'text-gray-500'}`}>Reel</span>
      <Toggle checked={createProject} onChange={...} size="sm" accent="cyan" />
    </div>
  )}

  <div className="hidden sm:block h-6 w-px bg-gray-700/50 shrink-0" />

  <input
    type="text"
    value={clipName}
    onChange={handleNameChange}
    aria-label="Clip name"
    placeholder={defaultClipName || 'Clip name'}
    className="w-36 lg:w-44 px-2.5 py-1.5 bg-gray-800 border border-gray-700 rounded text-sm text-white
               placeholder-gray-500 focus:border-green-500 focus:outline-none shrink-0"
  />

  {!myAthlete && (
    <div className="min-w-[180px] max-w-xs flex-1">
      <TeammateTagInput teammates={taggedTeammates} onChange={setTaggedTeammates} suggestions={teammateSuggestions} />
    </div>
  )}

  <div className="ml-auto flex items-center gap-2 shrink-0">
    <button
      onClick={() => setDetailsOpen(o => !o)}
      aria-expanded={detailsOpen}
      className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-700
                 rounded text-sm text-gray-300 transition-colors"
    >
      {detailsOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      {detailsLabel}
    </button>
    <button onClick={handleSave} className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded transition-colors">
      {isEditMode ? 'Update' : 'Save'}
    </button>
    <button onClick={onClose} className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded transition-colors">
      Cancel
    </button>
  </div>
</div>
```

`detailsLabel` (reuses the task file's own example copy):

```js
const tagCount = selectedTags.length;
const hasNote = notes.trim().length > 0;
const detailsLabel = !tagCount && !hasNote
  ? 'Add details'
  : `Details (${[tagCount ? `${tagCount} tag${tagCount > 1 ? 's' : ''}` : null, hasNote ? 'note' : null].filter(Boolean).join(', ')})`;
```

Row height at rest: ~40px content + `pb-3` — noticeably shorter than the old
CTA block it replaces (52px button + hint text + 44px secondary row ≈140px).
That collapse is **intentional**, not a bug to compensate for: it is the same
"acceptable, self-explaining" height change the UX review already signs off
on for the details panel pushing the row down (§b of the review) — applied in
the other direction here. Do not add filler margin to fake back the old
height.

`flex-wrap` is load-bearing: at narrow strip widths (see §4 for the exact
1024px numbers) the trailing cluster (`Add details` / Save / Cancel) or the
Teammates block may wrap to a second line. That is expected, not a layout
bug — never suppress wrapping with `flex-nowrap` + `overflow-x-auto` here, a
horizontally-scrolling action row is worse than a second line.

### 2.4 "Add details" panel (desktop expand-in-place)

```jsx
{detailsOpen && (
  <div className={`border-t px-4 py-3 max-h-64 overflow-y-auto ${
    isEditMode ? 'border-yellow-800/30' : 'border-green-800/30'
  }`}>
    {/* Tags block — IDENTICAL to AnnotateFullscreenOverlay.jsx:403-425 (TagSelector size="lg" / NoSportTagWarning), unchanged classes */}
    {/* Notes block — IDENTICAL to AnnotateFullscreenOverlay.jsx:444-457 (textarea rows={2}), unchanged classes, and no longer `!isMobile`-gated since this branch is desktop-only by construction */}
  </div>
)}
```

`max-h-64` (256px) caps the tag grid so a large tag set scrolls internally
rather than pushing the canvas out of view — this is the "own max-height
scroll" the task file calls for. No focus trap, no backdrop, no z-index: it's
in-flow content, exactly the UX review's rationale for rejecting a popover
here (§b of the review).

**Dismissal on desktop is the toggle button itself** (click "Add details"
again, or the `ChevronUp` state) — there is no separate Done/X inside this
panel. That is deliberately different from the mobile popup (§3.2), which
*does* need an explicit Done/X because it fully covers the screen; the
desktop panel never hides anything else, so re-clicking the disclosure it
came from is sufficient and matches ordinary disclosure-widget conventions
(no new interaction pattern to teach).

**Esc layering** (task invariant): the strip's keydown handler must check
`detailsOpen` before calling `onClose`:

```js
if (e.key === 'Escape') {
  e.preventDefault();
  if (detailsOpen) { setDetailsOpen(false); return; }
  onClose();
}
```

**Motion:** none needed. The panel mounts/unmounts on `detailsOpen` exactly
like the rest of this component tree (no CSS transition, no animation
library in use anywhere in `AnnotateFullscreenOverlay.jsx` today) — don't
introduce one here either.

---

## 3. "Add details" surface split

### 3.1 Desktop (>=1024px, `!isMobile`)

Covered above — expand-in-place inside the strip, §2.4.

### 3.2 Mobile (<1024px, `useIsMobile()`)

The T8140 bottom sheet (`AnnotateModeView.jsx:784-804`) stays structurally
unchanged (`fixed inset-x-0 bottom-0 z-40`, `max-h-[85vh]`, `rounded-t-2xl`,
pinned Save footer). Inside its `formBody`, the Tags block
(`AnnotateFullscreenOverlay.jsx:403-425`) is replaced in place by the same
"Add details" button used on desktop (§2.3's button, same classes, same
`detailsLabel` logic) — it sits where Tags used to be, directly after
Rating.

**Note for the Architect:** Notes (`!isMobile`-gated today,
`AnnotateFullscreenOverlay.jsx:444-457`) has never rendered on mobile at all.
Moving it into the mobile details popup is a net-new mobile capability, not a
relocation — call this out explicitly in the design doc since it's an
observable behavior change beyond what the task's "Tags + Notes move behind
Add details" line implies at first read (it reads as pure relocation for both
fields; for Notes on mobile it's actually "newly available"). It's optional
and harmless, but worth a one-line note so nobody is surprised in QA.

Tapping "Add details" opens a **full-screen takeover**, styled after the
existing T8140 precedent (`SportQuestionOverlay.jsx`) rather than a new
pattern:

```jsx
<div className="fixed inset-0 z-[110] flex flex-col bg-gray-950/95" role="dialog" aria-modal="true" aria-label="Add details">
  {/* Mode-tint top accent — 2px, echoes the strip's tint so the mode stays loud
      even inside this neutral popup */}
  <div className={`h-0.5 shrink-0 ${isEditMode ? 'bg-yellow-500' : 'bg-green-500'}`} />

  <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 shrink-0">
    <h2 className="text-base font-semibold text-white">Add details</h2>
    <div className="flex items-center gap-2">
      <button onClick={onDone} className="px-4 py-1.5 bg-green-600 hover:bg-green-700 text-white text-sm font-medium rounded-lg transition-colors">
        Done
      </button>
      <button onClick={onDone} title="Close" className="p-1.5 hover:bg-gray-800 rounded transition-colors">
        <X size={20} className="text-gray-400" />
      </button>
    </div>
  </div>

  <div className="flex-1 overflow-y-auto p-4">
    {/* Tags block — same TagSelector size="lg" classes as AnnotateFullscreenOverlay.jsx:403-425 */}
    {/* Notes block — same textarea classes as AnnotateFullscreenOverlay.jsx:444-457, but rows={4} (room is no longer scarce full-screen) */}
  </div>
</div>
```

- `z-[110]` matches `SportQuestionOverlay` exactly (`SportQuestionOverlay.jsx:18`).
  They are temporally exclusive by construction (details popup only exists
  pre-Save; the sport question only fires post-Save,
  `AnnotateModeView.jsx:153-159`), so identical z-index is safe and there is
  no stacking order to design — this directly satisfies the task's "never
  stacks with the T8140 sport question" invariant by making co-existence
  structurally impossible, not just visually ordered.
- **No backdrop-close.** `onDone` only fires from the `Done` button or the
  `X` — per the project's standing no-backdrop-close rule and the task's
  explicit "explicit Done/X only, never backdrop-close."
- `onDone` just closes the popup back to the sheet — it does **not** save.
  The sheet's own pinned Save footer is still the only save gesture, per
  invariant "the form stays memory-only until the Save gesture."
- This popup is a new small component (e.g.
  `src/frontend/src/modes/annotate/components/AddDetailsPopup.jsx`), shared
  by nothing else — it is NOT the mobile-only version of the desktop panel;
  the desktop panel is inline JSX inside the strip (§2.4), this is a
  standalone full-screen component. Both read/write the same
  `selectedTags` / `notes` state lifted in the parent overlay component, so
  there is one source of truth regardless of which surface is open.

---

## 4. Button row swap at 1024–1440px (the flagged gap)

Replaces `AnnotateModeView.jsx:823-927` when `desktopEditorOpen`:

```jsx
<div className="mt-4 flex flex-wrap items-center gap-3">
  <LayerSegmentedControl
    size="sm"
    value={myAthlete}
    onChange={...}
    disabled={!!existingClip?.shared_by}
    disabledReason={existingClip?.shared_by ? `Shared by ${existingClip.shared_by} — imported clips stay on the Team layer` : ''}
    /* deliberately NO `className="w-full"` — see rationale below */
  />
  {isEditMode && existingClip?.autoProjectId && (
    <Button
      variant="cyan"
      size="sm"
      icon={Crop}
      title="Open in Focus mode"
      onClick={() => onOpenInFocus(existingClip.autoProjectId)}
    >
      Focus
    </Button>
  )}
</div>
```

### Why this reads correctly at 1024px specifically

The sidebar (`ClipsSidePanel.jsx:142`) is a **fixed** `w-[352px]`, not
responsive — so it eats a much bigger *proportion* of the viewport at 1024px
(≈34%) than at 1440px (≈24%). After the sidebar, the panel's own `p-2 sm:p-6`
padding (`AnnotateModeView.jsx:418`), the available content width for this
row is roughly:

| Viewport | Sidebar | Panel padding | Content width available |
|---|---|---|---|
| 1024px | 352px | 48px (p-6 × 2) | ≈ 590px |
| 1440px | 352px | 48px | ≈ 1010px |

Both numbers comfortably fit `LayerSegmentedControl` (~170px at `size="sm"`,
two `px-2.5 py-1` segments with icon+label) plus a `Focus` button (~90px) on
one line with room to spare — width is **not** the constraint at either end
of the range, which resolves the ambiguity flagged in the task file. The
detail actually worth pinning down is **not** wrapping math, it's **not
stretching**:

- **Do not** pass `className="w-full"` to `LayerSegmentedControl` here (it
  is `w-full` in the existing docked-panel form,
  `AnnotateFullscreenOverlay.jsx:480` — that usage does not carry over).
  `w-full` at 590px of available width would balloon each segment's padding
  into a stretched, oddly-proportioned control that reads as a broken layout
  rather than a compact toolbar control.
- **Left-align, don't spread.** Keep `Layer` and `Focus` adjacent
  (`gap-3`, no `justify-between`, no `ml-auto` on `Focus`) so they read as
  one related toolbar cluster — this matches the "context toolbar grammar"
  the UX review calls out (CapCut-style controls sit together near what they
  affect, they don't spread across the full available width). A
  `justify-between` layout would leave a large dead gap in the middle of the
  row at 1024px specifically (Layer left, Focus far right, ~400px of empty
  space between them) which is the concrete failure mode this callout exists
  to prevent.
- **In create mode, `Focus` doesn't render at all** (gated on
  `existingClip?.autoProjectId`, which cannot exist before the first Save —
  same reasoning as `ClipDetailsEditor.jsx:407-415`). The row is `Layer`
  alone (~170px), sitting short and left-aligned under the strip. That is
  correct at every width in this range, not just the low end — don't add a
  min-width or centering to make a one-control row "look fuller."
- This is the **same class set from 1024px up through 1440px and beyond** —
  no intermediate breakpoint variant (no `lg:`/`xl:` split) is needed inside
  this range. The row's natural compact width plus `flex-wrap` (a safety net
  that will never actually trigger above ~450px of content width) is
  sufficient at every size the sidebar layout supports.

### No title/accessible-name collisions (T8130 landmine check)

`ClipDetailsEditor`'s own `Focus`/`Create Reel` controls
(`ClipDetailsEditor.jsx:390-434`) only render when
`!isMobile && selectedRegion && !showAddClipForm`
(`ClipsSidePanel.jsx:323`). The strip's `Focus`/`Create Reel` only render
when the editor **is** open (`showAddClipForm` true). These two states are
already mutually exclusive by the existing gate — confirmed no double-render,
no title collision to design around here. (The transport-bar Add/Edit button
in `AnnotateControls` is a separate, real landmine — see §5.)

---

## 5. One wiring note for the Architect (not a visual spec item)

`AnnotateControls.jsx` (the small transport-bar Add/Edit icon button,
rendered inside the `!mobileFs` branch at `AnnotateModeView.jsx:628-645`)
still calls the same `onAddClip` while the desktop strip is open. Today it is
only suppressed for the mobile sheet:

```js
onAddClip={mobileInlineForm ? undefined : onAddClip}   // AnnotateModeView.jsx:641
```

Extend that same "pass `undefined` to hide" pattern to
`desktopEditorOpen` (`onAddClip={(mobileInlineForm || desktopEditorOpen) ? undefined : onAddClip}`) — this is the fix for UX review risk (e) item 3 (the
transport button silently flipping an open edit into a create via
`startCreating()`). No new visual treatment needed, just extending an
existing conditional; flagging it here so it isn't dropped between this spec
and the design doc.

---

## 6. Summary of what's reused unchanged vs. new

| Element | Status |
|---|---|
| Tags block classes (`TagSelector size="lg"` / `NoSportTagWarning`) | **Unchanged**, copied verbatim into both the desktop panel (§2.4) and mobile popup (§3.2) |
| Notes textarea classes | **Unchanged** apart from `rows` (2 desktop / 4 mobile) and dropping the `!isMobile` gate (mobile gains the field via the popup) |
| Save/Cancel button classes | **Unchanged** (`AnnotateFullscreenOverlay.jsx:537-552`), just relocated into the strip's controls row and compacted to `py-1.5` |
| `ClipScrubRegion` | **Unchanged component**, switched from `compact` (352px sidebar) to non-compact (full-width strip) |
| `LayerSegmentedControl` | **Unchanged component**, dropped the `w-full` className in the new row only |
| `Focus` button | **Unchanged pattern** (`variant="cyan" size="sm" icon={Crop}`), copied from `ClipDetailsEditor.jsx:407-415` |
| Green/yellow tint | **New usage** of an existing token pair (`bg-{color}-950/20 border-{color}-800/40`, sourced from the expired-source panel) |
| Strip header, controls row layout, "Add details" disclosure/label, mobile full-screen popup | **New** — specified fully above |

Once implemented and approved, fold the tint pattern (§1) and the "mode-swap
strip" layout (§2) into `.claude/references/ui-style-guide.md` as a new
pattern entry — not done in this pass since nothing is built yet.

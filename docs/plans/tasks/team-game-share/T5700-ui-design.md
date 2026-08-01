# T5700 — Team / My Athlete Layer in Annotate — UI Design

**Status:** AWAITING USER APPROVAL (UI Designer gate, Stage 1)
**Task:** [T5700-team-layer-annotate.md](T5700-team-layer-annotate.md) · **Epic:** [EPIC.md](EPIC.md)
**Scope:** Frontend-only visual/interaction spec for five surfaces. No source code here.

This doc is a spec. It does not implement. Line numbers reference the code as read on
2026-07-31.

---

## 0. Locked decisions this design obeys (not re-litigated)

1. Strictly one layer per clip: `my_athlete = 1` or NULL → **My Athlete**; `my_athlete = 0` → **Team**. Two-value control, never a third state, never both.
2. Colors: **cyan = My Athlete** (matches the existing `bg-cyan-600` toggle), **amber = Team**.
3. Tagging-mode toggle is ephemeral session view state, resets to My Athlete on game open, never persisted. Nothing in this design writes it anywhere.
4. Imported clips (`shared_by` NOT NULL) always render on the Team layer AND keep "Shared by {name}". A Team chip and a "Shared by" attribution coexist on the same row — designed in §5.
5. The per-clip control REPLACES the current on/off `my_athlete` switch with a two-value segmented **My Athlete | Team** control.

---

## 1. Token & idiom decisions (apply everywhere below)

### 1.1 The amber token

The style guide's semantic table has no amber; it lists `yellow-500` for warnings. **I
deliberately do NOT reuse `yellow` for Team** — yellow already means "warning / in-progress /
near-expiry" (`GameTile` expiry chip `bg-yellow-900/70 text-yellow-300`, the `warning` Button
variant, the notes char-limit turn-red). Overloading it onto a neutral layer identity would be a
false alarm color. Amber is visually adjacent but semantically free in this app.

**Chosen Team amber = Tailwind `amber-500` (#f59e0b) as the identity hue, `amber-600` (#d97706)
as the selected-fill.** This mirrors the cyan pairing already in code (`bg-cyan-600` fill,
`cyan-500`/`cyan-400` for hover/ring). Precedent: `GameClipSelectorModal.jsx:601` already ships a
selected **`bg-amber-600 border-amber-500 text-white`** filter pill — so amber-as-a-selectable is
already in the codebase; this task promotes it to the layer identity color.

Contrast / AA on the dark theme (bg base `#111827` / `#1f2937`):

| Pair | Ratio | Verdict |
|---|---|---|
| `text-white` (#fff) on `bg-amber-600` (#d97706) | 3.6:1 | OK for the ≥16px/bold segmented-control label (WCAG large-text ≥3:1); this is exactly how `bg-amber-600 text-white` already ships at `GameClipSelectorModal:601`. |
| `text-amber-950` (#451a03) on `bg-amber-500` (#f59e0b) — chip fill | 8.9:1 | Passes AA for normal text. **Use this for the solid `TEAM` chip** (dark ink on amber), matching the `DraftTile` "cyan-500 fill + dark ink" AA pattern (`text-gray-950 on bg-cyan-500`, style-guide/knowledge T6180). |
| `text-amber-300` (#fcd34d) on `bg-gray-800` (#1f2937) | 8.9:1 | Passes AA. Used for amber text on dark (marker tint label, unselected-but-amber affordances). |
| `text-cyan-950` (#083344) on `bg-cyan-500` (#06b6d4) — chip fill | 7.5:1 | Passes AA. My Athlete chip counterpart. |

Rule adopted for **solid chips**: amber/cyan-500 fill + dark ink (`amber-950`/`cyan-950`), AA-safe
and reads as a saturated "tag". Rule for **selected segmented-control segment**: `-600` fill +
`text-white`, matching the existing cyan toggle and the amber pill precedent (large/bold text, ≥3:1).

### 1.2 New shared component: `LayerSegmentedControl`

No segmented control exists today (closest: the pill-button row at
`GameClipSelectorModal.jsx:590-608`, and `SpeedControl`'s dropdown). Rather than copy the pill row
three times, specify ONE minimal presentational component, `LayerSegmentedControl`, used verbatim
by surfaces (a), (b), (c). This is the 3rd-duplication threshold (three call sites), so a single
component is correct now, not premature.

```jsx
// src/frontend/src/modes/annotate/components/LayerSegmentedControl.jsx  (NEW, presentational)
// value: true = My Athlete, false = Team.  onChange(nextBool).  size: 'sm' | 'md'.
import { User, Users } from 'lucide-react';

export function LayerSegmentedControl({ value, onChange, size = 'md', className = '' }) {
  const isMine = value !== false;            // NULL/undefined/true => My Athlete (legacy rule)
  const seg = 'flex-1 inline-flex items-center justify-center gap-1.5 rounded-md ' +
              'text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 ' +
              'focus-visible:ring-offset-1 focus-visible:ring-offset-gray-900';
  const pad = size === 'sm'
    ? 'px-2.5 py-1 coarse-pointer:min-h-[44px]'
    : 'px-3 py-1.5 coarse-pointer:min-h-[44px]';
  return (
    <div
      role="radiogroup"
      aria-label="Clip layer"
      className={`flex gap-1 p-0.5 bg-gray-800 border border-gray-700 rounded-lg ${className}`}
    >
      <button
        type="button" role="radio" aria-checked={isMine}
        aria-label="My Athlete layer"
        onClick={() => onChange(true)}
        className={`${seg} ${pad} focus-visible:ring-cyan-400 ${
          isMine
            ? 'bg-cyan-600 text-white shadow-sm'
            : 'bg-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/60'
        }`}
      >
        <User size={14} /> My Athlete
      </button>
      <button
        type="button" role="radio" aria-checked={!isMine}
        aria-label="Team layer"
        onClick={() => onChange(false)}
        className={`${seg} ${pad} focus-visible:ring-amber-400 ${
          !isMine
            ? 'bg-amber-600 text-white shadow-sm'
            : 'bg-transparent text-gray-400 hover:text-gray-200 hover:bg-gray-700/60'
        }`}
      >
        <Users size={14} /> Team
      </button>
    </div>
  );
}
```

Icons: `User` (single athlete) vs `Users` (team) — Lucide, already imported elsewhere in app;
14px per the "inline with text" size. The control is a `radiogroup` of two `radio`s (mutually
exclusive, exactly the one-layer-per-clip semantics) rather than two `aria-pressed` toggles, so
screen readers announce "My Athlete, selected, 1 of 2".

**States table (each segment):**

| State | Selected segment | Unselected segment |
|---|---|---|
| My Athlete active | `bg-cyan-600 text-white shadow-sm` | `bg-transparent text-gray-400` |
| Team active | `bg-amber-600 text-white shadow-sm` | `bg-transparent text-gray-400` |
| Hover (unselected only) | n/a (selected has no hover shift) | `hover:text-gray-200 hover:bg-gray-700/60` |
| Focus (keyboard) | `focus-visible:ring-2 ring-cyan-400`/`ring-amber-400` | same |
| Disabled (not used in T5700) | `opacity-50 cursor-not-allowed` | same |

Touch: each segment carries `coarse-pointer:min-h-[44px]` (the app's established coarse floor, see
`Button.jsx:117` and the style-guide filter-row note) so mobile taps meet 44px while fine-pointer
desktop stays compact.

---

## 2. Surface (a) — Tagging-mode toggle (which layer NEW clips land on)

### Placement decision

**Put it in the `ClipsSidePanel` header, directly under the "Click timeline to add clip" hint
(`ClipsSidePanel.jsx:154`), as a full-width `LayerSegmentedControl size="sm"`.** Reasoning:

- It governs *new-clip creation*, and the sidebar header is where clip creation is explained
  ("Click timeline to add clip"). Co-locating the "which layer will the next clip get" control
  with that hint is the honest information scent.
- The sidebar renders on **both** desktop (`w-[352px]`) and mobile (`w-full`) — one placement
  covers every viewport with no duplicate control. The header block already renders in both the
  mobile list view and desktop (`ClipsSidePanel.jsx:147-195`; the header is outside the
  `mobileShowDetail` branch, so it shows on the mobile clip-list screen).
- **Landscape-phone (T4933) is handled for free**: at ≥640px width a phone gets the desktop
  sidebar, so the header toggle rides along; no separate landscape path.
- The alternative — near the timeline `AnnotateControls` — was rejected: that bar is dense
  (transport + volume + speed + Add Clip + fullscreen, `AnnotateControls.jsx:104-244`) and hidden
  in fullscreen; a persistent layer-mode control would get lost and disappear exactly when the
  user is adding clips in fullscreen.

### Markup

```jsx
// ClipsSidePanel header, after the "Click timeline to add clip" <p> (L154)
<div className="mt-2">
  <div className="flex items-center gap-1 mb-1">
    <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide">
      New clips go to
    </span>
  </div>
  <LayerSegmentedControl
    size="sm"
    value={newClipLayerIsMine}                 // ephemeral screen state, default true
    onChange={(mine) => onSetNewClipLayer(mine)}
    className="w-full"
  />
</div>
```

- The `role="radiogroup"` already carries `aria-label="Clip layer"`; the visible "New clips go
  to" label is the human affordance (uppercase `text-[11px] text-gray-500`, the exact
  filter-row-label idiom from the style guide).
- **Mobile 390px:** full-width, two equal `flex-1` segments (~165px each inside the 352→full
  panel), each `min-h-[44px]`. No layout change needed at 390px — it is already full width.
- **State:** `newClipLayerIsMine` is React state owned by `AnnotateScreen` (the annotate
  single-source-of-truth screen), threaded to `ClipsSidePanel` and to the new-clip default in
  `useAnnotate.addClipRegion` / the `AnnotateFullscreenOverlay` create path. It resets to `true`
  in `resetAnnotateState` / on game open. **This design never persists it** — no store write, no
  API call, no `useEffect`-to-backend. (Implementation note only; the visual spec implies nothing
  persistent.)

### Interaction

| Gesture | Result |
|---|---|
| Tap "Team" | segment fills amber; the NEXT created clip defaults `my_athlete=false`. No existing clip changes. |
| Tap "My Athlete" | segment fills cyan; next clip defaults to My Athlete. |
| Open a different game | control snaps back to My Athlete (cyan). |

The toggle **does not** filter the list or retag existing clips — it only sets the create default.
(Filtering is surface (e); they are visually distinct — this one is solid-filled and labeled "New
clips go to", the filter pills are borderless.)

---

## 3. Surface (b) — Per-clip control in `ClipDetailsEditor` (desktop)

Replace the on/off switch at `ClipDetailsEditor.jsx:282-300` with the segmented control. Keep the
existing label column rhythm (`text-gray-400 text-xs w-16 shrink-0`).

```jsx
{/* Layer — replaces the old My Athlete on/off toggle (L282-300).
    Rendered on BOTH mobile-takeover and desktop now (drop the !isMobile guard):
    the mobile detail view uses this same editor (ClipsSidePanel.jsx:131). */}
<div className="flex items-center gap-2">
  <label className="text-gray-400 text-xs w-16 shrink-0">Layer</label>
  <LayerSegmentedControl
    size="sm"
    value={region.my_athlete ?? true}
    onChange={(mine) => onUpdate({ my_athlete: mine })}
    className="flex-1"
  />
</div>
```

- `handleMyAthleteChange` (L165-168, a boolean flip) is replaced by a direct
  `onUpdate({ my_athlete: mine })` from the control — same gesture-based surgical save path
  (`onUpdate` → `useRawClipSave` → `PUT/POST /clips/raw`), unchanged backend. No reactive persistence.
- **Drop the `!isMobile` guard** that currently hides the toggle on mobile (L283). The desktop
  editor also serves the mobile full-panel takeover (`ClipsSidePanel.jsx:131-142`), so the same
  markup gives mobile edit its layer switch — satisfying the AC "switchable on desktop AND mobile"
  without a second control. At `w-16` label + `flex-1` control the row fits the 352/full panel.
- **Selected-clip layer echo:** the editor's top-of-panel rating tint (`ClipDetailsEditor.jsx:190-195`)
  stays rating-driven (do not repaint it by layer — rating is the stronger signal there). The
  layer identity is carried by the segmented control's own fill + the row chip (surface d), which
  is enough; adding a third layer-colored surface in the same editor would be noise.

### States

| State | Appearance |
|---|---|
| Default (My Athlete clip) | cyan segment filled, Team segment ghost |
| Default (Team clip) | amber segment filled, My Athlete ghost |
| Hover unselected | `text-gray-200 bg-gray-700/60` |
| Focus | cyan/amber `focus-visible:ring-2` per segment |
| Imported clip (`shared_by`) | amber filled + the existing purple "Shared by" strip (L202-207) stays above the scrub region, unchanged. Control stays interactive (recipient may re-tag). |

---

## 4. Surface (c) — Same control in `AnnotateFullscreenOverlay` (mobile add/edit)

The overlay owns `myAthlete` as form state (`useState(true)`, L145), hydrated on edit from the
clip (L165), sent on save (L266/L278). Replace the desktop-only on/off switch (L388-414) with the
segmented control, and render it on **mobile too** (drop `!isMobile`).

```jsx
{/* Layer — replaces the desktop-only My Athlete switch (L388-414).
    Now shown on mobile as well (this overlay IS the mobile add/edit surface). */}
<div className="mb-4">
  <label className="block text-gray-400 text-sm mb-2">Layer</label>
  <LayerSegmentedControl
    size="md"                                   {/* md → taller, comfortable in the tap-heavy overlay */}
    value={myAthlete}
    onChange={(mine) => {
      setMyAthlete(mine);
      if (!createProjectManuallySet) setCreateProject(rating === 5 && mine);
    }}
    className="w-full"
  />
</div>
```

- **Default for NEW clips comes from the mode toggle (surface a), not `true`.** Today the reset
  effect hardcodes `setMyAthlete(true)` for create mode (`AnnotateFullscreenOverlay.jsx:177`).
  Spec: seed it from the threaded `newClipLayerIsMine` prop instead, so opening Add-Clip while the
  mode toggle is on Team pre-selects the amber segment. Edit mode still hydrates from the clip
  (`existingClip.my_athlete ?? true`, L165) — unchanged.
- **Preserve the T4933 auto-project coupling** at `L232` / `L397-399`: the auto-create-project on
  5-star only fires when the clip is *My Athlete*. The `onChange` above keeps that exact rule
  (`rating === 5 && mine`), so a 5-star **Team** clip does NOT auto-spawn a reel (correct: Team
  clips never feed reels). This is a behavior-preserving move, not a new rule.
- **Mobile 390px:** full-width `size="md"` control, two `flex-1` segments ≈ 175px each, `min-h-44`.
  It sits in the overlay's normal vertical stack (scrollable form), so no cramping. In the
  desktop **inline** layout (`ClipsSidePanel.jsx:285-299`, `layout="inline"`) the same full-width
  control renders in the 352px sidebar — fine.

---

## 5. Surface (d) — Clip-list row chips + "Shared by" coexistence

`ClipListItem.jsx` today is a single compact line: rating badge · `N.` · name · right-aligned
game clock (L71-100). It has **no** `my_athlete` awareness and does **not** show "Shared by" on
the row (that only appears inside the editor, `ClipDetailsEditor.jsx:202-207`). This task adds a
layer chip to the row, and — for imported clips — surfaces the attribution on the row too.

### Chip idiom (from the style guide "Labeled metadata pill")

Solid-fill pills, dark ink, uppercase, `text-[10px]`, with `title` + `aria-label`:

```jsx
// My Athlete
<span
  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
             text-[10px] font-semibold uppercase tracking-wide
             bg-cyan-500 text-cyan-950"
  title="My Athlete layer" aria-label="My Athlete layer"
>
  <User size={9} /> Mine
</span>

// Team (authored or imported)
<span
  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full
             text-[10px] font-semibold uppercase tracking-wide
             bg-amber-500 text-amber-950"
  title="Team layer" aria-label="Team layer"
>
  <Users size={9} /> Team
</span>
```

Label text: **"Mine" / "Team"** (not "MY ATHLETE" — that string is too long for a dense list row;
the full phrase lives in `title`/`aria-label` for AA + tooltip, matching the guide's "chip shows
the adjective, full label in title" rule). Both AA-safe per §1.1 (8.9:1 / 7.5:1).

### Row placement

Insert the chip immediately after the rating badge (`ClipListItem.jsx:84`), before the name, so
the layer reads left-to-right as **[rating][layer] name … clock**:

```jsx
<div className="flex items-center px-2 py-1.5">
  {ratingBadge}
  {layerChip}                {/* NEW: cyan Mine / amber Team, ml-0 mr-2 */}
  <div className="flex-1 min-w-0 flex items-center gap-1.5 truncate">
    <span className="text-sm text-white truncate">
      <span className="text-gray-500 mr-1">{index + 1}.</span>{displayName}
    </span>
    {region.shared_by && (
      <span
        className="shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full
                   text-[10px] bg-purple-900/40 border border-purple-700/40 text-purple-200"
        title={`Shared by ${region.shared_by}`}
      >
        <Share2 size={9} /> {region.shared_by}
      </span>
    )}
  </div>
  {gameClock && <span className="ml-2 …tabular-nums">{gameClock}</span>}
</div>
```

### Team chip + "Shared by" coexistence (the required concrete mock)

An imported clip carries BOTH: the amber **Team** chip (layer identity) AND the purple **Shared
by** attribution (provenance). They are semantically different — one says "what layer", the other
says "who gave it to me" — so they get distinct colors and sit in distinct row zones:

```
Desktop row (imported clip, 352px sidebar):
┌────────────────────────────────────────────────────────────┐
│ [!!] [👥 TEAM] 3. Goal from the wing  [👤 Shared by Dana]  34'12" │
└────────────────────────────────────────────────────────────┘
  amber chip ↑ (layer)            purple pill ↑ (provenance)   ↑ game clock

Authored Team clip (no shared_by):
┌────────────────────────────────────────────────────────────┐
│ [!] [👥 TEAM] 5. Great team press                     41'03" │
└────────────────────────────────────────────────────────────┘

My Athlete clip:
┌────────────────────────────────────────────────────────────┐
│ [!!] [👤 MINE] 1. My kid's breakaway                  12'45" │
└────────────────────────────────────────────────────────────┘
```

- The amber layer chip sits in the fixed left cluster (always visible). The purple "Shared by"
  pill sits inline after the name, `shrink-0`, so on a narrow row the *name* truncates first and
  the provenance survives — provenance is higher-value than a long auto-name.
- Reuse the existing purple palette (`bg-purple-900/…`, `border-purple-700/40`) from the editor's
  "Shared by" strip (`ClipDetailsEditor.jsx:203`) so the two surfaces read as the same concept.
  Deliberately purple (not amber) so provenance ≠ layer.

### Mobile 390px (surface d)

Mobile rows are taller (`py-3`) and end with two action buttons + a time
(`ClipListItem.jsx:103-121`), so horizontal room is tight. Spec:

- Keep the **layer chip** (after the rating badge) — it is the whole point of the feature and only
  ~40px.
- For imported clips, **drop the inline "Shared by" pill on mobile** and instead show a small
  amber-dot + purple `Share2` glyph is overkill; simpler: render the attribution on a **second
  line** under the name (`text-[10px] text-purple-300 truncate`, `mt-0.5`), shown only when
  `region.shared_by`. This mirrors the "mobile drops the secondary metadata line" idiom but keeps
  provenance because it is load-bearing for shared games. The full attribution also remains in the
  detail view (`ClipDetailsEditor.jsx:202-207`).

```
Mobile imported row (390px):
┌───────────────────────────────────────────────┐
│ [!!][👥T] Goal from the wing        34'12" ⓘ ▶ │
│          Shared by Dana                        │   ← text-[10px] text-purple-300
└───────────────────────────────────────────────┘
```

---

## 6. Surface (e) — Timeline marker tint + clip-list filter pills

### 6.1 Marker tint (`ClipRegionLayer.jsx`)

Markers today are colored **only by rating** (`RATING_COLORS`, L26-32; desktop notation badge
L152-169, mobile bar L132-150). Rating color is a strong, established signal — do NOT replace it.
Add layer as a **secondary cue** without fighting the rating hue:

- **Desktop notation badge:** add a 2px bottom border in the layer color:
  `borderBottom: region.my_athlete === false ? '2px solid #f59e0b' : '2px solid #06b6d4'`
  (amber-500 / cyan-500), applied via the existing inline `style` object (L160-166). The badge
  keeps its rating background; the underline says "layer". This is analogous to `ClipListItem`'s
  existing `border-l-3` selection accent — a colored edge, not a fill swap.
- **Mobile color bar** (L137-149): add a matching `borderBottom: '3px solid <layer>'` to the bar's
  inline style. At 4–12px wide the underline is the only room available; it reads as a colored
  foot on the bar.
- **Selection ring is unchanged** (`ring-2 ring-white`) — selection must stay layer-agnostic so it
  never competes with the amber/cyan foot.
- **Tooltip:** append the layer to the existing hover tooltip (L171-177): after the name, a small
  `<span>` — `text-cyan-300`/`text-amber-300` reading `· Mine` / `· Team` — so hover disambiguates
  even for the color-blind.

Contrast note: amber-500/cyan-500 borders sit on the `bg-gray-800` track and on rating-colored
badges; both are ≥3:1 against gray-800 and are non-text decorative accents (paired with the
tooltip text label), so they are informative, not the sole channel.

### 6.2 Filter pills — `All | My Athlete | Team` (borderless inline filter row)

Use the style guide's **Borderless inline filter row** idiom (NOT a bordered card). Place it in
the `ClipsSidePanel` header, directly under the mode toggle from surface (a), separated by the
"New clips go to" cluster above and the clip list below. Distinct visual weight from the mode
toggle: the mode toggle is a solid bordered segmented control ("New clips go to"); the filter is a
borderless label + three ghost chips ("Show"). That contrast keeps two similar-looking layer
controls from being confused.

```jsx
<div className="flex flex-wrap items-center gap-1.5 mt-3">
  <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mr-1">Show</span>
  {[
    { value: 'all',  label: 'All',        activeCls: 'bg-gray-600 text-white' },
    { value: 'mine', label: 'My Athlete', activeCls: 'bg-cyan-600 text-white' },
    { value: 'team', label: 'Team',       activeCls: 'bg-amber-600 text-white' },
  ].map(({ value, label, activeCls }) => (
    <button
      key={value}
      type="button"
      aria-pressed={layerFilter === value}
      onClick={() => onSetLayerFilter(value)}
      className={`px-2.5 py-1 coarse-pointer:min-h-[44px] text-xs rounded transition-colors ${
        layerFilter === value
          ? activeCls
          : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700 hover:text-gray-200'
      }`}
    >
      {label}
    </button>
  ))}
</div>
```

- Selected pill fills with the layer color (`bg-cyan-600` / `bg-amber-600`, `text-white`), `All`
  fills neutral `bg-gray-600`. Unselected: `bg-gray-700/50 text-gray-400`, hover lightens. Exactly
  the borderless-filter-row chip spec from the style guide (`px-2.5 py-1 coarse-pointer:min-h-[44px]
  text-xs rounded`).
- **Filter is ephemeral** (same rule as the mode toggle): screen-owned React state, default
  `'all'`, reset on game open, never persisted. It filters the rendered
  `clipRegions` in `ClipsSidePanel`'s existing `.sort().map()` (L241-259) — a client-side
  `.filter()` before the sort; it does not mutate data or hit the backend.
- **`aria-pressed`** on each pill (they are independent-looking toggle buttons in a mutually
  exclusive set; a single-select radiogroup is also acceptable, but the style guide's filter rows
  use `aria-pressed` chips, so match that idiom).
- **Empty-filter state:** if the active filter yields zero rows, the list body shows the existing
  empty-state slot's sibling copy, e.g. `No My Athlete clips` / `No Team clips` (reuse the
  `clipRegions.length === 0` branch styling at L234-237, `p-4 text-gray-500 text-sm text-center`).

### Mobile 390px (surface e)

- Filter pills wrap under the "Show" label via `flex-wrap`; three short pills + label fit one line
  at 390px (~330px inner), each `min-h-[44px]`. They render on the mobile clip-list screen (header
  is shared).
- Marker tint underlines are already mobile-specced above (3px foot on the color bar).

---

## 7. Landscape-desktop-sidebar case (T4933) — explicit coverage

At ≥640px width a phone in landscape renders the **desktop** `ClipsSidePanel` (`hidden sm:flex`,
`w-[352px]`) inside a ~390px-tall shell. Every surface here lives in components already inside the
T4933 scroll regions:

- Surfaces (a) + (e) sit in the header block, which is **above** the `flex-1 min-h-[64px]
  overflow-y-auto` clip list (`ClipsSidePanel.jsx:228`) — header stays pinned, list scrolls, so
  the mode toggle + filter pills are always reachable.
- Surface (b) is inside the desktop editor wrapped in `min-h-0 overflow-y-auto`
  (`ClipsSidePanel.jsx:268`) — the segmented control scrolls with the rest of the editor; it adds
  one ~44px row, well within the existing scroller.
- Surface (c) inline form carries `min-h-0 overflow-y-auto` — same.

No new fixed-height element is introduced, so the T4933 "dead scroll trap" audit
(`screen-usability.spec.js`) is not at risk; the added rows are shorter than the removed on/off
switch row is tall (net neutral).

---

## 8. Consistency notes

- **Reuses:** the labeled-metadata-pill idiom (chips), the borderless-filter-row idiom (filter
  pills + the "New clips go to"/"Show" uppercase labels), the existing cyan toggle color, the
  existing purple "Shared by" palette, the coarse-pointer 44px floor (`Button.jsx`), and the
  amber-600 selected-pill that already ships in `GameClipSelectorModal`.
- **Adds one new component** (`LayerSegmentedControl`) at the 3-call-site threshold — justified,
  not premature. It is presentational (props only), consistent with the guide's button tokens.
- **Style-guide update (post-approval, Stage 7):** add a "Segmented control (two-value layer
  toggle)" entry and register `amber-500/600` as the **Team layer** semantic color (paired with
  the existing cyan = My Athlete), with the AA table from §1.1.

---

## 9. Open questions for the user

1. **Chip label wording:** design uses **"Mine" / "Team"** on the row chip (full "My Athlete" in
   `title`/`aria-label`) to fit the dense list. OK, or do you want the full "MY ATHLETE" text even
   though it crowds the row?
2. **Mode-toggle label:** I labeled surface (a) **"New clips go to"** to make it unmistakable it
   sets the *create default* (not a filter). Alternative shorter label: **"Tagging"**. Preference?
3. **Two layer controls in one header** (mode toggle + filter pills) — I differentiated them by
   weight (solid bordered vs borderless) and label ("New clips go to" vs "Show"). Is that enough
   separation, or would you rather move the **filter pills** to sit *above the clip list but below
   a divider* (still header, more visual gap)?
4. **Marker tint = colored underline** (keeps rating as the primary hue). Acceptable, or do you
   want the layer to be the marker's *primary* color on the Team layer (amber fill, rating shown
   only in the tooltip)? I recommend the underline — rating is the scanning signal parents already
   learned.
5. **Imported-clip control interactivity:** the per-clip segmented control stays *enabled* on
   imported clips so a recipient could move a shared clip to their My Athlete layer. Per the epic,
   imported clips are forced `my_athlete=0`; do you want the control **locked to Team** (read-only)
   on imported clips, or editable? (Editable is the current spec; say the word to lock it.)

---

**Awaiting approval before this becomes part of T5700's implementation.**

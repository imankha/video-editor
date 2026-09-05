# T8555 — UI Spec: Four-Tab Segmented Control

**Scope:** Visual + interaction layer ONLY for the Home-screen segmented tab bar going from
THREE tabs (Games / Clips / Highlights) to FOUR (Games / In Progress Clips / In Progress
Reels / Published). Component decomposition (splitting `DownloadsPanel` into two tab bodies)
is the Architect's `T8555-design.md`; this doc owns layout, breakpoints, icons, color tokens,
badge rendering, and empty states, and is referenced by the design doc for those.

**Status:** DRAFT — awaiting user approval at the design gate before implementation.
**Frontend-only. Do not implement until approved.**

---

## 0. What this inherits from T8545 (unchanged, load-bearing)

The current bar is `ProjectManager.jsx` `SegmentedTabButton` (L390-427) inside a container at
L1234. Three things carry over **exactly as-is** — this spec extends the pattern to a 4th peer,
it does not redesign it:

1. **Stacked icon-over-label below `sm`, single inline row at `sm`+.** Button is
   `flex flex-col sm:flex-row` with the icon visually first via `order-first`.
2. **Dual badge, one hidden per breakpoint.** Mobile corner badge (rides the icon's top-right
   corner, `sm:hidden`) + desktop inline pill (`hidden sm:inline`). Both always in the DOM;
   CSS hides one. No DOM-structure swap at the breakpoint.
3. **DOM-order landmine (MUST hold for all four tabs).** The label `<span>` MUST stay BEFORE
   the icon+badge `<span>` in DOM order. `order-first` moves the icon *visually only*.
   Accessible-name computation follows document order, so label-first is what makes the button's
   name read `"{label}{count}"` (e.g. `"In Progress Clips1"`), not badge-digit-first
   (`"1In Progress Clips"`). Breaking this breaks screen readers AND
   `getByRole('button', {name: /^In Progress Clips/})` locators. **No change to the two-span
   ordering — the new two-word labels ride inside the same first `<span>`.**

The only structural change T8555 makes to the button component is allowing the label to **wrap
to two lines** at narrow widths (see §1). No new spans, no reordering, no new props beyond what
already exists (`active, disabled, title, onClick, Icon, label, count, activeBg, activeBgDark`).

---

## 1. Four-tab layout at 320px / 375px / desktop

### The problem
T8545 already needed the stacked layout to fit THREE single-word labels at 320px. Four tabs is
harder because two labels are now **two words each**: "In Progress Clips" and "In Progress
Reels". At `grid-cols-4` on a 320px screen, each column is ~76px of content width (320 − 16px
container padding − a little inter-cell gap, ÷4). "In Progress Reels" cannot fit on one line in
that column at the current `text-[11px]`.

### Options evaluated

| Option | Verdict |
|---|---|
| **A. Rename to shorter labels** (e.g. "Clips" / "Reels") | **REJECTED.** The user explicitly DECIDED the names "In Progress Clips" / "In Progress Reels". Not ours to change. |
| **B. `grid-cols-4` + two-line wrap for the long labels** | **CHOSEN.** The label span already has `leading-tight text-center`; letting it wrap is a one-class change (`whitespace-normal`, already the default) plus a small font drop at the narrowest step. "In Progress Clips" wraps to `In Progress` / `Clips`; "Games"/"Published" stay one line. Rows stay height-aligned because every column is the same grid track height (grid stretches all cells to the tallest). |
| **C. Horizontal scroll / overflow the bar** | **REJECTED.** Hides tabs off-screen; a top-level nav must show all peers at once. |
| **D. Icon-only below `sm`, labels only `sm`+** | **REJECTED.** T8545 deliberately keeps labels visible on mobile (icons alone are ambiguous for "In Progress Clips" vs "In Progress Reels", which would share a work-in-progress metaphor). Regresses discoverability. |

**Decision: Option B — `grid-cols-4`, two-line wrap, font shrinks one step at the narrowest
breakpoint.** This is the smallest change that respects the fixed names and keeps the T8545
pattern intact.

### Exact Tailwind — container (replaces L1234)

```jsx
{/* T8555: four peer tabs. Stacked icon-over-label equal-quarters grid below `sm`,
    single-row content-width bar at `sm`+. Same shape as the T8545 three-tab bar,
    grid-cols-3 -> grid-cols-4. */}
<div className="grid grid-cols-4 gap-1 w-full sm:flex sm:w-auto sm:items-center bg-white/5 rounded-lg p-1 mb-4">
```

Only `grid-cols-3` → `grid-cols-4` changes on the container. Everything else
(`gap-1 w-full sm:flex sm:w-auto sm:items-center bg-white/5 rounded-lg p-1 mb-4`) is unchanged.

### Exact Tailwind — button label span (inside `SegmentedTabButton`, replaces L411)

Current:
```jsx
<span className="text-[11px] sm:text-sm leading-tight text-center">{label}</span>
```

New (RESOLVED: `tailwind.config.js` has NO `xs` screen → the `xs:` step is dropped per the fallback below):
```jsx
{/* T8555: labels can now be two words ("In Progress Clips/Reels"); allow wrapping
    to two lines below `sm` and drop one font step at the 320px class so the longest
    label fits a ~72px grid column. Single row + full size restored at `sm`+ where
    the bar is content-width, not a 4-up grid. */}
<span className="text-[10px] sm:text-sm leading-tight text-center whitespace-normal break-words">{label}</span>
```

Notes on the class choices:
- `text-[10px]` at the base (≤ `xs`) buys the extra fit for "In Progress" at 320px; `xs:text-[11px]`
  restores the T8545 mobile size at ≥375px where the column is wider; `sm:text-sm` is the
  desktop size, unchanged.
- **`xs` breakpoint check — RESOLVED:** `tailwind.config.js` defines NO `xs` screen (only the
  `fine-pointer`/`coarse-pointer` variants), so the `xs:text-[11px]` token is DROPPED — final
  class is `text-[10px] sm:text-sm` (10px reads fine at both 320 and 375). Both label spans
  (Games/Published single-word and the two-word ones) use the SAME class string so all four
  columns share a baseline.
- `whitespace-normal break-words` lets the long labels wrap; single-word labels are unaffected
  (they never reach the wrap width).
- `text-center` (already present) keeps the two wrapped lines centered under the icon.

**Container height at wrap:** the two-line label makes the mobile stacked buttons ~14px taller.
Because it's a grid, all four cells grow together — Games/Published render their single-word
label on one line but the cell still reserves the two-line height, so the four icons stay
vertically aligned. This is the desired look (no ragged tab heights). No explicit `min-h` needed;
the grid handles it. If the implementor wants belt-and-suspenders alignment, add `min-h-[3.25rem]`
to the button at the base breakpoint only (`sm:min-h-0`) — optional, not required.

### Confirmation: pattern + constraint carry over
- Stacked-icon-over-label: **unchanged** (same `flex flex-col sm:flex-row` + `order-first`).
- Dual-badge render: **unchanged** (see §4).
- DOM-order label-first: **unchanged and now MORE important** — a two-word label makes a
  badge-first accessible name (`"1In Progress Clips"`) even uglier and the `/^In Progress/`
  locator even more relied-upon. The label span stays first.

---

## 2. Icon per tab

Recommendation (all four verified present in the installed `lucide-react`):

| Tab | Icon | Import name | Rationale |
|---|---|---|---|
| **Games** | game controller | `Gamepad2` | **Unchanged** from today. |
| **In Progress Clips** | scissors | `Scissors` | A clip is a *cut* from a game — scissors reads as "clipping/extraction," the single-clip capture step. Distinct from the reels metaphor. (Today's Clips tab uses `FolderOpen`, which reads as generic "files," not "clips" — this is a small improvement, but see the note below; keeping `FolderOpen` is acceptable if the team prefers minimal change.) |
| **In Progress Reels** | clapperboard | `Clapperboard` | A reel is an *edit/assembly in progress* — a clapperboard is the universal "movie being made" glyph. Distinct from Published's "sent out" metaphor and from Clips' "cut." Replaces today's `Image` (which read as "gallery/photo," the wrong metaphor now that published content is leaving this tab). |
| **Published** | paper plane / send | `Send` | "Published" = shared/sent out into the world. `Send` (paper-plane) is the clearest "this has left the workshop and gone public" glyph, and it pairs conceptually with the app's existing `Share2` usage without duplicating that exact icon on a tab. |

### New/changed icons (the two the task calls out)
- **In Progress Reels: `Image` → `Clapperboard`.** `Image` meant "the gallery of finished
  highlights"; that content is moving to Published, so the icon must move with the metaphor. A
  clapperboard says "reel under construction."
- **Published: new tab, `Send`.** Nothing published-specific existed as a tab before.

### Icon distinctiveness at 18px (mobile) / 16px (desktop)
Gamepad2 (device), Scissors (open blades), Clapperboard (hinged slate), Send (triangle/plane)
are all silhouette-distinct at 18px — none share an outline, so the four tabs are
tellable-from-across-the-room even before reading labels. Verified files exist:
`gamepad-2.js`, `scissors.js`, `clapperboard.js`, `send.js`.

### Fallback / lower-risk icon set
If the team wants to minimize visual churn (keep today's Clips icon, only touch the two changed
tabs):

| Tab | Minimal-change icon |
|---|---|
| Games | `Gamepad2` (unchanged) |
| In Progress Clips | `FolderOpen` (unchanged) |
| In Progress Reels | `Clapperboard` (was `Image`) |
| Published | `Send` (new) |

Both sets are valid; the full set (Scissors for Clips) is the stronger metaphor, the minimal set
is the safer diff. **Flag for the user to pick at the gate.** All named icons are verified
present in lucide-react (`folder-open.js`, `gamepad-2.js`, `scissors.js`, `clapperboard.js`,
`send.js`).

---

## 3. Color tokens

### Today (3 tokens for 3 tabs)
- `GAME` — green (Games)
- `REEL` — cyan (Clips tab active/badge)
- `HIGHLIGHT` — violet, `{bg, bgDark}` only (T8545 added it for the Highlights tab)

`SegmentedTabButton` consumes only `activeBg` + `activeBgDark`. Tailwind purge requires
**complete literal class strings** in `themeColors.js` — no computed names.

### Four tabs need a fourth hue
The four active states must be mutually distinguishable. Green / cyan / violet are taken. The
new **Published** tab gets a NEW token. Cyan and violet are close-ish on the wheel, so the 4th
hue should sit clearly apart from all three — **amber/orange** reads as distinct from green,
cyan, and violet, and it is NOT already claimed as a *tab* color (amber is used elsewhere for
the Team layer accent and expiry chips, but never as a segmented-tab active background, so
there's no active-state collision on this surface). Amber also carries a mild "published /
spotlight / featured" warmth that fits the gallery.

### Decision: mapping

| Tab | Token | Active bg / badge |
|---|---|---|
| Games | `GAME` | green — unchanged |
| In Progress Clips | `REEL` | cyan — unchanged (the Clips tab already uses REEL) |
| In Progress Reels | `HIGHLIGHT` | violet — **unchanged** (this IS the old Highlights tab, narrowed; keeping violet preserves muscle memory that "the violet tab is the multi-clip work surface") |
| **Published** | **`PUBLISHED` (new)** | **amber** |

Rationale for In Progress Clips vs In Progress Reels **differing** (cyan vs violet): they are
two distinct work stages, not two views of one thing; sharing a color would imply they're the
same surface. They keep the two colors T8545 already established.

### Exact `themeColors.js` addition

Append after the `HIGHLIGHT` block:

```js
// T8555: the Published home tab (the old Highlights tab's published section,
// promoted to its own top-level tab). Amber — distinct from GAME green /
// REEL cyan / HIGHLIGHT violet on the segmented control. Complete literal
// class strings (Tailwind purge); mirrors HIGHLIGHT's {bg, bgDark} shape,
// the only two keys SegmentedTabButton consumes.
export const PUBLISHED = {
  bg: 'bg-amber-600',
  bgDark: 'bg-amber-700',
};
```

`HIGHLIGHT`, `GAME`, `REEL` are all **unchanged**. Add `PUBLISHED` to the import in
`ProjectManager.jsx` (L21):
`import { GAME, REEL, HIGHLIGHT, PUBLISHED } from '../config/themeColors';`

### Contrast note
`bg-amber-600` with `text-white` (the button's active text color) has a contrast ratio around
2.6:1 — below WCAG AA for small text. **This is a pre-existing pattern**, not a new problem:
`GAME.bg` (`bg-green-600`) and `HIGHLIGHT.bg` (`bg-violet-600`) with white text are in the same
boat and shipped in T8545. For strict AA the whole set would need `text-black` on the light-600
backgrounds or a darker shade. **Flagging it, not fixing it here** — changing one tab's text
color would make Published inconsistent with the other three active tabs. Recommend a separate
follow-up to audit all four active-tab contrasts together (consistent fix across the set), rather
than a one-off on the new tab. If the user wants it addressed now, the consistent option is
`bg-amber-500 text-black` for Published while leaving the others — but that breaks visual
uniformity, so the default recommendation is: match the existing 600/white pattern now, file the
contrast audit as its own task.

---

## 4. Badge placement (no structural change)

Both new counts flow through the **existing** `SegmentedTabButton` `count` prop and its dual
badge — nothing about badge RENDERING changes:

| Tab | `count` source | Semantics |
|---|---|---|
| Games | `games.length` | unchanged |
| In Progress Clips | `clipDrafts.length` | unchanged |
| In Progress Reels | `highlightDrafts.length` | **relocated** — the in-progress-multiclip draft count (`projects.filter(p => !p.is_auto_created)`, already computed in `DownloadsPanel.jsx:78`; the design doc wires it to the tab). Matches how In Progress Clips already uses `clipDrafts.length`. |
| Published | `unseenReelsCount` | **relocated** — today's Highlights-tab badge, which always counted published reels, so it belongs on Published now. |

Confirmations:
- **Mobile corner badge + desktop inline pill:** both render exactly as today (`sm:hidden`
  corner span L414-418, `hidden sm:inline` pill L420-424). The badge background is
  `active ? activeBgDark : 'bg-gray-700'` — so an active Published badge is `bg-amber-700`
  (from the new `PUBLISHED.bgDark`), consistent with how each active tab's badge takes its own
  `activeBgDark`. No change.
- **`count > 0` gate:** badges only show when the count is positive — unchanged. A brand-new
  account with nothing published shows no Published badge (correct; the empty state in §5 carries
  the message).
- **Accessible-name ordering:** the DOM-order rule from §0/§1 governs ALL FOUR buttons. With
  two-word labels the correct name is now e.g. `"In Progress Reels3"` and `"Published2"` —
  label text first, digit last. Any e2e locator should anchor on the label prefix
  (`getByRole('button', {name: /^In Progress Reels/})`, `/^Published/`), never on the digit.

---

## 5. Empty states

Two tab bodies get emptier than before, because published content leaves the In Progress Reels
tab. Both must match existing conventions.

### 5a. In Progress Reels — no in-progress multiclip drafts

This is today's `highlightDrafts.length === 0` branch (`DownloadsPanel.jsx:796-799`), which will
now be the WHOLE tab's empty state (published content no longer fills the space below it). Keep
the existing copy style; update it to the new terminology and to whatever the assembly-button
copy resolves to.

Existing:
```jsx
<p className="px-3 text-sm text-gray-500">
  No highlights in progress. Tap Create Highlight Reel to assemble one.
</p>
```

RESOLVED (button copy = **"New Highlight Reel"**; promoted to the centered block per the recommendation):
```jsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <Clapperboard size={48} className="text-gray-600 mb-4" />
  <p className="text-gray-400">No reels in progress</p>
  <p className="text-sm text-gray-500 mt-1">
    Tap New Highlight Reel to build one from your clips
  </p>
</div>
```

- **Button copy resolved at the gate to "New Highlight Reel"** (not "Create Highlight Reel", not
  "Build New Reel"). This empty-state string and the assembly button use the SAME literal.
- Promoted to the centered block (matching CollectionsTab's §5b convention) with `Clapperboard`
  (the In Progress Reels icon) at `size={48} className="text-gray-600 mb-4"`, so both new-ish
  tabs feel like first-class surfaces.
- **SUPERSEDED same day by T8780:** button copy is now "Build New Reel" (naming collision with
  `displayNames.js`'s "Highlight Reel" == published-only). T8780 also moved the button below this
  empty-state message when there are no drafts, keeping it above the carousel once drafts exist.

### 5b. Published — empty

This is the EXISTING `CollectionsTab` empty state (`CollectionsTab.jsx:131-139`), relocated
verbatim into the new Published tab body. It already follows the app convention and the T8470
"never claim 'No reels yet' while drafts exist" rule (the `draftClipCount > 0` link). **No copy
or style change needed** — it moves as-is:

```jsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <FolderOpen size={48} className="text-gray-600 mb-4" />
  <p className="text-gray-400">No reels yet</p>
  <p className="text-sm text-gray-500 mt-1">
    Publish reels to see them grouped by game here
  </p>
  {/* existing draftClipCount > 0 link to the Clips tab — unchanged */}
</div>
```

Optional polish (not required): swap the empty-state icon from `FolderOpen` to `Send` (the
Published tab icon) for tab/empty-state icon agreement. Low priority; the existing `FolderOpen`
is fine and changing it touches a shared component. **Recommend leaving it** to keep the diff
scoped to placement, per the task's "do not redesign the gallery, only relocate it."

### Empty-state convention summary (for both)
- Centered block: `flex flex-col items-center justify-center py-12 text-center`
- Icon: `size={48} className="text-gray-600 mb-4"`
- Primary line: `text-gray-400`
- Secondary line: `text-sm text-gray-500 mt-1`
- Optional CTA link below, using the existing `Button variant="secondary"` or a text link as the
  surrounding code already does.

---

## 6. Screenshot-in-words / ASCII mock

### 320px (mobile — stacked, `grid-cols-4`, two-line labels)

```
┌──────────────────────────────────────────────┐
│  ┌───────┐ ┌───────┐ ┌───────┐ ┌───────┐      │
│  │  🎮   │ │  ✂    │ │  🎬 ③ │ │  ➤ ②  │      │  <- icon top, corner badge on
│  │       │ │       │ │       │ │       │      │     count>0 (③ violet-700 active
│  │ Games │ │  In   │ │  In   │ │Publish│      │     bg / gray-700 inactive)
│  │       │ │Progres│ │Progres│ │  ed   │      │
│  │       │ │ Clips │ │ Reels │ │       │      │
│  └───────┘ └───────┘ └───────┘ └───────┘      │
└──────────────────────────────────────────────┘
   green      cyan      VIOLET*    amber
   active-tab background fills the whole cell; * = active tab shown here (In Progress Reels)
```

- All four columns equal width (`grid-cols-4`), equal height (grid stretches to the tallest,
  which is the two-line "In Progress Clips/Reels" cells — Games and Published render one label
  line but reserve the same height, keeping the four icons top-aligned).
- Icon is 18px, centered, on top; label below, centered, wrapping to two lines for the two-word
  tabs; count badge (when > 0) rides the icon's top-right corner.
- The active tab has a filled colored background across the whole cell + white text + `shadow-lg`;
  inactive tabs are `text-gray-400`, hover → `text-white hover:bg-white/10`.

### 375px (mobile — same layout, wider columns, `text-[11px]` if `xs` exists)
Identical structure; each column is ~10px wider so the two-word labels wrap more comfortably (or
sit on two shorter lines). Font may bump from 10px to 11px at the `xs` breakpoint if defined.

### Desktop (`sm`+ — single content-width row)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ [ 🎮 Games 12 ] [ ✂ In Progress Clips 3 ] [ 🎬 In Progress Reels 3 ] [ ➤ Published 2 ] │
└───────────────────────────────────────────────────────────────────────────┘
     green            cyan                      VIOLET (active)          amber
```

- `sm:flex sm:w-auto` — the bar shrinks to content width, sits left-aligned, one row.
- Each tab: icon (16px) + label on one line + inline pill badge (`ml-1 px-2 py-0.5 rounded-full`,
  colored `activeBgDark` when active else `bg-gray-700`).
- Two-word labels sit on one line here (plenty of width); no wrapping at `sm`+.
- Active tab (shown: In Progress Reels, violet) has the filled background + white text + shadow.

---

## 7. Approval checklist for the gate

Confirm with the user before implementation:

- [ ] **Layout:** `grid-cols-4` with two-line label wrap + one-step font shrink at 320px
      (Option B) — approved?
- [ ] **`xs` breakpoint:** does `tailwind.config` define `xs`? If not, use
      `text-[10px] sm:text-sm` (drop the `xs:` step).
- [ ] **Icons:** full set (Games `Gamepad2` / In Progress Clips `Scissors` / In Progress Reels
      `Clapperboard` / Published `Send`) OR minimal set (keep `FolderOpen` for Clips)? Pick one.
- [ ] **Colors:** Published = new amber `PUBLISHED` token; In Progress Reels keeps violet
      `HIGHLIGHT`; Clips keeps cyan `REEL`. Approved?
- [ ] **Contrast:** accept the existing 600/white pattern for the new tab now and file a separate
      four-tab contrast audit, vs. fix contrast in this task?
- [ ] **In Progress Reels empty state:** promote to the centered block (recommended) or keep the
      inline one-line `<p>`?
- [ ] **Assembly button copy** ("Build New Reel" vs "Create Highlight Reel") — needed to finalize
      the In Progress Reels empty-state string; this is the task's own open question and blocks
      the empty-state copy.

---

## Consistency notes
- Every class string proposed is a **complete literal** (Tailwind purge safe); no computed class
  names introduced.
- The `SegmentedTabButton` prop surface is **unchanged** — the fourth tab is just a fourth
  `<SegmentedTabButton>` instance with the new icon, label, count, and `PUBLISHED` colors.
- No badge-rendering, DOM-order, or breakpoint-structure changes beyond the label wrap.
- Gesture/persistence untouched: `activeTab` stays local UI state (no persisted view state),
  same as T8545.
```


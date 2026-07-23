# T5675 — Home header/hero + games-card legibility — UI Designer SPEC

**Status:** PROPOSAL (user approval gate). Nothing here is implemented. No source or
style-guide file has been modified. The same agent implements Phase 2 from this doc after
approval.

**Scope:** presentational only. Data flow, click/nav handlers, persistence, and export paths
are untouched (EPIC #6). Filters and view state stay ephemeral (EPIC #3). All new/retained
interactive controls hit the 44px touch floor on coarse pointers (EPIC #4). Style-guide
additions are proposed at the end, applied in the same PR after approval (EPIC #5).

**Breakpoint targets throughout:** 360, 390, 768, 1280+. Fold targets: 1315×748 desktop and
390×844 mobile.

---

## Pre-flight findings (facts that shape the spec)

- **`LogoWithText` is shared by 3 frontend callers**, not just the home hero:
  - `ProjectManager.jsx:590` — `<LogoWithText className="mx-auto mb-4" />` (defaults:
    `logoSize=64`, `textClassName="text-xl"`, `widthClassName="w-[80px]"`).
  - `SignInScreen.jsx:54` — `<LogoWithText />` (all defaults), inside a `flex justify-center`.
  - `BrandedEndCard.jsx:24` — overrides `logoSize={112}`, `textClassName="text-3xl"`,
    `widthClassName="w-[150px]"`, plus `onLogoClick`/`logoAriaLabel`.
  - (A separate `src/landing/src/components/Logo.tsx` exists with its own `LogoWithText`;
    that is the marketing site, out of scope — do not touch it.)
  Any change to `LogoWithText` MUST keep all three frontend callers rendering correctly. The
  `widthClassName="w-[80px]"` prop is the root cause of the stacking (see item 1) and can be
  retired, but the prop must remain accepted (or every caller updated) so nothing breaks.

- **Filters are already ephemeral.** `settings.projectFilters` is session-only: the store
  marks it SESSION-ONLY (`settingsStore.js:42`) and the backend explicitly ignores
  `projectFilters` on PUT (`settings.py:24,83`). So the restyle is pure markup — no
  persistence risk, no store changes. Keep using `setStatusFilter/setAspectFilter/
  setCreationFilter` exactly as today.

- **`showFilters`** (`:263`) gates the filter block on `projects.length > 1` AND at least one
  sub-filter having >1 distinct value. Demoting the box does not change this gate.

- **`showRecentSection`** (`:437`) = `recentProject || recentGame`. The continue block markup
  is at `:594-668` and is wrapped `hidden sm:block` — the sole reason it vanishes on mobile.

- **GameCard metadata row is duplicated verbatim** — expired variant `:1396-1421` and normal
  variant `:1488-1513` are byte-for-byte identical. This is the 2nd duplication; per the
  refactoring rule (abstract on the 3rd) we would normally leave it, but see item 3 for why a
  behavior-preserving extract is the right call here.

- **`TagBadges`** (`:45-67`) is the legibility precedent: `inline-flex items-center gap-1
  px-1.5 py-0.5 rounded-full border text-[11px] font-semibold` with a 10px Lucide icon and a
  tinted color set (`text-amber-400 bg-amber-400/15 border-amber-400/30` scoring /
  `text-cyan-400 bg-cyan-400/15 border-cyan-400/30` playmaking). We reuse this exact pill
  recipe for the rating chips.

---

## Item 1 — Logo lockup reads broken

**Current state.** `LogoWithText` (`Logo.jsx:50-79`) wraps a `flex flex-col w-[80px]` around
`<span>Reel</span>` / emblem / `<span>Ballers</span>`, so the wordmark is force-stacked into
three lines at every width — it reads as a wrap accident. Rendered at `ProjectManager.jsx:590`.

**Proposed design.** One intentional horizontal lockup: emblem left of a single-line
"Reel Ballers" wordmark. Drop the fixed-width column entirely; let the flex row size to
content and center via the caller's `mx-auto` (hero) or `justify-center` parent (sign-in).

Rewrite the return of `LogoWithText` to a horizontal row:

```jsx
// widthClassName retained in signature for back-comgpat but no longer forces a column.
// Default it to '' so callers that don't pass it get an auto-width lockup.
return (
  <div className={`inline-flex items-center gap-2 sm:gap-3 ${widthClassName} ${className}`}>
    {emblem}
    <span className={`${textClassName} font-bold text-white leading-none tracking-tight whitespace-nowrap`}>
      Reel Ballers
    </span>
  </div>
);
```

- `emblem` unchanged except it no longer needs `self-center` (the row's `items-center` centers
  it); keep `self-center` — harmless, and preserves the `onLogoClick` button path for
  BrandedEndCard.
- `whitespace-nowrap` guarantees the wordmark never re-wraps into the "Reel / Ballers" defect.
- `leading-none` + `tracking-tight` keep the wordmark tight against the emblem.

**Per-breakpoint behavior.** The lockup is content-sized and centered by the caller, so it is
identical in structure at all widths; only scale changes. In the **hero** (`:590`) pass sizing
props so it steps down cleanly rather than relying on the 64px default:

```jsx
<LogoWithText
  className="mx-auto mb-3"
  logoSize={40}
  textClassName="text-2xl sm:text-3xl"
/>
```

| Width | Emblem | Wordmark | Result |
|-------|--------|----------|--------|
| 360 / 390 | 40px | `text-2xl` (24px) | emblem + one-line wordmark, centered, ~fits ≤ ~200px wide |
| 768 | 40px | `text-3xl` (30px) | same lockup, slightly larger wordmark |
| 1280+ | 40px | `text-3xl` (30px) | unchanged; hero column is `max-w-2xl` so no need to grow further |

(Note: `logoSize` is a numeric SVG prop, so it can't be responsive via Tailwind. 40px is a
single value that reads well at all four widths next to a 24–30px wordmark. If a larger
desktop emblem is wanted, that needs a JS breakpoint hook — flagged as an open question, not
proposed here to avoid scope creep.)

**Other callers — keep working:**
- `SignInScreen.jsx:54` `<LogoWithText />` — now renders emblem(64px default) + "Reel Ballers"
  `text-xl`, horizontally, inside its `flex justify-center` parent. Improvement, no change
  needed. Verify the lockup fits `max-w-sm` (it does: 64px + ~140px wordmark < 384px).
- `BrandedEndCard.jsx:24` — passes `logoSize={112}`, `textClassName="text-3xl"`,
  `widthClassName="w-[150px]"`. With the new row layout `w-[150px]` would truncate a 112px
  emblem + 30px wordmark. **Action:** drop `widthClassName="w-[150px]"` from that caller (let
  it auto-size) and keep `logoSize={112}` `textClassName="text-3xl"` for the big end-card
  lockup. This is a required caller edit — list it in the implementation checklist.

**Risk / tradeoff.** The `widthClassName` prop becomes near-vestigial. Keeping it in the
signature (defaulted `''`) preserves the API and greppability; a follow-up could remove it, but
this task should not, to keep the diff mechanical (EPIC #7). Confirm "Reel Ballers" (with
space) is the intended wordmark — current code renders it as two words on two lines, so the
brand spelling is inferred, not asserted (open question).

---

## Item 2 — Hero eats the fold

**Current state.** Centered `max-w-2xl` column stacks: header logo+tagline (`:588-592`,
`mb-6`) → "Continue…" (`:594-668`, `hidden sm:block`, `mb-6`) → tab toggle (`:671-708`,
`mb-6`) → CTA (`:711-733`, `mb-4 sm:mb-8`) → boxed 2-row filter panel (`:865-977`, `mb-4 p-3
bg-gray-800/50 rounded-lg border border-gray-700 space-y-3`). "Your Reel Drafts" lands ~470px
down on desktop.

**Proposed design — two moves.**

### 2a. Tighten vertical rhythm

Reduce the stacked bottom-margins. Concrete before→after:

| Element | Line | Before | After |
|---------|------|--------|-------|
| Header block | `:589` | `mb-6` | `mb-4` |
| Logo inside header | `:590` | `mb-4` | `mb-3` (via `className` above) |
| Tagline | `:591` | (default) | add `text-sm` (was default `text-base` gray-400) |
| Continue section | `:596` | `mb-6` | `mb-4` |
| Tab toggle | `:671` | `mb-6` | `mb-4` |
| CTA wrapper | `:711` | `mb-4 sm:mb-8` | `mb-4 sm:mb-5` |
| Header top pad (mobile) | `:589` | `pt-10 sm:pt-0` | keep (clears fixed controls — do not remove) |

Estimated desktop reclaim: ~40px (margins) + filter-box change below (~26px of box chrome:
`p-3` top/bottom + border) → list start moves from ~470px toward ~380–400px, clearing the
748px-height fold with the first row(s) visible. Mobile: continue-strip is added (2c) but the
margin tightening + borderless filters offset it; verify at 390×844 in-browser (jsdom is not
acceptance, EPIC).

### 2b. Demote the filter box to borderless inline chip rows

Drop the card chrome; keep the chips. Replace the wrapper at `:866`:

```jsx
// before: <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700 space-y-3">
// after:
<div className="mb-3 space-y-1.5">
```

Convert each of the three filter groups (`Status` `:868`, `Aspect Ratio` `:904`, `Created By`
`:936`) from stacked `label`-over-`flex-wrap` into a single inline row: label as a leading
muted chip-label on the same line as its chips, chips wrapping after it.

```jsx
// per-group row — label inline, chips wrap on the same baseline
<div className="flex flex-wrap items-center gap-1.5">
  <span className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mr-1">
    Status
  </span>
  {/* existing chip buttons unchanged, e.g.: */}
  <button
    onClick={() => setStatusFilter(opt.value)}
    className={`px-2.5 py-1 text-xs rounded transition-colors ${
      statusFilter === opt.value ? '…active…' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
    }`}
  >
    {opt.label} ({count})
  </button>
</div>
```

- Chip button classes, colors, counts, and the `setStatusFilter/setAspectFilter/
  setCreationFilter` handlers are **unchanged** — only the wrappers and the label element
  change. This keeps behavior and ephemeral state identical.
- The old `<label className="block text-xs text-gray-400 mb-1.5">` becomes the inline
  `<span … uppercase … mr-1>` shown above (label now sits left of the chips instead of above).
- **Touch floor:** chips are `py-1 text-xs` ≈ 26px tall — below 44px. Per EPIC #4 this is a
  coarse-pointer concern. Proposal: on coarse pointers bump to `coarse-pointer:py-2.5` (or
  `coarse-pointer:min-h-[44px]`) so mobile taps meet the floor while desktop stays dense.
  Apply via the existing `coarse-pointer:` variant (EPIC references it). Flag: verify the
  variant is registered in the Tailwind config before use (open question).

**Per-breakpoint behavior.**

| Width | Filter rows |
|-------|-------------|
| 360 / 390 | label + chips wrap freely; borderless so they read as controls, not a panel; chips get `coarse-pointer` height bump |
| 768 | usually 1 line per group; label inline |
| 1280+ | same; column is `max-w-2xl` so wrapping rarely triggers |

**Risk / tradeoff.** Removing the box slightly reduces the visual grouping of the three filter
rows. Mitigation: `space-y-1.5` keeps them as a tight cluster and the inline uppercase labels
carry the grouping. If the three rows read as too loose without the box, fallback is a single
hairline `border-t border-gray-800 pt-2` above the cluster (still far lighter than the card) —
noted as a fallback, not the primary proposal.

---

## Item 3 — GameCard metadata is cryptic

**Current state.** Identical metadata row at `:1396-1421` (expired) and `:1488-1513` (normal):
`{toLocaleDateString}` (unlabeled) · `{n} clips` · `{brilliant_count}!!` (color
`RATING_BADGE_COLORS[5]`) · `{good_count}!` (`RATING_BADGE_COLORS[4]`) · `Quality: {computed}`
(`hidden sm:inline`, dev-jargon `title`) · `<TagBadges>`. The `!!`/`!` come from
`RATING_NOTATION` (5=`!!` Excellent, 4=`!` Good) in `clipConstants.js`.

**HARD CONSTRAINT (from task):** do NOT rename `RATING_NOTATION` / `RATING_BADGE_COLORS` /
`RATING_BACKGROUND_COLORS`. Labels and tooltips live at the VIEW layer only. The constants stay
byte-identical for greppability.

**Proposed design.** Replace the four cryptic tokens with labeled, TagBadges-style pills. Reuse
the exact pill recipe (`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border
text-[11px] font-semibold` + 10px Lucide icon). Every pill gets a human `title` tooltip and an
`aria-label` for screen readers.

**Token-by-token mapping (first-time soccer parent reading):**

| Current | Proposed | Icon | Tooltip (`title`) / `aria-label` |
|---------|----------|------|----------------------------------|
| `6/11/2026` (bare) | `Uploaded 6/11/2026` — prefix the date with a word; keep `toLocaleDateString()` | `Calendar` (10px, `text-gray-500`) | `aria-label="Uploaded on 6/11/2026"` |
| `13 clips` | unchanged text (`{n} clip{s}`) — already self-explanatory | `Film` (optional, 10px) | — |
| `5!!` (color[5]) | `★ 5 Excellent` pill | `Star` (10px) | `title="5 excellent clips (top-rated)"` `aria-label="5 excellent clips"` |
| `5!` (color[4]) | `★ 5 Great` pill | `Star` (10px) | `title="5 great clips"` `aria-label="5 great clips"` |
| `Quality: 25` | `Footage quality 25/100` | — (text) | `title="Footage quality score, 0–100"` |

Use `RATING_ADJECTIVES[5]`="Brilliant"/`[4]`="Good" from `clipConstants.js` as the label
source rather than hardcoding words, OR use plain-parent wording ("Excellent"/"Great"). The
adjectives constant already reads parent-friendly ("Brilliant"/"Good") — reusing it keeps one
source of truth. **Recommendation:** use `RATING_ADJECTIVES` labels (`Brilliant`, `Good`) to
avoid a second vocabulary; confirm with user (open question — "Brilliant/Good" vs
"Excellent/Great").

Rating-pill markup (drop-in for the `{brilliant_count}!!` / `{good_count}!` spans), colored via
the existing constants (VIEW-layer use of the color token is fine — we're not renaming it):

```jsx
{game.brilliant_count > 0 && (
  <span
    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-semibold"
    style={{
      color: RATING_BADGE_COLORS[5],
      backgroundColor: RATING_BACKGROUND_COLORS[5],   // existing 0.15-alpha tint
      borderColor: RATING_BADGE_COLORS[5] + '4D',      // ~30% alpha to match TagBadges border weight
    }}
    title={`${game.brilliant_count} ${RATING_ADJECTIVES[5].toLowerCase()} clips (top-rated)`}
    aria-label={`${game.brilliant_count} ${RATING_ADJECTIVES[5].toLowerCase()} clips`}
  >
    <Star size={10} />
    {game.brilliant_count} {RATING_ADJECTIVES[5]}
  </span>
)}
```

(Same block for `good_count` with `[4]`.) Note `RATING_BACKGROUND_COLORS` already exists as the
0.15-alpha tint companion, so pill fills stay consistent with the badge palette without new
tokens.

Quality → labeled, and promote from `hidden sm:inline` to visible on mobile too (it's now
self-explanatory, so no reason to hide it — but see tradeoff on density):

```jsx
<span title="Footage quality score (0–100), higher is better">
  Footage quality {qualityScore}/100
</span>
```

**Per-breakpoint behavior.**

| Width | Metadata row |
|-------|--------------|
| 360 / 390 | pills wrap (`flex-wrap` already present `:1488`); date+clips on line 1, rating pills wrap to line 2. Consider keeping `Footage quality` `hidden sm:inline` on the smallest width to avoid a 3rd wrap line — see tradeoff |
| 768 | typically 1–2 lines |
| 1280+ | 1 line |

**Shared extraction decision (flagged, as required).** The two rows are byte-identical, so
editing both in place duplicates the legibility change and risks drift. **Recommendation:
extract a `GameMetaRow` sub-component** taking `{ game }` and rendering the date+clips+rating
pills+quality+`<TagBadges>`. This is a behavior-preserving extract (code motion, no logic
change) — allowed as a mechanical commit under the refactoring rules, and here it is the
*safer* option because it guarantees both variants stay identical. It is the 2nd duplication
(rule says abstract on the 3rd), but the rule's intent (don't hide code paths) is served, not
violated, since both call sites currently show the *same* row — extracting makes that explicit.
Keep the extract in its own mechanical commit, then apply the legibility change once to the
component (EPIC #7). If the user prefers minimal churn, the fallback is editing both rows
identically — call this out.

**Risk / tradeoff.** (a) Promoting `Quality` to always-visible adds a token on mobile that may
push rating pills to a 3rd wrap line on 360px. Mitigation: keep `Footage quality` as
`hidden sm:inline` (labeled but desktop-only) — the parent gets it on desktop, mobile stays
compact. Recommend this. (b) Two rating pills + TagBadges + date can get busy; the `gap-y-0.5`
+ `flex-wrap` already handles wrapping gracefully. (c) Border-alpha via hex `+ '4D'` string
concat assumes 6-digit hex constants (they are) — safe, but note it in review.

---

## Item 4 — Mobile continue strip

**Current state.** Continue block (`:594-668`) is `hidden sm:block` → absent on mobile.
`recentItems.recentGame` / `recentProject` computed at `:406`, gated by `showRecentSection`
(`:437`). Desktop shows two cards side-by-side (`flex gap-3`, each `flex-1`).

**Proposed design — SHOW a compact mobile strip.** Rationale: on mobile the resume tap is the
highest-value action and the current silent omission is finding #11's whole point. Render a
compact 2-up row on mobile that reuses the same handlers, with trimmed metadata.

Change the wrapper `hidden sm:block` (`:596`) to always render, and make the inner layout
responsive. Keep the desktop layout exactly as-is; add a compact mobile form:

```jsx
{showRecentSection && (
  <div className="w-full max-w-2xl mb-4">
    <div className="flex items-center gap-2 mb-2 sm:mb-3">
      <Clock size={14} className="text-gray-500" />
      <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
        Continue Where You Left Off
      </h2>
    </div>
    {/* 2-up on all widths; cards already flex-1. Mobile = compact padding + dropped 2nd line */}
    <div className="flex gap-2 sm:gap-3">
      {/* each card: p-2.5 sm:p-3, min-h-[44px] guaranteed by content */}
    </div>
  </div>
)}
```

**Compact-card changes on mobile** (apply to both the game and reel buttons at `:606` /
`:627`), via responsive utilities so desktop is unchanged:

- Padding: `p-3` → `p-2.5 sm:p-3`.
- Icon wrapper: `p-2` → `p-1.5 sm:p-2`; icon `size={18}` unchanged (keeps tap affordance).
- **Keep** on mobile: icon, name (`truncate` — critical, prevents overflow), chevron.
- **Drop** on mobile: the secondary metadata line (`{clip_count} clips annotated` `:617-619`
  and the status line `:655-661`) — wrap it `hidden sm:block` so mobile shows just
  icon + name + chevron (a clean one-line resume tap). Desktop keeps the second line.
- **Touch floor:** each card is a `<button>` with `p-2.5` + 18px icon → ≥44px tall naturally;
  add `min-h-[44px]` explicitly to be safe (EPIC #4).

**Per-breakpoint behavior.**

| Width | Continue strip |
|-------|----------------|
| 360 | 2-up, each card icon+name(truncate)+chevron, ~1 line, ≥44px tall. Names truncate — acceptable, chevron signals "more" |
| 390 | same, slightly more room for the name |
| 768 (`sm`) | reverts to current desktop layout (second metadata line returns, `p-3`, `gap-3`) |
| 1280+ | unchanged from today |

**Layout choice: 2-up compact, not horizontal-scroll.** There are at most two continue items
(one game, one reel), so a scroll carousel is overkill and adds a scrollbar/affordance for two
items. Fixed 2-up `flex-1` fits 360px (two ~170px cards with 8px gap). If only one item exists,
it spans full width (`flex-1` handles this). This also stays clear of the T5672 carousel
pattern (that's for many draft tiles, not the 2-item resume strip).

**Risk / tradeoff.** Adding the strip on mobile costs vertical space against the 390×844 fold
target (item 2). The compact one-line cards (~52px) + header (~28px) + `mb-4` ≈ 96px. Offset by
item 2's margin tightening and borderless filters. Net fold position must be verified in a real
mobile browser (EPIC acceptance) — if it still pushes the list too far, fallback options in
priority order: (1) drop the "Continue Where You Left Off" header label on mobile (`hidden
sm:flex` on the header, cards carry their own icons), saving ~28px; (2) show only the single
most-recent item on mobile (whichever of game/reel is newer) as one full-width card. Recommend
shipping the 2-up first and only falling back if the fold check fails.

---

## Style guide additions (to apply in Phase 2 after approval)

To add to `.claude/references/ui-style-guide.md` (+ the `src/frontend` ui-style-guide skill),
in the same PR as implementation:

1. **Brand lockup pattern** — `LogoWithText` is a horizontal `inline-flex items-center gap-2
   sm:gap-3` emblem + `whitespace-nowrap` wordmark; never force a fixed-width column; center via
   the parent. Document the three sizes in use (hero 40/`text-2xl→3xl`, sign-in 64/`text-xl`,
   end-card 112/`text-3xl`).
2. **Labeled metadata pill** — the TagBadges recipe generalized: `inline-flex items-center
   gap-1 px-1.5 py-0.5 rounded-full border text-[11px] font-semibold`, 10px Lucide icon,
   `color`/`bg`/`border` from a shared token trio (e.g. `RATING_BADGE_COLORS` +
   `RATING_BACKGROUND_COLORS` + border at ~30% alpha). Rule: **rating/score chips must carry a
   human `title` + `aria-label`; developer notation (chess `!!`/`!`) never appears in the UI —
   it stays in constants.**
3. **Borderless inline filter rows** — filter chip groups use `flex flex-wrap items-center
   gap-1.5` with an inline `text-[11px] uppercase tracking-wide text-gray-500` label, NOT a
   boxed `bg-gray-800/50 border rounded-lg` panel. Card chrome is reserved for content cards,
   not control clusters.
4. **Coarse-pointer touch floor on dense chips** — dense `text-xs` chips get
   `coarse-pointer:min-h-[44px]` (or `coarse-pointer:py-2.5`) so mobile taps meet 44px while
   desktop stays compact.
5. **Compact resume strip** — the 2-item "continue" pattern: 2-up `flex-1` buttons, mobile
   drops the secondary metadata line (`hidden sm:block`) and shows icon+truncated-name+chevron,
   `min-h-[44px]`. Distinct from the many-item carousel (T5672).
6. **Add "Uploaded"/"Footage quality N/100" as the labeling convention** — bare dates and bare
   scores are banned on user-facing cards; prefix with the noun they measure.

---

## Open questions for user (decide before implementation)

1. **Wordmark spelling:** confirm the brand is "**Reel Ballers**" (one line, space-separated).
   Current code stacks "Reel"/"Ballers" so the canonical string is inferred.
2. **Rating vocabulary:** use the existing `RATING_ADJECTIVES` words on the pills
   ("**Brilliant**" / "**Good**"), or parent-plain "**Excellent**" / "**Great**"?
   Recommendation: reuse `RATING_ADJECTIVES` (one source of truth).
3. **`Footage quality N/100` on mobile:** keep it `hidden sm:inline` (desktop-only, my
   recommendation to protect the mobile fold), or show it on mobile too?
4. **GameMetaRow extract:** approve the behavior-preserving extract of the duplicated metadata
   row into a `GameMetaRow` sub-component (recommended, own mechanical commit), or edit both
   rows in place to minimize churn?
5. **Mobile continue strip:** approve showing the compact 2-up strip (recommended), and approve
   the fold-fallback order (drop header label → single newest item) if the 390×844 fold check
   fails?
6. **Desktop emblem size:** hero uses a single 40px emblem at all widths (Tailwind can't make a
   numeric SVG prop responsive). Acceptable, or do we want a larger desktop emblem (requires a
   JS breakpoint hook — extra scope)?
7. **`coarse-pointer` variant:** confirm the `coarse-pointer:` Tailwind variant is registered
   in the frontend Tailwind config (EPIC references it as an existing pattern). If not, the
   touch-floor bumps need a media-query fallback.
8. **`widthClassName` prop:** OK to keep the now-vestigial `widthClassName` prop in
   `LogoWithText`'s signature (defaulted `''`) this task, and defer its removal to a later
   cleanup, to keep this diff mechanical?

---

**Awaiting approval before any code or style-guide change. This is a USER approval gate.**

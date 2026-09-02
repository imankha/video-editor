# T8350 — Design: Multi-clip reel staleness — visual cue

**Status:** DESIGN — awaiting user approval (design-gated; no implementation until approved)
**Tier (anticipated):** M (frontend display derivation on 2 surfaces + one additive backend field expansion; no schema change, no migration, no persistence).
**Depends on:** T8070 (data model `raw_clips.reel_source_start_time/end_time` + exact-`===` rule — SHIPPED). Coordinates with T8360 (design-approved, NOT on master — see § T8360 coordination).

This spec covers ONLY the multi-clip VISUAL cue deferred out of T8070 (Q5 Option A). The data
model, backfill, all five write sites, and the annotate single-clip/seed display already shipped
in T8070. Nothing here writes to the backend; every cue is a pure read-time derivation.

---

## 0. TL;DR (the decision)

- **PRIMARY cue = a tile-level badge** in `DraftTile`'s badge cluster (top-left/top-right corner
  pills), reading **amber "N stale"** with a warning-triangle icon. It is the primary carrier
  because it is the ONLY cue visible in the produced / ready-to-publish states — exactly where
  staleness matters most.
- **SECONDARY cue = an amber segment tint + tooltip** in `SegmentedProgressStrip`, valid ONLY in
  the not-yet-produced per-clip-segment branch (the strip collapses to one "Focus" segment once a
  working/final video exists, so it structurally cannot carry the produced-state cue).
- **TERTIARY cue = a per-clip amber dot** in the Focus clip list (`ClipSelectorSidebar`), beside
  the existing framing-status indicator.
- **Recommendation: SHIP BADGE + SEGMENT-TINT + Focus-list dot** (all three), NOT badge-only.
  Justification in § 6. The badge alone leaves the pre-produced editing states (where the user is
  most likely to be actively drifting boundaries) with no cue on the strip they are looking at,
  and leaves Focus — the screen where boundaries are actually edited — silent.

---

## 1. Current State (three surfaces, with line anchors)

### 1a. `DraftTile.jsx` — the badge cluster (PRIMARY carrier)

`src/frontend/src/components/DraftTile.jsx`. The tile renders a cluster of corner pills, all
`absolute … z-20`, `text-[10px] font-semibold`, `rounded-full`, `backdrop-blur-sm`:

| Pill | Anchor | Lines | Condition |
|------|--------|-------|-----------|
| Multi-clip count (`Layers` + N) | `top-1.5 left-1.5` (or `right-1.5` when ready) | 537–548 | `project.clip_count > 1` |
| "Ready" (`CheckCircle`) | `top-1.5 left-1.5` | 552–559 | `isReadyToPublish` |
| Status chip ("Done"/"Focus"/"In Overlay"/…) | `top-1.5 right-1.5` | 563–567 | `!isReadyToPublish` |
| In-My-Reels (`CheckCircle`) | `top-9 right-1.5` | 570–574 | `isComplete && is_published` |

The tile reads its per-clip data from `project.clips[]` — an array of `ClipSummary` on the
projects-list payload (`DraftTile` already reaches `project.clips?.[0]` at 374). The strip is
mounted at 630–642 and suppressed in the ready state (`!isReadyToPublish`).

**Why the badge is the right primary carrier:** the badge cluster renders in EVERY tile state,
including `isReadyToPublish` (line 552 area) and `isComplete` — the produced states where the
strip is either collapsed or suppressed. This is the one place a produced multi-clip reel can
show per-clip drift.

### 1b. `SegmentedProgressStrip.jsx` — collapses on produce (SECONDARY, pre-produce only)

`src/frontend/src/components/shared/SegmentedProgressStrip.jsx`.

- Line 43: `const framingComplete = has_working_video || has_final_video;`
- Lines 48–56: when `framingComplete` (or exporting/failed framing), the per-clip loop is skipped
  and a SINGLE `{ status:'done', label:'Focus' }` segment is pushed.
- Lines 58–69: per-clip segments (`clips[i]`, one per clip) render ONLY in the `else` branch —
  i.e. **before any working/final video exists.**
- `statusColors` map at 104–112; each segment's `title` tooltip is built at 187–194.

**Consequence (from the supervisor audit, load-bearing):** a per-segment tint can appear ONLY
before the reel is produced. The moment a reel has a working or final video — the state in which
"the reel is stale" is the meaningful statement — the per-clip segments no longer exist, and
additionally `DraftTile` suppresses the whole strip in the ready-to-publish state. **The strip is
therefore incapable of carrying the produced-state cue.** This is why the badge is primary.

### 1c. `ClipSelectorSidebar.jsx` — the Focus clip list (TERTIARY)

`src/frontend/src/components/ClipSelectorSidebar.jsx`. Each clip row (215–324) already renders a
right-aligned **framing-status indicator** (297–307): green `Check` (stroke-3) when `isFramed`,
gray `Crop` icon otherwise, with a `title`. Rating badge on the left (251–264), name + game +
duration in the middle (267–295), delete on hover (310–321). This list is the screen where clip
boundaries are actually edited, so it is the natural home for a per-clip drift indicator, but it
receives a DIFFERENT clip object shape than the tile (editor clips, not `ClipSummary`) — see § 4.

---

## 2. Staleness derivation (pure helper, reuses T8070 §4 byte-identically)

One shared pure function, no persistence, computed on read from data already (or additively) on
the payload. **Reuses T8070 §4's rule verbatim: strict `===`, values copied without arithmetic,
no epsilon, with a not-null guard.**

```js
// src/frontend/src/utils/reelStaleness.js  (NEW — small pure module)
//
// A clip is STALE when its live boundaries no longer match the window the reel's
// existing artifacts were produced from. NULL reel_source_* (never snapshotted) is
// NOT stale (the reel was never produced / no snapshot). T8070 §4 rule, byte-identical.
export function isClipStale(clip) {
  const s = clip.reel_source_start_time;
  const e = clip.reel_source_end_time;
  if (s == null || e == null) return false;              // not-null guard: never snapshotted -> not stale
  return clip.start_time !== s || clip.end_time !== e;   // strict !==, no epsilon, no arithmetic
}

// Count across a reel's clips (0 -> no cue).
export function staleClipCount(clips = []) {
  return clips.reduce((n, c) => n + (isClipStale(c) ? 1 : 0), 0);
}
```

- **Where computed (tile/strip):** from `project.clips[]` (`ProjectListItem.clips` = `ClipSummary`).
  Requires four additive fields on `ClipSummary` — see § 3. `staleClipCount(project.clips)` drives
  the badge; `isClipStale(clips[i])` drives each segment tint.
- **Where computed (Focus list):** from the editor clip objects already loaded in
  `ClipSelectorSidebar`. Their `reel_source_*`/`start_time`/`end_time` provenance is confirmed at
  pickup (T8070 surface (b), `GET /projects/{id}/clips` → `WorkingClipResponse`, already carries
  `reel_source_start_time/end_time` and the live boundaries). If the editor clip shape uses
  camelCase (`reelSourceStartTime`), the helper takes a tiny field-name adapter at that call site;
  the RULE stays identical.
- **No persistence, no gesture.** This is display-only derivation (T8070 INV-4). Reverting a
  boundary to the exact producing value makes `start_time === reel_source_start_time` again and the
  cue clears automatically — no write, no counter, exactly as T8070 §4 requires.

---

## 3. Backend: additive fields on `ClipSummary` (no schema change, no migration)

The tile/strip read `project.clips[]` = `ClipSummary` (`projects.py:228`). Today `ClipSummary`
carries `id/name/tags/rating` + the T6820 preview trio, but NOT the live boundaries nor the reel
snapshot. To let the tile compute staleness, add FOUR nullable fields and project them in the two
UNION SELECTs that build the clip list.

| File / anchor | Change |
|---------------|--------|
| `projects.py:228` `ClipSummary` model | Add `start_time: float \| None = None`, `end_time: float \| None = None`, `reel_source_start_time: float \| None = None`, `reel_source_end_time: float \| None = None`. |
| `projects.py:450–468` clip-list SELECT (both UNION arms) | Add `rc.end_time`, `rc.reel_source_start_time`, `rc.reel_source_end_time` alongside the `rc.start_time` already selected. Column-guard `reel_source_*` with `column_exists` (T8070 §3e pattern) — a below-v049 profile DB yields `None` for both, i.e. "not stale". |
| `projects.py:482–487` `ClipSummary(...)` assembly | Pass the four new fields through. |

- Additive and nullable → deploy-before-migrate safe (below-v049 → `reel_source_*` = `None` →
  `isClipStale` returns false → no cue, degrades to today's behavior).
- No new endpoint, no query added — the UNION already joins `raw_clips`; we project four more
  columns from the row already read.
- The Focus list uses the EXISTING `GET /projects/{id}/clips` surface (T8070 surface (b)), which
  already carries these fields — **no backend change for the Focus list.**

**Open backend question (Q-B, § 8):** confirm the editor's `ClipSelectorSidebar` clip objects are
sourced from `GET /projects/{id}/clips` (T8070 (b)) and already carry `reel_source_*` + live
boundaries. If instead they come from a store shape that drops those fields, that store mapper
needs the same additive passthrough. To be confirmed at implementation pickup, not a design change.

---

## 4. Proposed cue — PRIMARY: tile badge

**Copy:** `N stale` (e.g. `1 stale`, `3 stale`). Icon: Lucide `AlertTriangle` at `size={11}`.

**Placement in the badge cluster.** The badge sits with the other status pills, using the same
pill shape. To avoid colliding with the existing corner occupancy (count top-left, status/Ready
top-right, In-My-Reels at `top-9 right-1.5`), anchor the staleness pill at **`top-9 left-1.5`**
(the left-column slot one row below the count/Ready pill) so it stacks under the multi-clip count
in every state. `z-20`, same layer as its siblings.

```jsx
{staleCount > 0 && (
  <span
    className="absolute top-9 left-1.5 z-20 inline-flex items-center gap-1 px-2 py-0.5 rounded-full
               text-[10px] font-semibold bg-amber-500/90 text-gray-950 shadow backdrop-blur-sm"
    title={staleCount === 1
      ? '1 clip changed since this reel was made — re-export to update it'
      : `${staleCount} clips changed since this reel was made — re-export to update them`}
    aria-label={`${staleCount} ${staleCount === 1 ? 'clip' : 'clips'} changed since this reel was made`}
  >
    <AlertTriangle size={11} />
    {staleCount} stale
  </span>
)}
```

- `staleCount = staleClipCount(project.clips)` computed once in the component body.
- Color: **`bg-amber-500/90` + `text-gray-950`** — amber is the codebase's warning hue
  (`text-amber-300` used for "Uploading"/"Exporting" status at DraftTile:402/404, and the T4050
  publish-failure Retry chip at DraftTile:789–795; `yellow-500`/amber = "Warnings, in-progress" in
  the style guide semantic table). A solid amber pill with near-black text gives AA contrast and
  reads as "attention needed, not an error" (red is reserved for destructive/failed). Icon +
  literal word "stale" means color is NOT the only signal (§ 7).

**Copy justification (why "N stale" over alternatives):**
- The kickoff proposes amber "N stale" — adopted. It is the shortest phrasing that (a) states the
  problem, (b) carries a count for multi-clip, (c) fits a `text-[10px]` corner pill without
  truncation even at `360px`.
- "N clip edited" — rejected: ungrammatical for N>1 ("3 clip edited"), and "edited" describes the
  cause not the consequence; the tile cares about the reel being out of date, not the edit event.
- "reel outdated" — rejected as the BADGE copy: no per-clip count, and it is longer. It IS,
  however, the right register for the *tooltip*, so the tooltip says "clip(s) changed since this
  reel was made" (the causal, human phrasing) rather than repeating "stale".
- "N outdated" — viable alternative if the user prefers plainer language over the editing term
  "stale"; listed as Q1.

**States:**

| State | Appearance |
|-------|------------|
| 0 stale clips | **No badge** (pill not rendered). |
| 1 stale clip | Amber pill `⚠ 1 stale`, tooltip "1 clip changed since this reel was made — re-export to update it". |
| N stale clips (N>1) | Amber pill `⚠ N stale`, plural tooltip. |
| `project.clips` absent / still loading | `staleClipCount([])` = 0 → no badge (never a flash of a wrong count). |
| Column absent (below-v049 DB) | `reel_source_*` = null → count 0 → no badge (graceful degrade). |
| Hover / focus | Pill is non-interactive (status, not control) — no hover state of its own; the tile's own hover lift applies. Tooltip on `title`. |

**Surface-agnostic by construction:** the badge is a pure function of `project.clips` and lives
inside `DraftTile`. It travels with the tile to whatever surface renders it (Home "Reel Drafts"
today; a post-T8360 "Highlights" section tomorrow) with zero change. See § T8360 coordination.

---

## 5. Proposed cue — SECONDARY: segment tint (pre-produce only)

Renders ONLY in the per-clip-segment branch (`SegmentedProgressStrip` lines 58–69) — i.e. before a
working/final video exists. **Explicit statement: this cue never appears on a produced reel, by
construction** (the strip has collapsed to one "Focus" segment by then). It is a redundant,
in-context reinforcement of the badge for the editing phase, not the primary carrier.

**Mechanism.** In the per-clip loop, compute `const stale = isClipStale(clips[i]);` and set a
`stale` flag on the pushed segment. In the render map, overlay an amber ring on a stale segment
rather than replacing its status color (a stale clip can still be `pending` or `in_progress`, and
we must not lose that hue):

```jsx
// in the segment <div> className, appended:
${segment.stale ? 'ring-1 ring-inset ring-amber-400' : ''}
```

At `h-1.5` (slim tile variant) a 1px inset amber ring reads as an amber edge on the segment; at
`h-3` (full variant) it is a clear amber outline. Ring (not fill-swap) preserves the underlying
done/in-progress/pending shape-and-hue language the strip already teaches (T3540).

**Tooltip.** Append to the existing per-segment `title` string (built at 187–194) when stale:
` — clip edited since this reel was made`. So a stale in-progress clip reads e.g.
`Clip 2 [dunk]: Started - export Focus to complete (click to open) — clip edited since this reel was made`.

**States:** stale → amber inset ring + appended tooltip clause; not stale → unchanged. Produced /
exporting / failed-framing branches → single collapsed segment, no per-clip tint possible (correct).

**Accessibility:** the ring is reinforced by the tooltip text; and because the strip is a
secondary/redundant cue behind the always-text badge, color is never the sole signal for the fact
of staleness.

---

## 6. Recommendation: badge + segment-tint + Focus dot (NOT badge-only) — justified

The supervisor question is "badge-only, or badge + segment-tint." Recommendation: **all three
cues.** Reasoning:

1. **The badge alone is invisible where the user is actively creating drift.** Boundary edits
   happen in Annotate / Focus. In the pre-produce editing phase the user is staring at the strip
   (and, in Focus, at the clip list), not scanning tile corners. The segment tint + Focus dot put
   the signal on the exact element the user is manipulating.
2. **The badge alone is invisible on the produced strip — but that is fine, because the badge IS
   visible there.** The two cues are complementary by phase: badge covers produced/ready
   (strip collapsed/suppressed); segment-tint covers pre-produce (badge may be `0 stale` right
   after produce, then the strip is where drift first shows as the user re-edits). There is no
   state where BOTH are needed simultaneously to be legible, but there is no state where either is
   redundant noise either.
3. **Cost is low and the rule is shared.** All three consume the same `isClipStale` helper;
   segment-tint and Focus-dot are ~3-line additions to existing render loops with no new data
   plumbing beyond § 3.
4. **Consistency:** amber + icon/text in all three keeps one staleness language across surfaces.

If the user wants the smallest possible change, the fallback is **badge-only** (drop § 5 and § 4b
Focus dot) — the badge is the load-bearing cue and satisfies the acceptance criteria on its own
for produced reels. Listed as Q2.

---

## 4b. Proposed cue — TERTIARY: Focus clip list (`ClipSelectorSidebar`)

Per-clip indicator beside the existing framing-status indicator (rows 297–307). A small amber
**dot + `AlertTriangle`** is too heavy next to the existing 14–16px icon; use a compact amber dot
with an accessible label, placed just LEFT of the framing indicator so the row reads
`[rating] name/game/duration … [⚠ stale-dot] [framed-check] [delete]`.

```jsx
{isStale && (
  <span
    className="ml-2 flex-shrink-0 inline-flex items-center"
    title="Edited since this reel was made — re-export to update"
    aria-label="Edited since this reel was made"
  >
    <AlertTriangle size={13} className="text-amber-400" />
  </span>
)}
```

- `isStale = isClipStale(<adapted clip>)` (§ 2 adapter if the editor clip is camelCase).
- Icon (not bare dot) so it is legible and screen-reader labeled; `text-amber-400` on the dark
  sidebar (`bg-gray-900/95`) has strong contrast and matches the amber warning register.
- Placed before the framing `Check`/`Crop` so it never displaces the existing indicator; both are
  `flex-shrink-0` so the name column (`flex-1 min-w-0 truncate`) absorbs any width pressure.

**States:** stale → amber triangle + tooltip; not stale → nothing rendered (row unchanged);
NULL snapshot / no reel → not stale → nothing.

---

## 7. Exact copy table

| String | Where | Value |
|--------|-------|-------|
| Badge label (singular) | DraftTile pill | `1 stale` |
| Badge label (plural) | DraftTile pill | `{N} stale` |
| Badge tooltip (singular) | DraftTile `title` | `1 clip changed since this reel was made — re-export to update it` |
| Badge tooltip (plural) | DraftTile `title` | `{N} clips changed since this reel was made — re-export to update them` |
| Badge aria-label | DraftTile | `{N} clip(s) changed since this reel was made` |
| Segment tooltip clause | SegmentedProgressStrip (appended) | ` — clip edited since this reel was made` |
| Focus-list tooltip | ClipSelectorSidebar `title` | `Edited since this reel was made — re-export to update` |
| Focus-list aria-label | ClipSelectorSidebar | `Edited since this reel was made` |

All copy is title/aria only (no visible tooltip component); the visible text is the badge word
`stale` + count. No new i18n keys beyond these strings.

---

## 8. Accessibility

- **Color is never the only signal.** Badge = amber pill + `AlertTriangle` icon + the literal
  word "stale" + count. Segment tint = amber ring + appended tooltip text. Focus dot = amber
  `AlertTriangle` + `aria-label`. A colorblind or high-contrast user gets icon + text on every cue.
- **Contrast:** `bg-amber-500/90` (#f59e0b @ ~90%) with `text-gray-950` clears AA for the small
  bold pill text. Amber-400 icon on `gray-900` sidebar and on the dark tile clears AA for a
  graphical object.
- **Labels:** every cue carries a `title` AND an `aria-label` (badges/dots are non-interactive
  `span`s, so `aria-label` is what a screen reader announces; the `title` is the pointer tooltip).
- **Non-interactive:** none of the three cues is focusable or clickable (they are status, not
  controls) — they never add tab stops. The underlying segment stays clickable exactly as today.

---

## 9. Responsive behavior (mobile 360–428px)

- **Tile badge:** the tile is `w-[40vw] max-w-[200px]` portrait / `w-[72vw] max-w-[300px]`
  landscape (DraftTile:428–430). At 360px the portrait tile is ~144px wide. `⚠ 1 stale` in
  `text-[10px] px-2 py-0.5` is ~52px — fits with room; `⚠ 12 stale` ~62px still fits. The pill is
  a single non-wrapping `inline-flex`, anchored `top-9 left-1.5` clear of the count pill above it
  and the right-column status/In-My-Reels pills. No layout reflow (absolute-positioned).
- **Segment tint:** ring is drawn inside the existing segment box; zero width impact at any size,
  including the `h-1.5` slim strip on the smallest tiles.
- **Focus clip list:** the sidebar is a fixed `w-56` (224px) column at all widths; the amber
  triangle is `flex-shrink-0` and the name column is `truncate`, so adding it cannot overflow —
  the name shortens first. (If the Focus screen collapses the sidebar on very narrow mobile, the
  cue rides with the row wherever the sidebar renders; no separate mobile treatment needed.)
- No new breakpoints introduced.

---

## 10. Consistency notes

- Amber warning register matches DraftTile's own "Uploading"/"Exporting" `text-amber-300` (402/404)
  and the T4050 Retry chip's `amber-300/amber-500` (789–795), and the style-guide semantic
  `yellow-500` = "Warnings, in-progress".
- Corner-pill shape (`rounded-full text-[10px] font-semibold … backdrop-blur-sm z-20`) is copied
  verbatim from the sibling count/Ready/status pills so the new badge reads as one of the family.
- Ring-not-fill on the segment preserves the strip's existing "solid fill = done, half-fill =
  in-progress" shape grammar (T3540).
- Focus-list `AlertTriangle` mirrors the existing right-aligned status-indicator idiom (an icon +
  `title` in a `flex-shrink-0` wrapper).

---

## 11. T8360 coordination note (IMPORTANT — context discrepancy)

The kickoff references "T8360-design.md section 7," which reserved this task's landing spot on a
restructured DownloadsPanel "Highlights section tile." **That design doc file does not exist on
master, and T8360's implementation has NOT landed** — T8360 is currently only "design approved,
back to WIP"; there is no `feature/T8360-split-single-vs-multiclip-drafts` branch to base on.

Therefore **this spec is anchored to the CURRENT `DraftTile.jsx` on master**, which renders on the
Home "Reel Drafts" surface and shows both single- and multi-clip drafts. Consequences:

- The badge is placed against the badge cluster that exists today (§ 4), not a hypothetical
  post-T8360 tile.
- The cue is **surface-agnostic by construction**: it is a pure function of `project.clips` living
  inside `DraftTile` (and inside the strip/sidebar sub-components). When T8360 splits single-clip
  vs multi-clip drafts into a "Highlights" section, `DraftTile` (and its badge) simply renders in
  whatever container T8360 gives it. **The badge travels with the multi-clip tile automatically —
  no re-work.**
- **Semantic scope:** the cue is meaningful only for MULTI-clip reels per the task, but
  `isClipStale`/`staleClipCount` are correct for single-clip drafts too (a single-clip draft with a
  drifted seed already shows staleness in Annotate via T8070 §3g). If the user wants the badge
  suppressed on single-clip tiles pre-T8360 to avoid double-signalling with Annotate, gate it on
  `project.clip_count > 1` (matches the existing multi-clip-count pill's own gate at DraftTile:537).
  Recommended default: **gate the badge on `clip_count > 1`** so it is unambiguously the multi-clip
  cue and never duplicates the Annotate single-clip signal. Listed as Q3.

---

## 12. Open Questions (for the user)

- **Q1 — Badge word:** ship `N stale` (recommended, matches kickoff) or plainer `N outdated`?
- **Q2 — Cue breadth:** ship all three cues (badge + segment-tint + Focus dot, recommended per
  § 6), or badge-only for the minimal change?
- **Q3 — Single-clip gating:** gate the tile badge on `clip_count > 1` (recommended — pure
  multi-clip cue, no overlap with Annotate's single-clip signal), or show it on single-clip tiles
  too?
- **Q4 — Badge slot:** `top-9 left-1.5` (stacks under the multi-clip count pill, recommended). If
  the user would rather it sit inline with the status chip on the right, name the corner and I'll
  re-anchor — but the left column is the only slot free in ALL states (right column hosts
  status/Ready + In-My-Reels).
- **Q5 (to confirm at pickup, not a design change) — Focus clip provenance:** confirm
  `ClipSelectorSidebar` clips carry `reel_source_*` + live boundaries from `GET /projects/{id}/clips`
  (T8070 (b)); if a store mapper drops them, add the same additive passthrough there.

---

## 13. Acceptance criteria (from task) → how this design satisfies them

| Criterion | Mechanism |
|-----------|-----------|
| ui-designer spec approved for the stale visual + copy | This doc (§ 4/5/4b copy + classes + states); pending user approval. |
| A multi-clip reel with one drifted clip shows the cue on exactly that clip | `isClipStale` per clip → segment-tint on exactly that segment (pre-produce) + `staleClipCount` on the badge (produced). Never whole-reel. |
| Reverting that clip's boundaries to the exact producing values clears the cue | `isClipStale` is pure strict `===` (T8070 §4); revert → `start_time === reel_source_start_time` → false → cue disappears, no write. |

---

## 14. Addendum (2026-09-02) — re-verified against merged T8360 (commit `2c13e54e`)

**User decisions (design gate approved):** **1a** — badge word is **`outdated`**, not `stale`.
**2a** — ship all three cue layers (badge + segment-tint + Focus dot), per § 6 recommendation.
**3a** — badge scoped to multi-clip tiles only, gated on `project.clip_count > 1`, per § 11
recommendation.

T8360 merged to master while this design sat at the gate. § 11 flagged that the spec was written
against pre-T8360 `master` because T8360's branch didn't exist yet. Re-verification after merging
`origin/master` into this branch (no conflicts) confirms **every technical claim in this doc still
holds — no surface moved out from under it:**

- **`DraftTile.jsx` badge cluster is untouched by T8360.** `git show 2c13e54e --stat -- .../DraftTile.jsx`
  shows a 2-line diff, a single comment-string edit — the badge cluster (multi-clip count pill,
  Ready badge, status chip, In-My-Reels marker) is byte-identical to what § 1a/§ 4 describe,
  including the exact `top-1.5`/`top-9` anchor lines. `top-9 left-1.5` (§ 4, Q4) is still free.
- **The Highlights section — the PRIMARY badge's real landing surface — now exists exactly as
  anticipated.** `DownloadsPanel.jsx` renders a "Highlights (in-progress)" section
  (`highlightDrafts = projects.filter(p => !p.is_auto_created)`) through a `CardCarousel` of
  `DraftTile` rows. Since the badge is a pure function of `project.clips` living inside `DraftTile`
  itself (§ 11's "surface-agnostic by construction" claim), it renders correctly with zero
  additional work regardless of which screen mounts the tile.
- **`SegmentedProgressStrip.jsx` and `ClipSelectorSidebar.jsx` are untouched by T8360** (not in the
  merge diff at all). § 1b and § 1c/§ 4b stand as written.
- **Backend line anchors hold.** `ClipSummary` is still at `projects.py:228`; the clip-list UNION
  SELECT is still at `:450–468`; the `ClipSummary(...)` assembly is still at `:482–487`. T8360's
  only change to `projects.py` was unrelated (dropped the `auto_project_id`-clearing side effect on
  rename, per T8360-design.md § 0) and does not touch the clip-summary query or model.
- **`column_exists` (§ 3) confirmed** at `app/database.py:511`, and the v049 migration
  (`app/migrations/profile_db/v049_raw_clips_reel_source_window.py`) confirmed as the source of the
  `raw_clips.reel_source_start_time/end_time` columns this design reads.
- **Q5 (Focus list provenance) resolved, no design change:** `ClipSelectorSidebar`'s `clips` prop
  (`FocusScreen.jsx:92`, from the multi-clip management hook reading `projectDataStore`) is sourced
  from `GET /projects/{id}/clips` → `WorkingClipResponse` (`clips.py:183`), which already carries
  `start_time`, `end_time`, `reel_source_start_time`, `reel_source_end_time` as plain snake_case
  fields — **identical names to the tile's `ClipSummary`.** No camelCase adapter needed; `isClipStale`
  takes the editor clip object directly.

**Net effect: zero changes to the plan.** Implementation proceeds exactly per § 2–§ 5, § 4b, with
the badge word swapped to **`outdated`** per decision 1a: badge pill reads `1 outdated` / `{N}
outdated` (§ 4, § 7); all other copy (tooltips, aria-labels, segment-tint clause, Focus-list
tooltip) already used "changed"/"edited" phrasing rather than the literal word "stale", so no
further copy changes follow from 1a. Internal helper names (`isClipStale`, `staleClipCount`) stay
as written — they name the underlying concept (T8070's staleness rule) and are not user-facing
copy.

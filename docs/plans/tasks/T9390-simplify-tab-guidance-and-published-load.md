# T9390: Simplify the four home-tab guidance screens + fix Published's slow first paint

**Status:** WIP
**Impact:** 7
**Complexity:** 6
**Created:** 2026-09-09
**Updated:** 2026-09-09

## Problem

User feedback (2026-09-09, reviewing the live `EmptyTabGuide` screens shipped by T8980/STAGING
and T8990/STAGING) reopens decisions that were themselves approved eight and seven days ago.
Seeing the real screens changed the verdict; treat this as a design revision, not a rejection of
those tasks' work. Four distinct complaints, in the user's own words:

1. **"In general they are far too wordy."** Every tab renders a numbered 4-step flow strip, a
   headline, a two-sentence body, and a footer hint (`EMPTY_TAB_GUIDE` in
   `src/frontend/src/config/emptyStates.js:25-76`). That is four blocks of text competing for
   attention on a screen whose only job is "what do I do next." T9320 already trimmed the "Step
   N of M: {label}" sentence for the same reason — this task goes further, across all four tabs.

2. **"In Progress Reels is not a necessary step... most users won't even use it."** The flow
   strip (`FLOW_STEPS`, `emptyStates.js:15-20`) numbers Games -> Clips -> Reels -> Published as
   four sequential steps, and every tab's copy reinforces that order ("clips become the reels
   you share", "Reels are step 3 of 4"). But a single clip publishes on its own —
   `CollectionsTab.jsx` and the Reels body copy itself say so ("A single clip can be published on
   its own; a reel is for a full game or a season"). Numbering Reels as a required step between
   Clips and Published misrepresents the product: most accounts go Games -> Clips -> Published
   and never touch Reels. The strip's own design doc (T8980) called this out as deliberate
   ("Numbered because the order is real") — the user's live reaction is that it doesn't read that
   way with real usage.

3. **"I don't like being able to 'Add Game' from a selected item other than Game[s]... if they
   haven't added a game yet, this tab should be disabled so they should never even get here."**
   Today, the Clips/Reels/Published empty states each offer an "Add Game" cross-tab CTA when the
   account has zero games (T8980's approved copy table: Clips "games=0: Add a game and tap Add
   Play. **Add Game**"; Published "nothing: Add a game to get started. **Add Game**"). The user
   wants those tabs simply unreachable in that state instead of surfacing a Games-tab action from
   inside them.
   **This directly reopens T8380's decision**, which deliberately REMOVED the old
   `clipsTabDisabled` guard so a zero-game account could still use Clips via "Add Video"
   (`ProjectManager.jsx:569-577`, `hasClips` at `:563` explicitly counts Add-Video clips with no
   game). If Clips is disabled at zero games, the Add Video entry point — a real, used path — is
   cut off. Reels is different: `Build New Reel` is already gated on `hasClips` with a visible
   reason (T8980), never on games directly, so "disabled until a game exists" was never quite
   the Reels rule either. **This is a real product tension, not a simple copy edit — needs a
   design decision, not an assumption.** See Decisions Needed below.

4. **"Published took way too long to load even though there was nothing but flat text (the
   others loaded flat text instantly)."** Root-caused from the code, not guessed:
   `CollectionsTab.jsx:84-90` shows a spinner while `summaryState` is `'idle'` or `'loading'`,
   and only renders `EmptyTabGuide` once it resolves. `useCollections.js`'s own docstring
   (`:14-16`) states the design: "summary: GET /api/collections/summary, fetched once **when the
   tab becomes active**" — i.e. Published's emptiness is unknown until a network round trip
   completes, gated on `isActive` (`:176`: `if (isActive && (becameActive || summaryState ===
   'idle')) fetchSummary()`). Games/Clips/Reels have no equivalent gap: their emptiness comes
   from `games`/`clipDrafts`/`highlightDrafts`, data `ProjectManager` already holds by the time
   the tab bar renders (loaded once at Home mount, not lazily per tab). This is an architectural
   asymmetry, not a rendering bug — Published is the only tab whose "is it empty" check requires
   its own fresh fetch on first visit.

## Solution

Designed and APPROVED 2026-09-09 (decision artifact
https://claude.ai/code/artifact/b46a7db1-6a8f-440b-98e4-98591dce3ff1, ui-designer's proposal
accepted with no amendments). The concrete copy, flow-strip mechanism, and tab-gating design are
in "## UI Designer Proposal (2026-09-09)" below — that section is now the binding spec, same
status as T8980/T8990's own approved copy tables. Ready to implement.

Known constraints the design must respect (derived from the code, not assumptions):
- `clips-add-video` tutorial target must remain on exactly one node across every Clips variant
  (T8380 invariant, still binding).
- No em dashes in any copy (project-wide rule).
- No persisted view state (T8990 precedent: the partial guide already retires itself with no
  dismiss-state).
- Capability queries only, never UA sniffing (T7350 landmine, cited in both T8980 and T8990).
- Whatever replaces the flow strip must still work in both the full `EmptyTabGuide` (empty tab)
  and `variant="partial"` (T8990) forms, and must still collapse sensibly below `sm`.

### Decisions (LOCKED 2026-09-09 — user approved the ui-designer's decision artifact
https://claude.ai/code/artifact/b46a7db1-6a8f-440b-98e4-98591dce3ff1, no amendments)

1. **Flow strip**: 3-node numbered strip (Games/Clips/Published); Reels demoted to a single
   unnumbered, dashed "Reels · optional" pill inserted inline between Clips and Published, with
   dashed chevrons on both sides. Strip dropped entirely below `sm` (empty variant) and dropped
   entirely in the partial variant (replaced there by a decorative top accent border only). Exact
   mechanism in the "UI Designer Proposal" section §2 below.
2. **Copy**: headline + one short line per tab (empty variant), footer kept ONLY on Games
   (reworded shorter), deleted on Clips/Reels/Published. Partial variant: headline + one line,
   footers dropped on all four. Exact strings in §4/§5 below — binding, do not paraphrase.
3. **Clips-at-zero-games tension (complaint 3)**: the hybrid recommendation, approved as proposed.
   **Clips** stays reachable at zero games (T8380's Add Video entry point preserved) and drops
   only its own "Add Game" branch — at zero games it shows Add Video alone with the caption "No
   game needed." **Reels and Published** gain real `disabled` tab-bar states
   (`SegmentedTabButton`, `ProjectManager.jsx:420`) gated on `!hasClips` (`:563`, the same boolean
   that already gates Build New Reel — no new data source), with a persistent VISIBLE caption
   under the tab bar (never a `title`, per T8780): "Reels and Published unlock once you have a
   clip. Cut one from a game, or use Add Video on Clips." The `hasEverPublished` edge case (an
   account that published, then deleted every draft) is EXPLICITLY DEFERRED to a follow-up per
   §3 below — ship the simple `!hasClips` gate first, do not block v1 on it.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/config/emptyStates.js` - `FLOW_STEPS`, `EMPTY_TAB_GUIDE`, `PARTIAL_TAB_GUIDE`; copy rewrite lands here
- `src/frontend/src/components/shared/EmptyTabGuide.jsx` - renders the strip + headline + body + action block for both variants; strip mechanism likely changes
- `src/frontend/src/components/ProjectManager.jsx` - `SegmentedTabButton` (`:420`), the 4-tab bar (`:1412-1453`), `hasClips` (`:563`), the Clips/Reels inline action rows; possible new `disabled` wiring per Decision 3
- `src/frontend/src/components/collections/CollectionsTab.jsx` (`:84-90`, `:150-164`) - Published's loading gate and empty state
- `src/frontend/src/hooks/useCollections.js` (`:14-27`, `:176-179`) - the lazy-on-activate `fetchSummary`; likely change to eager-at-mount (matching how games/clipDrafts already load) or a lightweight synchronous emptiness hint while the real summary loads
- `src/frontend/src/components/shared/CardCarousel.jsx` - T8990's `fillerSlot`, if the partial-variant redesign changes its shape
- `src/frontend/src/components/ProjectManager.fourTabIA.test.jsx`, `EmptyTabGuide.test.jsx`, `CardCarousel.test.jsx` - existing suites to extend, not replace

### Related Tasks
- Revises: T8980 (empty-tab guidance, STAGING) — the copy table and 4 decisions this task
  reopens were user-approved 2026-09-07; say so plainly in the eventual commit, this is a
  considered reversal, not a bug fix.
- Revises: T8990 (partial-row guidance, STAGING) — the partial-variant copy needs the same pass.
- Reopens: T8380 (Add Video entry point) — see complaint 3 / Decision 3, do not silently
  re-disable Clips without an explicit user call.
- Related: T9320 (Annotate copy pass, TODO) already removes the "Step N of M" sentence from
  `EmptyTabGuide.jsx` for an unrelated reason — coordinate so this task doesn't reintroduce or
  conflict with that edit; read T9320's diff first if it lands first.

### Technical Notes
- This is a **design-gated (Architect + ui-designer) task**: it touches an existing shared
  component's core mechanism (the flow strip), reopens a settled IA decision (tab disabling), and
  changes a data-loading pattern (`useCollections`). Full Stage 0-7 workflow, not the M-tier
  shortcut.
- Live-check the Published fix at real network latency (throttled), not just localhost — the
  whole complaint is about a load-time asymmetry that may not reproduce on a fast local backend.
- Follow this project's decision-artifact convention (published Artifact with a Today/Proposed
  toggle at real proportions, per T8980/T8990's own mockup links) before implementation starts.

## UI Designer Proposal (2026-09-09) — APPROVED, BINDING SPEC

User approved this proposal as-is on 2026-09-09 via the decision artifact
(https://claude.ai/code/artifact/b46a7db1-6a8f-440b-98e4-98591dce3ff1), no amendments. Everything
below is now the binding replacement for `EMPTY_TAB_GUIDE` / `PARTIAL_TAB_GUIDE` / `FLOW_STEPS` —
implement verbatim, do not paraphrase copy.

Grounded in the current code (`src/frontend/src/config/emptyStates.js`,
`src/frontend/src/components/shared/EmptyTabGuide.jsx`,
`src/frontend/src/components/ProjectManager.jsx:420-473, 533-580, 1412-1453`,
`src/frontend/src/components/collections/CollectionsTab.jsx:84-164`), not assumptions.

### Recommendation summary (read this first)

1. **Copy**: cut every tab to headline + one short line (one sentence, not two) for the empty
   variant, and headline + one short line with the footer hint DELETED for both variants except
   Games (which keeps one, see below). The flow strip's own text budget also drops (see #2).
2. **Flow strip**: keep a 3-node numbered strip (Games/Clips/Published) and demote Reels to a
   single unnumbered, dashed "Reels · optional" chip inserted inline between Clips and
   Published. Drop the entire strip (numbered dots + "Step N of M" line) from the mobile
   (below-`sm`) empty variant and from the partial variant everywhere; the surrounding context
   (the tab bar's own highlighted color, a real tile sitting next to the partial guide) already
   orients the user there, so the repeated graphic was pure redundancy at the sizes that hurt
   most for wordiness.
3. **Clips-at-zero-games tension**: a hybrid of candidates (a) and (b), not a single letter.
   **Clips** stays reachable at zero games (T8380 preserved) and simply drops its own "Add Game"
   branch, showing only the Add Video path. **Reels and Published** get real `disabled` tab-bar
   states, gated on `hasClips` (the same boolean that already gates Build New Reel, so no new
   data source), with a persistent VISIBLE caption under the tab bar (not a `title`) explaining
   why. Detailed rationale and tradeoffs in section 3.

### 1. Copy length: before/after (Decision 2)

Today, every empty-variant tab renders 4 text blocks (flow strip, headline, 2-sentence body,
footer) plus the action block. Proposed: 2-3 blocks (headline, 1-sentence line, action; footer
kept ONLY on Games, where it carries the "you don't strictly need a game either" message that
also serves Decision 1's job). Word counts, current body vs proposed line:

| Tab | Today's body (words) | Proposed line (words) |
|---|---|---|
| Games | "Upload a full game recording, then open it and tap Add Play at each moment worth keeping. Those plays become your clips, and clips become the reels you share." (27) | "Upload a recording, then tap Add Play on the moments worth keeping." (12) |
| Clips | "Each clip gets a Focus pass to follow your athlete and an optional Spotlight. Then publish it on its own, or build several into a reel." (26) | "Clips get a Focus pass, then publish alone or into a reel." (11) |
| Reels | "Pick the plays you want, put them in order, and export once. A single clip can be published on its own; a reel is for a full game or a season." (30) | "Order your clips and export once, or publish a single clip on its own." (13) |
| Published | "When a clip or reel is finished, Publish moves it here, grouped by game, with a link you can send to coaches, family and recruiters." (24) | "Every reel or clip gets a link for coaches, family and recruiters." (12) |

Two of the four proposed lines (Clips, Reels) deliberately keep the "publish alone" /
"on its own" clause — that phrase is doing double duty: it is both the trim AND the sentence
that kills the "Reels is mandatory" misreading (Decision 1), stated in the two tabs where a user
would actually wonder about it, rather than only in a diagram.

Footer hints: DELETE on Clips/Reels/Published (redundant with the strip; today's footer just
restates "the next tab in the flow", which is exactly the sequential-order framing Decision 1 is
removing). KEEP on Games, reworded shorter: `"Have a clip already? "` + link `"Skip ahead on
Clips."` (was `"Already have a short clip? "` + `"Add it directly on In Progress Clips"`) — this
is the one footer worth its line, because it tells a new user Games itself is not a hard
prerequisite either, which is the same "not everything here is mandatory" message Decision 1
is about, just for the Games→Clips edge instead of the Clips→Reels edge.

### 2. Flow strip redesign (Decision 1)

**Data model.** `FLOW_STEPS` (`emptyStates.js:15-20`) becomes a single array (still one source
of truth, still drives both the strip and any tab-order logic elsewhere) where each entry gains
an `optional` flag:

```js
export const FLOW_STEPS = [
  { key: 'games',     label: SECTION_NAMES_SHORT.GAMES,     navId: 'games' },
  { key: 'clips',     label: SECTION_NAMES_SHORT.CLIPS,     navId: 'projects' },
  { key: 'reels',     label: SECTION_NAMES_SHORT.REELS,     navId: 'inProgressReels', optional: true },
  { key: 'published', label: SECTION_NAMES_SHORT.PUBLISHED, navId: 'published' },
];
```

Numbering (the little digit in the circle) is computed by filtering out `optional` entries and
indexing THOSE: Games=1, Clips=2, Published=3. Reels never gets a number, in code or on screen.

**sm+ empty variant (only place the full strip still renders).** One row, centered, same
`ol`/`li`/`ChevronRight` mechanism as today, with one new node type:

```
 (1) Games ──▶ (2) Clips ─ ─ ▶ [ Reels · optional ] ─ ─ ▶ (3) Published
```

- Numbered nodes (Games/Clips/Published): unchanged from today — filled circle in the tab's
  `STEP_COLORS` when active, `bg-gray-700 text-gray-400` otherwise, solid gray-600 chevrons
  between them.
- The Reels node: no circle, no digit. A small pill, `border border-dashed border-gray-600
  rounded-full px-2.5 py-1`, containing `"Reels"` (`text-gray-500`, or lit `bg-[HIGHLIGHT.bg]
  text-white` when Reels is the active tab) plus a smaller trailing label `"· optional"`
  (`text-[10px] text-gray-500 uppercase tracking-wide`, ALWAYS gray/muted, even when the pill
  itself is lit — the point is that "optional" never disappears, including on the Reels tab
  itself). The two chevrons touching this pill render dashed (`border-dashed`, or a lighter
  `text-gray-700` ChevronRight) instead of solid, on both sides, in every state — a visual
  "detour", not a step.
- This reads, at a glance: solid numbered path is the real one; the dashed unnumbered pill is a
  branch you may or may not take. No JS reachability logic needed to convey it — it's load-bearing
  in the visual language alone, unlike today's strip where the ONLY signal was the copy.

**Below `sm` empty variant: drop the strip entirely** (today's numbered-dot row + "Step N of M:
{label}" line, `EmptyTabGuide.jsx:137-156`). This is the single biggest word-count cut on mobile,
exactly where "far too wordy" bites hardest, and nothing is lost: the tab bar directly above the
panel already shows the active tab lit in its color (`SegmentedTabButton`), so repeating "Step 2
of 4: Clips" a few pixels below it was pure duplication on a screen with no room to spare. The
"Reels is optional" message still reaches a mobile user because it is now IN the Reels body line
itself (`"Order your clips and export once, or publish a single clip on its own."`), not only in
a graphic. **Coordinate with T9320** (Annotate copy pass, TODO as of filing): T9320 already plans
to remove the "Step N of M" sentence from this same file for an unrelated reason. This proposal's
mobile cut is a superset (it removes that sentence too, plus the dot row above it) — whichever
task lands second should diff against the other's change instead of re-deriving it, per the
existing coordination note in this task's Related Tasks section.

**Partial variant: drop the strip entirely too**, everywhere (not just below `sm`). Today's
compact slot (`EmptyTabGuide.jsx:319-353`) crams a dot row, a "Step N of M" line, headline, body,
optional CTA, AND a footer into one small tile-shaped card — the single densest block in either
variant. Replace the dot row + step line with nothing textual; keep a 3px top accent border in
the tab's `STEP_COLORS` value (`border-t-4 border-t-[STEP_COLORS[tab]]` on the `aside`) purely
for color continuity with the empty variant's language, decorative only (`aria-hidden` not
needed since it carries no unique text). Add a visually-hidden `aria-label="{FLOW_STEPS label}
guidance"` on the `aside` so removing the visible step-number text doesn't remove it from the
accessibility tree — the `h3` headline already gives a sighted user the "what tab is this"
context implicitly (it sits directly beside/inside that tab's own content), a screen reader user
needs the equivalent said once via the label. Drop the footer line from all four partial cards
(`"Clips are step 2 of 4"` style text no longer applies once Reels isn't numbered anyway, and the
carousel/grid context it sits in already makes "what tab is this" obvious).

### 3. The Clips-at-zero-games tension (Decision 3) — concrete recommendation

**Recommendation: hybrid, not a single candidate letter.**

**Clips (exempt, candidate a):** keep it reachable at zero games — this is T8380's whole point,
Add Video is a real used path and must not be cut off. Drop ONLY its own "Add Game" branch
(`ClipsActions`'s `games=0` case, `EmptyTabGuide.jsx:184-186`): at zero games, Clips now shows
the Add Video path alone (no "or" divider, since there is only one path), with a small caption
under the button: `"No game needed."` (4 words) — this is the exact sentence that resolves the
user's complaint for Clips specifically: it explicitly tells them a game is not a prerequisite
here, rather than tempting them into a foreign-tab "Add Game" creation flow. At games > 0, Clips
is unchanged (still offers "Go to Games" AND Add Video) — a navigation link to an EXISTING tab
is not what the user objected to; only surfacing a foreign tab's CREATE action was the complaint.

**Reels and Published (candidate b, real disabled tab-bar states):** `SegmentedTabButton`
already takes a `disabled` prop (`ProjectManager.jsx:420`), so this is wiring, not a new
primitive. Gate BOTH tabs on the same boolean, `!hasClips` (`ProjectManager.jsx:563`, already the
exact condition that disables Build New Reel today) — a fresh zero-game, zero-clip account has
Games and Clips enabled, Reels and Published disabled; the moment ANY clip exists (cut from a
game, or via Add Video), both unlock together, since they share one gate. This deliberately
diverges from the task file's literal phrasing ("nothing published for Published"): gating
Published on "has anything ever been published" instead of `hasClips` would leave Published
disabled through the ENTIRE clip-cutting and reel-building process, hiding exactly the pull-through
copy that already exists for that state (`"You have N clips in progress. Publish one to see it
here."`) behind a disabled tab a user can't even open to read it — worse for activation, not
better. `hasClips` is the real shared prerequisite for BOTH tabs (you cannot build a reel OR
publish anything without a clip first); Clips is the only tab requiring nothing, because Add
Video is Clips' own independent creation path.

*Edge case, flagged not silently patched*: an account that published reels and then deleted every
draft afterward has `hasClips === false` but real content on Published. Under the `hasClips`-only
gate that account's Published tab would show disabled despite having reels to view — a real
regression, not a hypothetical. The correct fix is `!hasClips && !hasEverPublished`, but
`hasEverPublished` today only exists inside `useCollections`' summary, fetched LAZILY on tab
activate (`CollectionsTab.jsx:84-90`, the exact mechanism Step 6 of this same task is already
converting to an EAGER fetch at mount). **Sequencing dependency, not just a nice-to-have**: do not
wire Published's disabled state to the summary before Step 6 lands — doing so would recreate
complaint 4's asymmetry one level up (the TAB BUTTON itself would flicker enabled→disabled while
the summary loads, instead of the panel content doing so). Recommended path: ship v1 with the
simple `!hasClips` gate on both tabs (Step 7, independent of Step 6); once Step 6's eager summary
is in place, thread `hasEverPublished` from it into the same gate as a follow-up if the edge case
is judged worth the plumbing (it requires lifting a boolean CollectionsTab/`useCollections` computes
today up to where `ProjectManager` renders the tab bar — real cross-component wiring, which is
exactly why this task's own Implementation step 4 already calls for an Architect design doc "if
the chosen option touches SegmentedTabButton/tab-bar wiring"; it does, so keep that gate).

**Visible reason (T8780, not a `title`).** A single caption line renders directly under the
4-tab grid/row (`ProjectManager.jsx`, right after the closing `</div>` of the tab bar block at
`:1453`), shown whenever `!hasClips`, gone the instant it flips true:

> `Reels and Published unlock once you have a clip. Cut one from a game, or use Add Video on Clips.`

Styled `text-xs text-gray-500 text-center mt-1 mb-3` (matches the existing `addGameCaption`
treatment). Since both tabs share one gate, one caption covers both — no per-tab variants needed
for v1. Keep a `title` attribute on the two disabled buttons too (e.g. `"Add a clip to unlock"`),
but it is explicitly NOT the compliance mechanism — the caption is, since `title` is invisible on
touch and banned as the sole reason by T8780.

**Side effect worth calling out**: once Reels is unreachable at `!hasClips`, its empty-state panel
never needs to render the "no clips" branch again — `ReelsActions` (`EmptyTabGuide.jsx:215-246`)
collapses to just the enabled `Build New Reel` button + `hasClipsCaption`, deleting the
`noClipsReason`/`cutClipButton` branch entirely (dead code once the tab itself gates it). Same for
`PublishedActions` (`:248-278`): the `nothing` branch (zero games, zero drafts, zero published)
becomes unreachable once Published is gated the same way, collapsing it to 2 branches instead of
3. This is a real simplification the disabled-tab approach buys for free, not just a wash.

### 4. Exact copy (empty variant)

| Tab | Headline | Line | Action block | Footer |
|---|---|---|---|---|
| Games | Start with a game | Upload a recording, then tap Add Play on the moments worth keeping. | **Add Game** (success). Caption: "From your phone or computer, 2 credits." | "Have a clip already? " + link **Skip ahead on Clips.** |
| In Progress Clips | Cut a clip, or upload one | Clips get a Focus pass, then publish alone or into a reel. | games>0: "Open a game and tap Add Play." **Go to Games** (secondary), divider "or", "Already have a video?" **Add Video** (success, `data-tutorial-target="clips-add-video"`). games=0: **Add Video** (success, same tutorial target) only, caption "No game needed." | (none) |
| In Progress Reels | Combine clips into one reel | Order your clips and export once, or publish a single clip on its own. | **Build New Reel** (cyan, always enabled — tab itself is gated, so this button no longer needs a disabled state). Caption: existing `hasClipsCaption(n)` unchanged ("You have N clips ready to use." / "You have clips ready to use.") | (none) |
| Published | Share what you publish | Every reel or clip gets a link for coaches, family and recruiters. | drafts>0: "You have N clips in progress." **Open Clips** (cyan). else (games>0, now guaranteed since the tab is gated): "Cut your first clip to get started." **Go to Games** (secondary). *(third "nothing" branch deleted — unreachable once the tab is gated)* | (none) |

### 5. Exact copy (partial variant)

Headlines that were already LOCKED and collision-checked against real controls (T8990's own
learned rule: never name a clickable control by name IN THE HEADLINE) are kept verbatim below
where they already pass that check; only bodies/footers were trimmed.

| Tab (partial) | Headline | Line | CTA | Footer |
|---|---|---|---|---|
| Games (1 game) | Cut your first play | Tap Add Play on each moment worth keeping. | **Open game** | (none) |
| In Progress Clips (row not full) | Give each clip a Focus pass *(kept verbatim)* | Add an optional Spotlight, then publish it alone or into a reel. | none (Add Video already sits above the row) | (none) |
| In Progress Reels (row not full) | Finish and export | Put your plays in order and export once to publish. | none (Build New Reel already sits above the row) | (none) |
| Published (row not full) | Ready for coaches and family *(kept verbatim — this is the exact string T8990's review corrected "Share it" to; do not reintroduce the word "share" into a Published headline, per that learned rule)* | Use Share or Copy Link on any card. | none (Share/Copy Link already on the card) | (none) |

Every partial card drops its footer line (see section 2's mobile/partial strip rationale — the
"step N of M" framing the footers restated is gone anyway once Reels isn't numbered).

### 6. Published's spinner (complaint 4) — no visual design needed here

Per the task's own framing, this is Step 6's job (`useCollections.js` eager fetch at mount), not
a UI question. One thing THIS proposal must not do: the mockups above must render Published's
empty/partial copy appearing INSTANTLY, same as the other three, not behind a spinner state — do
not build a "loading" frame into the artifact as if it were a normal state to design for.

### 7. Constraint checklist

- No em dashes anywhere above (checked; only hyphens and the "·" interpunct in "Reels · optional",
  which is not an em dash).
- `clips-add-video` stays on exactly one node: the games=0 Clips branch has exactly one Add Video
  button (its "or" divider is removed along with the Add Game branch it paired with); the games>0
  branch is unchanged (Add Video still the only node carrying the anchor); the partial Clips card
  still renders no Add Video button at all (unchanged from T8990).
- No persisted view state: the new disabled-tab caption and the strip's optional-chip styling are
  both pure functions of already-loaded data (`hasClips`), nothing stored.
- Capability queries only: nothing in this proposal touches pointer/viewport detection; the
  existing `coarse-pointer:`/breakpoint mechanisms from T8980 are untouched.

## Implementation

### Steps
1. [x] Spawn ui-designer with this task file (Decisions Needed section) + the four live
   screenshots the user provided; produce concrete mock copy/layout for all 4 tabs x 2 variants
   (empty, partial)
2. [x] Publish a decision artifact (Today/Proposed toggle) and get explicit user sign-off on the
   3 Decisions Needed before writing code — **approved 2026-09-09, no amendments**
3. [ ] Branch `feature/T9390-simplify-tab-guidance`
4. [ ] Architect design doc for the Clips-disable reconciliation (Decision 3) if the chosen
   option touches `SegmentedTabButton`/tab-bar wiring
5. [ ] Implement approved copy + strip changes in `emptyStates.js` + `EmptyTabGuide.jsx`
6. [ ] Implement the Published load-time fix in `useCollections.js` (eager summary fetch at
   mount, matching games/clipDrafts timing) + verify against throttled network
7. [ ] Implement whichever Decision-3 option was approved in `ProjectManager.jsx`
8. [ ] Update/extend `fourTabIA.test.jsx`, `EmptyTabGuide.test.jsx`, `useCollections` tests
9. [ ] Reviewer pass (fan-out per ORCHESTRATION.md, L-tier)
10. [ ] Live check all four tabs at 320/390/768/1024, throttled network for Published, commit

### Progress Log

**2026-09-09**: Filed from user review of the live T8980/T8990 screens (both STAGING). Root
causes for all 4 complaints traced to code (cited above) rather than assumed. Complaint 3
identified as reopening T8380's deliberate decision — flagged as a real tension needing explicit
user resolution, not an implementation detail.

**2026-09-09 (same day)**: ui-designer consulted against the real code; produced concrete copy +
flow-strip mechanism + the Decision-3 hybrid recommendation (UI Designer Proposal section above).
Published as a decision artifact with an interactive Today/Proposed comparison. **User approved
with no amendments** — all three decisions LOCKED, the proposal section is now the binding spec.
Ready for branch + implementation; not yet started.

**2026-09-10 (T9390 implementation, Architect wiring note — Decision 3 only):**
- `SegmentedTabButton`'s existing `disabled` prop (`ProjectManager.jsx:420`) is sufficient — it
  already applies the greyed/`cursor-not-allowed` styling and blocks click + programmatic-onClick.
  No new primitive.
- `hasClips` (`ProjectManager.jsx:563`, `clipDrafts.length > 0 || games.some(g => g.clip_count > 0)`)
  is the single correct gate for BOTH Reels and Published, per §3. Do NOT thread
  `hasEverPublished`/`useCollections` summary in — deferred to a follow-up (§3 sequencing dependency).
- Visible caption renders under the tab-bar `</div>` (`:1453`) whenever `!hasClips`, styled to
  match the existing `addGameCaption` treatment (`text-xs text-gray-500 text-center`). `title` kept
  on the two disabled buttons as a secondary hint, never the compliance mechanism (T8780).
- **No redirect guard added (deliberate).** A `disabled` tab button blocks normal navigation; it
  does not intercept a manual deep-link / refresh straight to `/home/reels-in-progress` or
  `/home/published`. I evaluated bouncing such a landing to a safe tab, and REJECTED it: (a) it
  would hide real content in the drafts-but-no-clips / published-then-deleted edges the spec
  already defers, a worse regression than the cosmetic one it fixes; (b) it would fight the
  `galleryStore.open()` publish-landing retarget (`:1121`). The spec models the tab as gated via
  the disabled button and explicitly ships the simple gate, deferring edges — so a deep-link to a
  gated tab renders a degraded-but-not-broken panel (Published's collapsed branch falls through to
  "Go to Games"; Reels' always-enabled Build New Reel is the spec's own explicit choice). This is
  faithful to the binding spec and avoids inventing a new edge regression.

## Acceptance Criteria

- [ ] All four tabs (empty variant) read as noticeably shorter/less text-dense than today, per
  the approved mockup
- [ ] The flow strip (or its replacement) no longer implies Reels is a required step between
  Clips and Published
- [ ] The Clips-at-zero-games tension is resolved per an explicit user decision (not a guess),
  and the Add Video entry point still works if that decision keeps it
- [ ] Published's empty state appears in comparable time to Games/Clips/Reels on a throttled
  connection (no visible spinner-then-text asymmetry for the empty case)
- [ ] `clips-add-video` tutorial target remains on exactly one node in every Clips variant
- [ ] No em dashes; no persisted view state; no UA sniffing
- [ ] Unit + affected e2e tests green; Branch CI green

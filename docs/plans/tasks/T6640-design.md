# T6640 — Cards that cannot be made ugly — Design

**Status:** IMPLEMENTED (Round 3, 2026-08-09) — Option 1 shipped: `layout()` emits
`lines: string[]`, `RichText` renders them verbatim when supplied (falls back to its
own wrap when absent — Overlay rail unaffected). `routers/intro_cards.py` create/patch
no longer accept `text_elements` (§5b). Real-browser regression
(`e2e/T5180-text-parity.spec.js`, new `/debug/intro-card` seam mounting the actual
`<IntroCardPreview>`) reproduced the live collision pre-fix and is green post-fix across
repeated runs. Awaiting merge.
**Tier:** L · Frontend (preview-only this round) · design-gated
**Amends:** epic requirement 2 via [decision 12](player-intro/EPIC.md); see task
[T6640-cards-cannot-be-ugly.md](player-intro/T6640-cards-cannot-be-ugly.md).

> Requirement, in the user's words: *"the point of the templates is they all look
> professionally designed. The user shouldn't be able to make it ugly."*

---

## Round 3 (2026-08-09) — residual preview-collision fix

Rounds 1-2 (below, shipped in merge `bb53188b`) turned "cannot be made ugly" into a
structural guarantee: template-owned typography, a measured bottom-anchored reflow, and
a wrap parity contract. Those are **merged and mostly done**. Round 3 is a *narrow*
follow-up: one residual preview-only overlap the rounds-1-2 implementation left behind
because it did not carry out one intent from the approved §2a. Scope is much smaller
than rounds 1-2 — no backend layout change, no schema change, no rail change.

### A/B/C/D audit vs current merged code (verified by the supervisor)

| Item | Verdict | Notes |
|---|---|---|
| **A — wrap-safe layout** | **PARTIALLY DONE — the residual bug, Round 3's whole job** | Backend is CORRECT. `intro_card_geometry.layout()` reserves 2 lines for a wrapping name and does NOT overlap in `broadcast` OR `recruiting` — verified by rendering through the real PIL path (§0 matrix). One `text_render.wrap_lines` over the real font drives BOTH the height reservation and the glyph render, so the backend cannot disagree with itself. The residual overlap is FRONTEND-ONLY (root cause below). |
| **B — template-owned typography; controls removed from the card rail** | **DONE** | `IntroCardRail.jsx` renders only facts / subtitle / photo / treatment. The `TextSpecEditor` import + per-slot styling block are gone; the Overlay text rail is untouched (still full control). `ROLE_FOR_SLOT` / role colour live in the shared contract. Nothing for Round 3. |
| **C — composition looks designed** | **PARTIALLY DONE → validated by §0 matrix** | Hierarchy (3 roles), unequal rhythm gaps, seam feather, treatment band + photo grade, muted secondary colour all exist in the contract. Before Round 3 only `recruiting` had ever been rendered through the pixel path; the Round-3 matrix now renders all 4 compositions × 2 aspects × 3 treatments × {short, long}. All read as designed and none collide. No code change identified (nits in §7). |
| **D — existing cards / `text_elements` dead** | **DONE** | profile_db `v038` NULLs the column; `_select_elements` + `buildPreviewElements` no longer read it. One residual smell (dead write surface in `routers/intro_cards.py`) — decision in §7. |
| **Migration agent** | **NOT needed this round** | No new schema. |

### §0 — Evidence (backend proven correct; frontend fix proof deferred to QA)

The Round-3 proof matrix is rendered through the REAL PIL pixel path (`player_intro`'s
Pillow helpers + `text_render.render_text_layer`, driven by the production
`intro_card_geometry.layout()`):

```
docs/plans/tasks/T6640-round3-matrix/
  ├── 48 stills  = 4 compositions × 2 aspects × 3 treatments × {short, long}
  └── 8 contact sheets  _sheet_<comp>_<aspect>.png
```

**No PII:** the name is invented (`Anastasia Wintergreen`), the photo is a procedurally
generated silhouette — no real minor's name or image appears anywhere.

**What the matrix proves:** the BACKEND layout is collision-free and the composition
reads as designed across every reachable combination — including the exact live-repro
frame (`broadcast` / 9:16 / long name), which does NOT overlap on the backend. This is
the positive control that localizes the residual bug to the frontend preview.

**What the matrix does NOT prove:** the frontend preview fix. Because the residual bug
is a browser font-settle/re-wrap race (below), its acceptance proof is a REAL-BROWSER
measurement — the extended Playwright parity spec (§4) — run at QA AFTER approval.
jsdom/harness-only proofs are explicitly rejected for layout claims (T5380 and the
T6610–T6480 false-green precedent: jsdom has no FontFaceSet and canvas metrics don't
settle, so it cannot exhibit the very race this fixes).

### 1. Root cause — the residual overlap (FRONTEND-ONLY)

The live 2026-08-09 overlap (`broadcast`, name "Mehdi Khabazian", title line 2 landing
on the Position fact) is caused by the frontend computing the title's wrap **twice,
independently**, with different inputs and different settle loops:

1. **Layout reservation** — `introCardPreviewElements.js::layout`
   (`introCardPreviewElements.js:90`) → `fitTitle`/`countLines`
   (`:55`, `:69`) → `wrapLines(text, typo.font /* bare family key */, px,
   PREVIEW_FONT_WEIGHT = 400 /* hardcoded, :46 */, maxPx)`; settled by the
   `useCardPreviewElements` poll loop (`:238`). The module self-labels this an
   "approximation" (`:42-46`).
2. **Actual render** — `RichText.jsx` → `useSettledFontMetricsPx`
   (`RichText.jsx:244`) → `wrapLines(fontFamily /* resolveFontFamily → "anton",Impact,
   sans-serif, the FULL fallback chain */, fontPx, fontEntry.weight /* from the
   fonts.json manifest, :300 */, maxWidthPx)`; settled by its OWN independent poll.

Two divergence sources, both live:

- **Family string differs.** (1) passes the bare key `"anton"`; (2) passes the
  fallback chain `"anton", Impact, sans-serif`. Canvas `measureText` resolves the family
  string; while the custom face is not yet warmed (the documented T5180 landmine —
  metrics/selection stay approximate for an indeterminate number of frames AFTER
  `document.fonts.ready`), the two family strings can resolve to different fallback
  glyphs and therefore different advance widths — hence a different greedy break.
- **Two independent settle loops.** Each `wrapLines` runs under its own poll
  (`useCardPreviewElements` requires 6 stable frames; `useSettledFontMetricsPx` requires
  1 repeat). Even with identical inputs the two can *accept* a wrap at different frames,
  so they momentarily hold different line counts.

At the `broadcast` wrap boundary the title size is `0.068` — right at the edge where the
two-word name is one measurement away from wrapping (`introCardGeometry.js:116`). There
the reservation settles on **1 line** while `RichText` draws **2**, so the second line
drops onto the primary fact. In `recruiting` the title is `0.076` — past the boundary
(`introCardGeometry.js:324`), so BOTH agree on 2 lines and there is no overlap. That is
exactly the composition-specific repro: present in `broadcast`, absent (same name) in
`recruiting`. (Weight is NOT the title's divergence here — anton's manifest weight is
`400`, equal to the hardcoded `PREVIEW_FONT_WEIGHT`; the title split is driven by the
family-chain + settle-timing. The weight mismatch DOES bite the oswald facts, where the
manifest weight is `600` but the mirror hardcodes `400` — a second, latent instance of
the same "two independent wrap computations" class, folded into the same fix.)

The backend has no such split — `layout()`'s reservation and `render_text_layer`'s
draw call `wrap_lines` over the same `load_font_for_render` face — which is precisely
why only the preview overlaps.

**Unfulfilled intent.** The approved rounds-1-2 §2a stated *"RichText renders the
pre-broken lines the layout computed"* — a SINGLE wrap decision feeding both. The
implementation did not carry that out: `RichText` still re-wraps independently
(`RichText.jsx:247`, `:311`). Round 3 finishes that intent.

### 2. Fix options

**Option 1 (recommended) — single wrap decision, mirroring the backend.**
Have `layout()` emit the already-computed broken lines into each element's spec (a
`lines: string[]` on the produced TextSpec, or an equivalent `preWrapped` flag), and
have `RichText` render those verbatim for cards — skipping its own re-wrap when lines
are pre-supplied. Then exactly ONE wrap decision, settled ONCE by `useCardPreviewElements`,
feeds BOTH the height reservation and the glyph rendering. Collision becomes impossible
by construction, mirroring the backend, because the reserved height and the drawn glyphs
read the identical `lines` array. The line-advance metric must come from the SAME settled
source too: `RichText`'s `useSettledFontMetricsPx` currently owns `ascent+descent`; when
lines are pre-supplied it should still measure advance, but the caller's reserved height
and RichText's drawn height must use the same advance — so either (a) RichText derives its
line count from the supplied `lines` (advance measured locally, count fixed) — this is
sufficient because §A's bottom-anchor invariance means the facts don't move even if the
two advances differ by a sub-pixel, OR (b) the advance is also carried on the spec. Prefer
(a): it keeps RichText measuring its own metrics (no new metric on the parity contract)
while the *count* — the only thing that caused the collision — is fixed by the shared
`lines`.

- *Pro:* removes the double-wrap entirely; one settle loop; matches the backend's own
  structure; makes the collision unreachable rather than merely unlikely.
- *Con:* touches the TextSpec shape (a preview-only additive field) and RichText's render
  path (must remain the ONE renderer — see constraint below).

**Option 2 (weaker) — unify the wrap INPUTS only.**
Pass the same fallback-chain family + manifest weight into the layout mirror (import
`resolveFontFamily` and read the manifest weight in `introCardPreviewElements.js` instead
of the bare key + hardcoded 400), leaving both wrap computations in place.

- *Pro:* smallest diff; no spec-shape change.
- *Con:* **two settle loops still exist.** Identical inputs converge only *eventually*;
  during the warm-up frames the two loops can still accept different line counts at
  different frames, so the boundary case can still flash a collision. It narrows the
  window without closing it — a "less likely" fix, not a structural one. Rejected as the
  primary fix; a subset of it (using the correct family/weight) is folded into Option 1
  anyway so the single remaining wrap computation is correct.

**Recommendation: Option 1.** It is the only option that makes preview collision
impossible by construction and it discharges the §2a intent the implementation skipped.

**Spec / contract shape.** The new field is **preview-only and additive**: a
`lines?: string[]` produced by `layout()` and consumed by `RichText` when present. It
does NOT belong in the generated `introCardGeometry.js` parity contract — that contract
carries *inputs* (typography, reflow params) that both renderers wrap FROM; `lines` is a
*computed output* of the preview's single wrap, not a shared input, so it does not touch
`test_t5210_geometry_parity.py`'s byte-equality surface and needs no Python mirror. The
backend already renders from its own single `wrap_lines`; nothing about the parity
*contract* changes. (If review prefers the pre-wrap to be a first-class TextSpec concept
rather than an ad-hoc field, that is the open question §8a.)

**Hard constraint (epic rule, absolute):** ONE text renderer, ONE preview component. Do
NOT fork `RichText`. The pre-wrap path is a branch INSIDE the single `RichText` (render
supplied lines vs wrap locally), not a second component; the Overlay rail (no `lines`
supplied) keeps wrapping exactly as today.

### 3. Files to change (Round 3, AFTER approval)

Frontend (this round is preview-only):
- `src/frontend/src/components/introcards/introCardPreviewElements.js` — `layout()` emits
  the computed `lines` per element into the spec; fix the wrap INPUTS it uses (correct
  family chain + manifest weight) so the single surviving wrap computation is accurate.
- `src/frontend/src/components/RichText.jsx` — when `spec.lines` is present, render those
  verbatim (skip the local re-wrap); count comes from `lines`, advance still measured
  locally. Single component, internal branch — no fork.
- Tests — see §4 (new preview-level regression + extended Playwright parity spec).

NOT changed:
- `src/frontend/src/utils/introCardGeometry.js` — the generated parity contract is
  unaffected (no input change), so no regeneration unless §8a moves `lines` into the
  contract (not recommended).
- `src/backend/app/services/intro_card_geometry.py` / `text_render.py` /
  `player_intro.py` — backend is correct; untouched this round.
- `src/frontend/src/components/textspec/TextSpecEditor.jsx` — T6630-owned; untouched
  (the card rail no longer renders it; the Overlay rail keeps full control).
- No migration (no schema change).

### 4. Parity / test plan

- **`test_t5210_geometry_parity.py` stays green** because the parity *contract* (inputs)
  does not change — `lines` is a preview-computed output, not an emitted input block, so
  the byte-equality assertion is untouched. Re-run it unchanged.
- **New regression that would have caught THIS bug** — a preview-level assertion that
  *reserved height == rendered height* for a 2-line `broadcast` title. It must run in a
  REAL browser: extend `e2e/T5180-text-parity.spec.js` (per rounds-1-2 §2c) with a card
  case that renders the `broadcast` / long-name card and asserts the title's rendered
  line count equals the count `layout()` reserved (equivalently: the primary fact's ink
  box does not intersect the title's ink box). A jsdom/harness assertion is explicitly
  rejected — it cannot exhibit the FontFaceSet settle race (T5380 / T6610–T6480
  false-green precedent). The single-wrap fix (Option 1) makes this assertion true by
  construction because both sides read the same `lines`.
- **Acceptance proof is a real-browser measurement, deferred to QA post-approval.** §0's
  matrix is the backend positive control; the browser parity spec is the frontend
  acceptance gate and runs at QA.

### 5. Round-3 open questions (for approval)

- **(a) Pre-wrapped spec shape.** Recommendation: an additive preview-only `lines:
  string[]` on the produced TextSpec, consumed by `RichText`, NOT added to the
  `introCardGeometry.js` parity contract (it's a computed output, not a shared input).
  Approve this shape, or prefer it modelled as a first-class TextSpec field (which would
  touch the contract + its Python mirror)?
- **(b) Dead `text_elements` write surface.** `routers/intro_cards.py` still ACCEPTS
  `text_elements` on create/patch (`:79`, `:98`, `:216`, `:230`, `:276`) — nothing sends
  it, so it is a dead write surface. Recommendation: leave it (harmless; rejecting it is
  a separate small hardening not required for this bug), OR reject the field for
  cleanliness. Minor — recommend leaving; confirm.
- **(c) Matrix nits.** The §0 matrix reads as designed across all 48 stills; no defect
  identified. Confirm none, or name a frame to adjust.

**Answers (user, 2026-08-09):**
- (a) Approved as recommended: additive preview-only `lines: string[]` on the produced
  TextSpec, consumed by `RichText`, NOT added to the `introCardGeometry.js` parity
  contract.
- (b) Reject the dead `text_elements` write surface — `routers/intro_cards.py` create/patch
  no longer accept it. Project convention is to delete unused code outright, no
  backwards-compat shims.
- (c) Confirmed — no matrix frame adjustments needed.

---

## Rounds 1-2 (shipped — merged `bb53188b`, 2026-08-06)

> The sections below are the approved-and-implemented rounds-1-2 design. They are
> retained for provenance and remain accurate about the SHIPPED backend + rail behaviour.
> The one place the implementation diverged from this text is §2a (RichText was intended
> to render the pre-broken lines but re-wraps independently) — that gap is Round 3's job,
> fixed above.

### 0. Evidence first (this design is not accepted without it)

All renders go through the REAL pixel path — `player_intro`'s Pillow helpers
(`_render_background`, `_frame_photo`, `_render_tint`, `_render_vignette`,
`_render_scrim`) plus the REAL glyph renderer `text_render.render_text_layer`. The
still is the card's settled frame (what the user sees before the exit flash).

**No PII:** names are invented (`Maya`, `Anastasia Wintergreen`); the "photo" is a
procedurally-generated silhouette (`qa/_helpers.py::make_placeholder_photo`) — not
derived from any real image. The reported minor's name/photo appear nowhere.

#### Step 1 — the bug, reproduced on the UNCHANGED current code
`qa/confirm_bug.py` builds one card via the production `build_intro_card`, recruiting
/ 9:16 / long two-word name:

- `qa/step1_current/current_recruiting_9x16_longname.png`

The title `Anastasia Wintergreen` wraps to two lines and the second line
(`Wintergreen`) lands **on top of** the `Midfielder` fact — illegible overlap. The
flat hierarchy (position / class / team at one weight) is visible in the same frame.
This is the acute + chronic failure the task describes, in one image.

#### Step 3 — the 12-card proof matrix (the NEW design)
`qa/render_matrix.py` (prototype layout in `qa/newdesign.py`) renders **3 treatments
× 2 aspects × {short one-word, long two-word} = 12**, composition held at
`recruiting` (3 facts — the densest, most collision-prone, and the one from the
report):

| | 9:16 short | 9:16 long | 16:9 short | 16:9 long |
|--|--|--|--|--|
| gold | `qa/matrix/gold_9x16_short.png` | `qa/matrix/gold_9x16_long.png` | `qa/matrix/gold_16x9_short.png` | `qa/matrix/gold_16x9_long.png` |
| dark | `qa/matrix/dark_9x16_short.png` | `qa/matrix/dark_9x16_long.png` | `qa/matrix/dark_16x9_short.png` | `qa/matrix/dark_16x9_long.png` |
| photo-forward | `qa/matrix/photo-forward_9x16_short.png` | `qa/matrix/photo-forward_9x16_long.png` | `qa/matrix/photo-forward_16x9_short.png` | `qa/matrix/photo-forward_16x9_long.png` |

Overview: `qa/matrix/_contact_sheet.png`.

> The prototype in `qa/` is EVIDENCE, not the implementation. §1–§4 specify what ships.

### A. Wrap-safe layout — measured, bottom-anchored reflow

Replaced the static per-slot `{x,y,size,align}` for the TEXT stack with a **measured
layout** computed at render time (and identically at preview time): a photo rect, an
anchor (`bottom`/`center`), an anchor-x / align / maxWidth, unequal rhythm gaps, and
role typography (§B). The shared `layout()` measures each element's wrapped line count +
line advance, shrink-fits the title to `maxLines = 2`, sums the stack height, places the
block against the anchor, and walks each element down writing the computed `position.y`
and shrunk `size`. **Bottom-anchoring makes collision-freedom structural:** the title is
the top element, so a taller title's extra height cancels for every element below it —
the facts sit at the same y whether the name is one or two lines; the name floats up into
empty space. Shrink-to-fit bounds the block height by construction.

*(Shipped in `intro_card_geometry.layout` / `_fit_title` and mirrored in
`introCardPreviewElements.js::layout`. The backend half is proven correct by the Round-3
matrix; the preview half's residual double-wrap is Round 3's fix.)*

### 2. Parity — how RichText.jsx and text_render.py compute IDENTICAL line breaks

**2a. One wrap algorithm, mirrored, over a metric already proven equal.** A shared
`wrapLines(text, fontFamily, fontPx, weight, maxPx)` — the JS twin of
`_wrap_paragraph` — replaces CSS soft-wrap so both renderers run the SAME greedy
algorithm on the SAME metric. *Intended: RichText renders the pre-broken lines the
layout computed. The implementation shipped the shared `wrapLines` but RichText still
re-wraps independently — see Round 3.*

**2b. Parameter parity — `test_t5210_geometry_parity.py` (no JS runtime).** New role
TYPOGRAPHY / REFLOW / rhythm blocks are emitted into the generated `introCardGeometry.js`
inside `@parity:*` markers and re-parsed for byte-equality against the Python source.

**2c. Runtime parity — extend the T5180 Playwright spec.** A card-level case renders a
wrapping two-word title through `<RichText>` and the backend seam and asserts the
tight-ink bbox of each line agrees within `TOL_BOX_FRACTION`. *(Round 3 extends exactly
this spec with the reserved-height == rendered-height card assertion.)*

### B. Template-owned typography (decision 12)

Three roles (title / primary / secondary) replace per-slot user styling; hierarchy comes
from size + colour role (treatment accent vs fixed muted grey), consistent by
construction with no reachable colour clash. The card rail's STYLE → Text (slot picker +
`TextSpecEditor`) block was REMOVED entirely; the card rail keeps only content +
look-selection (facts / photo / treatment / subtitle). The Overlay text rail keeps the
shared editor with full control. **`TextSpecEditor.jsx` is not edited** (the card rail
stops rendering it). *(Shipped and confirmed DONE in the Round-3 audit.)*

### C. Composition quality — each named defect, answered

Three type roles for hierarchy; unequal rhythm gaps for grouping; treatment-accent /
muted-grey colour (no user colour input); feathered inset-photo seam for the 16:9 halves;
one text column with fixed `anchorX` + `maxWidth` for a margin grid; framing kept as the
stored focal + zoom. *(All in the contract; validated across all 4 compositions by the
Round-3 matrix.)*

### D. Existing data — `text_elements` becomes fully dead

profile_db **v038** (`v038_null_dead_intro_card_text_elements.py`) sets `text_elements =
NULL` on every `intro_cards` row (mirroring `v036` for `title_text`); the renderer and
preview no longer read it. Correct-data, no silent fallback. *(Shipped and confirmed DONE
in the Round-3 audit. Residual: the router still accepts the field on write — Round 3
§5b decides.)*

### Risks (rounds 1-2)

1. Runtime line-break drift at a boundary word — mitigated by §2 + the §A invariance.
   *(This is exactly the residual the Round-3 top section fixes structurally.)*
2. Recruiting-landscape centre-anchor moves the whole block with title line count — no
   collision (ample room, nothing below).
3. v038 collision with T5215's v037 — resolved at implementation time.
4. Prototype ≠ production — the matrix proved the APPROACH; final numbers set in impl.
</content>
</invoke>

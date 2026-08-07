# T6640 — Cards that cannot be made ugly — Design

**Status:** WAITING ON USER (design gate)
**Tier:** L · Backend + Frontend · design-gated · migration
**Amends:** epic requirement 2 via [decision 12](player-intro/EPIC.md); see task
[T6640-cards-cannot-be-ugly.md](T6640-cards-cannot-be-ugly.md).

> Requirement, in the user's words: *"the point of the templates is they all look
> professionally designed. The user shouldn't be able to make it ugly."*

The design turns that from a hope into a structural guarantee: every reachable
combination of user choices produces a well-composed card because **layout and
typography are owned by the template, not the user**, and the layout is **measured**
so text can never collide.

---

## 0. Evidence first (this design is not accepted without it)

All renders go through the REAL pixel path — `player_intro`'s Pillow helpers
(`_render_background`, `_frame_photo`, `_render_tint`, `_render_vignette`,
`_render_scrim`) plus the REAL glyph renderer `text_render.render_text_layer`. The
still is the card's settled frame (what the user sees before the exit flash).

**No PII:** names are invented (`Maya`, `Anastasia Wintergreen`); the "photo" is a
procedurally-generated silhouette (`qa/_helpers.py::make_placeholder_photo`) — not
derived from any real image. The reported minor's name/photo appear nowhere.

### Step 1 — the bug, reproduced on the UNCHANGED current code
`qa/confirm_bug.py` builds one card via the production `build_intro_card`, recruiting
/ 9:16 / long two-word name:

- `qa/step1_current/current_recruiting_9x16_longname.png`

The title `Anastasia Wintergreen` wraps to two lines and the second line
(`Wintergreen`) lands **on top of** the `Midfielder` fact — illegible overlap. The
flat hierarchy (position / class / team at one weight) is visible in the same frame.
This is the acute + chronic failure the task describes, in one image.

### Step 3 — the 12-card proof matrix (the NEW design)
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

**What the matrix proves:** in all 12, the long two-word name wraps and **no line
collides** with any slot below it; the name reads as the hero, the position reads as
an accent sub-head, and class/team recede as a muted supporting group; the 16:9 photo
bleeds into the panel (no hard seam); margins and baselines are consistent. The
short-name and long-name cards differ only in that the name grows upward into empty
space — the facts do not move (see §2, the invariance property).

> The prototype in `qa/` is EVIDENCE, not the implementation. It reproduces the
> proposed layout/typography against the real renderers so the claim can be seen. It
> is not the code that ships; §1–§4 specify what ships.

---

## A. Wrap-safe layout — measured, bottom-anchored reflow

### Current state (the bug)
`intro_card_geometry.GEOMETRY` stores every slot at a FIXED fractional `y`
(`intro_card_geometry.py:140-217`) that assumes a one-line title. `text_render`
wraps the title to N lines but nothing below it moves, so line 2 overflows into the
next slot. `player_intro._select_elements`/`_merge_spec` copy the static `y` straight
onto each `TextSpec.position`.

### Target state
Replace the static per-slot `{x,y,size,align}` for the TEXT stack with a **measured
layout** computed at render time (and identically at preview time). Per composition ×
aspect the contract stores, instead of fixed slot positions:

- a **photo rect** (unchanged in kind),
- an **anchor**: `("bottom", baselineFrac)` for the lower-third looks and recruiting
  portrait; `("center", centreFrac)` for recruiting landscape and title-only,
- an **anchor x / align / maxWidth** for the text column,
- **rhythm gaps** (`gapAfterTitle`, `gapGroup`, `gapLine`) — deliberately unequal so
  the name+position group reads apart from the class/team group,
- the **role typography** (§B).

The shared `layout(elements, frameW, frameH)` then:

1. measures each element's wrapped **line count** and **line advance**
   (`ascent+descent`, the face's own metrics — the same source both renderers already
   use, T5180),
2. shrink-fits the title to `maxLines = 2` within `maxWidth`, floored at a min size
   (§ shrink-to-fit),
3. sums the stack height (line counts × advances + gaps),
4. places the block against the anchor and walks each element down, writing the
   computed `position.y` (and shrunk `size`) into each element's `TextSpec`.

The renderer and preview then draw those specs exactly as today — the ONLY change is
where `position.y`/`size` come from (computed, not static).

### Why bottom-anchoring is the right choice (and is collision-robust)
Because the stack is anchored at its BOTTOM and the title is the TOP element,
`titleTop = baseline − totalHeight`. The extra height of a 2-line title is added to
`totalHeight` AND subtracted from `titleTop`, so it **cancels for every element below
the title**: position/class/team sit at the SAME y whether the name is one line or
two — the name simply grows upward into empty space above it. This is visible in the
matrix (short vs long: facts fixed, name floats up).

Consequence for safety: even in the (guarded-against) event that the two renderers
disagreed on the title's line count by one, **the facts would not move on either side
and nothing would collide** — the disagreement would only shift the name into/out of
empty space. Collision-freedom does not depend on perfect line-count parity; it is
structural. (Parity is still enforced so preview == export to the pixel — §2.)

### Shrink-to-fit (the height bound)
`_fit_title` reduces the title size in small steps until it wraps to ≤ 2 lines within
`maxWidth`, with a min-size floor (e.g. 0.052·H portrait / 0.095·H landscape). A
pathological single word wider than the column shrinks until it fits one line (or
bottoms out at the floor, still bounded — the frame-edge `overflow:hidden` / Pillow
canvas bound from T5180 remains the final backstop). Block height is therefore bounded
by construction, so the stack can never run past the frame.

**Chosen:** measured reflow (facts fixed, name floats) **with** shrink-to-fit as the
height bound. Both, not either — reflow gives the tight, intentional rhythm; shrink
guarantees the bound. A pure fixed-reserved-zone alternative (never move facts, always
reserve 2 lines) was considered and rejected: it leaves a dead gap above the facts for
the common one-line name, hurting the "even rhythm" defect the task names in §C.

---

## 2. Parity — how RichText.jsx and text_render.py compute IDENTICAL line breaks

This is the load-bearing risk, so it is specified exactly. There are three layers, and
the guarantee is the combination.

### 2a. One wrap algorithm, mirrored, over a metric already proven equal
`text_render.py` already wraps with a greedy, whitespace-only algorithm
(`_wrap_paragraph`, `font.getlength`). Today `RichText.jsx` does NOT wrap in JS — it
delegates to the browser's CSS soft-wrap (`maxWidth` + `white-space: pre-line` +
`suppressInWordBreaks`). CSS wrapping and Python greedy usually agree but are not the
same algorithm, so a boundary word could split differently — unacceptable once line
COUNT drives layout.

**Change:** give `RichText.jsx` an EXPLICIT shared wrap `wrapLines(text, fontFamily,
fontPx, weight, maxPx)` — the line-for-line JS twin of `_wrap_paragraph`, using Canvas
2D `measureText().width` where Python uses `font.getlength`. RichText then renders the
pre-broken lines (joined with `\n`, still `pre-line`) instead of relying on CSS to
choose the breaks. Both renderers now run the SAME greedy algorithm on the SAME metric.

The metric equality (`measureText().width` ≡ `font.getlength`) and the font-metric
settle behaviour are ALREADY established and defended by the T5180 parity spec
(`e2e/T5180-text-parity.spec.js`) and its `useSettledFontMetricsPx` hook; the hyphen
word-joiner (`suppressInWordBreaks`) already aligns break OPPORTUNITIES. We are
removing the one remaining divergence source (CSS vs greedy), not inventing new
agreement.

### 2b. Parameter parity — `test_t5210_geometry_parity.py` (no JS runtime)
The contract's new blocks (role **TYPOGRAPHY**, **REFLOW/rhythm** params, `maxLines`,
`minSize`, anchor mode/baseline) are emitted into the generated
`introCardGeometry.js` inside `@parity:*` markers exactly like the existing GEOMETRY /
MOTION / TREATMENTS blocks, and `test_t5210_geometry_parity.py` re-parses and asserts
byte-equality with the Python source. Extend that test to the new blocks so a Python
edit without regenerating the JS (or a hand-edit) fails, as today. **This is the test
the task names; it keeps and expands its role — it guards that both renderers layout
with identical INPUTS.** Add a Python-side unit test of `layout()` asserting: (i) for a
1-line and a 2-line title, every fact's `position.y` is identical (the invariance
property); (ii) no two elements' `[y, y+height]` intervals overlap; (iii) the block
stays within `[0,1]`.

### 2c. Runtime parity — extend the T5180 Playwright spec
Parameter parity + a mirrored algorithm still needs an end-to-end check that the two
RUNTIMES agree on the composed result. Extend `e2e/T5180-text-parity.spec.js` (or a
sibling `T6640` spec) with a card-level case: render a wrapping two-word title through
`<RichText>` and through the backend `/api/test/render-text-bbox` seam and assert the
tight-ink bbox of each line agrees within the existing `TOL_BOX_FRACTION`. This is
where "identical line breaks" is actually exercised against a real browser.

**Summary of the guarantee:** identical algorithm (2a) + identical inputs asserted
without a JS runtime (2b) + identical output asserted in a real browser (2c); and,
underneath all three, a layout whose collision-freedom does not even depend on the
line count matching (§A, invariance). If 2c ever shows drift at a sub-pixel boundary
word, the fallback is to bias the JS wrap to break at `maxPx − ε` (a shared epsilon in
the contract) so the browser never keeps a word the backend drops.

---

## B. Template-owned typography (decision 12)

### Roles (in the shared contract, derived from the treatment)
Three roles replace per-slot user styling:

| Role | Slot(s) | Font | Size (frac H) | Colour | Weight/shadow |
|------|---------|------|---------------|--------|----------------|
| **title** | `title` (name) | Anton | 0.076 / 0.150 (P/L), shrink-fit, ≤2 lines | treatment **accent** | strong shadow |
| **primary** | first fact (`fact1` = position) | Oswald | 0.044 / 0.072 | treatment **accent** | shadow |
| **secondary** | `fact2`,`fact3`, subtitle | Oswald | 0.030 / 0.050 | **muted** `#c3cad6` | shadow |

Hierarchy comes from **size + colour role** (accent vs muted), which is consistent by
construction: the accent is the treatment's own colour (`gold #f7e28b`, `dark
#e5e7eb`, `photo-forward #ffffff`), the muted grey is fixed. There is no reachable
colour clash because there is no user colour input, and colour never varies WITHIN a
line (the "West Coast white / ECNL green" defect is now unreachable). For `dark` and
`photo-forward`, where the accent is already near-white, hierarchy falls to size — the
matrix confirms that still reads.

### The card editor rail — remove all typography controls
Decision 12 makes font, colour, size, align, weight, shadow, stroke and spacing
template-owned for cards. After that, **there is nothing left for a per-slot styling
editor to edit.** So the cleanest change is to **remove the entire STYLE → Text →
(slot picker + `TextSpecEditor`) block from `IntroCardRail.jsx`**, not to hide its
controls one by one.

The card rail keeps only CONTENT + look-selection controls:
- **On the card** — which facts show (composition), unchanged.
- **Photo** — thumbnail / replace / remove / zoom, unchanged.
- **Style → Treatment** — the 3-way gold/dark/photo-forward toggle, unchanged.
- **Subtitle (this card)** — the one free-text field (content, not styling), unchanged.

Removed from the card rail: the slot picker, `specForSlot`/`onUpdateSlotSpec`/
`onSelectSlot` plumbing, `COLOR_SWATCHES`, and the `TextSpecEditor` instance (with its
Font / Colour / custom picker / Shadow / Stroke controls).

> **File-ownership note (T6630).** Because the card rail STOPS RENDERING
> `TextSpecEditor` entirely, **T6640 does not need to edit
> `src/frontend/src/components/textspec/TextSpecEditor.jsx`** — the T6630-owned file
> is untouched, and the Overlay text rail keeps the shared editor with FULL user
> control (font/colour/shadow/stroke), exactly as decision 12 requires. This is
> strictly better than the "extend the host-prop pattern (hideFont/hideColor/
> hideEffects)" approach the task file floated, which WOULD require editing that file
> and thus sequencing after T6630. If the reviewer prefers keeping a fully-hidden
> shared editor on the card rail for symmetry, that is the only path that needs
> T6630's file and the dependency should be declared — but this design recommends
> removal and needs no such dependency.

---

## C. Composition quality — each named defect, answered

| Defect (task §C) | Answer in this design |
|---|---|
| No hierarchy below the name | Three type roles: name (XL Anton) → position (accent Oswald, larger) → class/team (muted, smaller). Distinct size AND colour role. |
| Even vertical rhythm | Unequal rhythm gaps: tight name→position (they group as the hero), a larger `gapGroup` before class/team (a second group), tight within it. |
| Arbitrary / inconsistent colour | Colour is the treatment accent (title, position) or a fixed muted grey (class/team). No user colour input; never varies within a line. Unreachable clash. |
| Hard 50/50 seam (16:9) | The inset photo's inner edge is **feathered** into the treatment background (`seamFeather`), and the treatment radial backdrop carries the tone across the seam — the two halves read as one object. See any `*_16x9_*` sample. |
| No margin grid | One text column with a fixed `anchorX` + `maxWidth`; a shared bottom baseline (portrait) / vertical centre (landscape); consistent side margins. |
| Photo not composed for its frame | Framing stays the stored focal point + zoom (epic 3b); the template can't fix a bad focal, but the feathered seam + vignette grade keep a poorly-placed subject from reading as a raw cut-out. (No new control — focal editing is existing UX.) |

---

## D. Existing data — `text_elements` becomes fully dead

With all typography template-owned, `intro_cards.text_elements` (per-slot font/colour/
shadow/stroke) is **entirely dead** — the same situation T6620 created for
`title_text`, one step further. The renderer and preview stop reading it: `_merge_spec`
/ `mergeSpec` no longer take a `styling` argument; every spec is built from (role
typography + measured layout + resolved text). The write path is gone with the removed
editor.

**Decision: migrate to NULL (correct-data), do not preserve.** Add profile_db
**v038** (`v038_null_dead_intro_card_text_elements.py`) that sets `text_elements =
NULL` on every `intro_cards` row, mirroring `v036_null_dead_intro_card_title_text`.
No silent fallback: the renderer derives styling from the template unconditionally and
never consults the column; the migration reclaims the now-meaningless blob so a future
reader can't be tempted to resurrect it. Update the `_USER…`/`database.py` DDL comment
to mark `text_elements` DEAD (as T6620 did for `title_text`).

**Version check:** master head is profile_db **v036**; there is **no v037 or v038 in
any branch** as of this branch. The kickoff/task reserve **v037 for T5215 in flight**,
so T6640 takes **v038**. Open question flagged below to re-verify against T5215's
branch at implementation time (duplicate versions are silently skipped by the runner).

---

## Files to change (implementation, AFTER approval)

Backend:
- `app/services/intro_card_geometry.py` — replace static text-slot geometry with
  photo rect + anchor + rhythm + role TYPOGRAPHY; add the shared `layout()`; regenerate
  the JS mirror; keep MOTION/treatments.
- `app/services/text_render.py` — expose the greedy wrap as a reusable pure function
  (already effectively `_wrap_text`); no behaviour change to glyph rendering.
- `app/services/player_intro.py` — `_select_elements`/`_merge_spec` build specs from
  role typography + measured `layout()`; drop the `styling`/`text_elements` read.
- `app/migrations/profile_db/v038_null_dead_intro_card_text_elements.py` (+ DDL comment).
- Tests: extend `tests/test_t5210_geometry_parity.py` (new param blocks + `layout()`
  unit tests); `tests/test_t5210_player_intro.py` (wrapping-title-never-collides
  matrix); parity Playwright spec (§2c).

Frontend:
- `src/frontend/src/utils/introCardGeometry.js` — regenerated (do not hand-edit).
- `src/frontend/src/components/RichText.jsx` — explicit shared `wrapLines` (§2a).
- `src/frontend/src/components/introcards/introCardPreviewElements.js` — call the
  mirrored `layout()`; drop the `styling` merge.
- `src/frontend/src/components/introcards/IntroCardRail.jsx` — remove the per-slot
  styling editor block (§B); keep facts / photo / treatment / subtitle.
- **NOT** `src/frontend/src/components/textspec/TextSpecEditor.jsx` (T6630-owned;
  untouched by design — see §B note).

---

## Risks

1. **Runtime line-break drift at a boundary word** — mitigated by §2 (mirrored
   algorithm over an already-equal metric, plus the shared-epsilon fallback), and
   de-risked by the §A invariance property (facts don't move on either side).
2. **Recruiting-landscape centre-anchor** does move the whole block with title line
   count (no invariance there) — but the panel has ample vertical room and nothing
   below the stack, so no collision; parity tolerance still applies.
3. **v038 collision with T5215's v037** — must be re-verified against the sibling
   branch at implementation time.
4. **Prototype ≠ production** — the exact contract numbers will be finalised in the
   implementation; the matrix proves the APPROACH, and the numbers there are the
   starting point.

---

## Open questions (for approval)

1. **Composition for the matrix.** Held at `recruiting` (densest / from the report).
   Approve, or also require rendered hero/broadcast/title-only samples before sign-off?
2. **Removal vs hidden editor on the card rail.** Design recommends REMOVING
   `TextSpecEditor` from the card rail (needs no T6630 file change). Confirm you don't
   want a fully-hidden shared editor kept for symmetry (which would need T6630's file).
3. **Migration version.** v038 assumed (v037 → T5215). Confirm at implementation time
   against T5215's branch.
4. **Muted secondary colour.** `#c3cad6` used for class/team across all treatments.
   Acceptable, or should the muted tone also derive per-treatment (e.g. warm-grey on
   gold)?
5. **Subtitle role.** Treated as `secondary` typography. Confirm the subtitle should
   sit in the muted supporting group (not accented).

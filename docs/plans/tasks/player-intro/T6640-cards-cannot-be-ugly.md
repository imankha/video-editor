# T6640: Cards that cannot be made ugly — template-owned typography + wrap-safe layout

**Status:** TODO — reproduced live 2026-08-09, still unfixed, ready to start (T6630 merged, file
ownership lock below is cleared)
**Impact:** 9 | **Complexity:** 6
**Epic:** [Player Intro + Rich Text](EPIC.md) — **amends requirement 2 (decision 12)**
**Blocked-by (file ownership):** ~~[T6630](T6630-overlay-text-add-remove-drag-ux.md) owns
`TextSpecEditor.jsx` while it is in flight.~~ T6630 merged 2026-08-08 — no longer blocking.

## Reproduced live 2026-08-09 (Playwright, real account, real card)

Confirmed still present. Card "New card 2" (profile `9fa7378c`), **broadcast composition** (photo
+ Position + Team, Class unchecked), name "Mehdi Khabazian" wraps to 2 lines. Measured via
bounding boxes, not eyeballed: title box `y: 573.9–681.2`, Position fact ("Attacking Mid") box
`y: 632.1–659.8` — fully inside the title's box, i.e. the second title line and the position fact
render on top of each other. Toggling on the 3rd fact (Class → `recruiting` composition) removes
the overlap for this exact name, so it is NOT universal across compositions — it reproduces in
`broadcast`, not (for this name) in `recruiting`.

**IMPORTANT — this task file predates a real partial implementation and is WRONG about current
code state in at least one place; verify everything below at Stage 1, do not trust either the
task file's claims OR this note blindly.** `git log`/`git show bb53188b` shows a merge "T6640
rounds 1-2 + v040 default backfill" (2026-08-06) that rewrote `intro_card_geometry.py` (496 lines)
to REPLACE the fixed-fractional-y `slots` dict described in root cause A below with a measured
`_reflow` (anchor + rhythm) system — confirmed still present in the current file (`_reflow`,
`GEOMETRY` comment "T6640 replaced the old fixed-y `slots` dict with `reflow`"). The FRONTEND
preview (`introCardPreviewElements.js`: `countLines`, `fitTitle`, `gapBetween`) already measures
real line counts rather than assuming a fixed position — so both backend and frontend already
moved off the exact mechanism root cause A describes as missing.

**What this means for scope:**
- **Root cause A as WRITTEN below (fixed fractional-y, one-line-title assumption) is STALE — the
  reflow system it describes as needed already exists.** The bug I reproduced live is therefore a
  RESIDUAL defect within the existing reflow system for specific compositions (confirmed:
  `broadcast` with a 2-line name), not an absent system. Find why `_reflow`'s anchor/rhythm math
  under-reserves space for a 2-line title in at least the `broadcast` case — do not re-implement
  reflow from scratch.
- **Item B's claim that `IntroCardRail.jsx` "currently passes `hideText/hideSize/hideAlign/
  collapseEffects` + `colorSwatches` to the shared `TextSpecEditor`" is FALSE as of 2026-08-09** —
  grepped directly: `TextSpecEditor` appears only in a comment in that file (about T6630's
  ownership lock, now cleared), never actually rendered. Item B (template owns typography, user
  controls removed from the card rail) does NOT appear to be built yet — verify at Stage 1.
- **Items C (composition polish) and D (migrate stored per-slot font/colour) status unknown** —
  audit before assuming either is done or not done.

User, 2026-08-06, with a 9:16 and a 16:9 card screenshot:

> Here is the intro card with a name, I don't like the overlap.
>
> also does this look professionally designed to you?
>
> **the point of the templates is they all look professionally designed. The user shouldnt be
> able to make it ugly**

That last line is the requirement. Everything below serves it.

> **PII:** the reporting screenshots contain a real minor's name and photo. Do NOT commit the
> name, the photo, or a fixture derived from them. Use an invented long two-word name in tests.

## The root cause is one thing

The card system does not **guarantee** a good result. It offers axes and hopes. The wrap collision
is the acute failure; the flat, arbitrary-looking 16:9 card is the chronic one. Both are the same
bug: nothing in the pipeline enforces that the output is well-composed.

## A. The layout is not wrap-aware (acute — this is the reported overlap)

Slot geometry places every text slot at a FIXED fractional y
(`src/backend/app/services/intro_card_geometry.py:144-190`) — e.g. `hero` 9:16 puts `title` at
`y=0.40` and `subtitle` at `y=0.50`. That spacing assumes a ONE-LINE title. A long name wraps to
two lines and the second line overflows into the slot below, colliding with the subtitle and the
fact lines. **Any athlete with a long name hits this**, at any composition.

Fix requires measured layout, not more hand-tuned constants. Decide and justify in the design:
- reflow the following slots from the MEASURED line count of the ones above (a vertical stack with
  real rhythm), and/or
- auto-fit the title (shrink-to-fit within a max line count) so the block height is bounded.

Whatever is chosen must produce **identical geometry in the browser preview and the PIL render** —
the epic's parity rule is absolute here, and `tests/test_t5210_geometry_parity.py` already fails if
the two diverge. Line breaking must therefore be computed the same way on both sides.

## B. The template owns typography (user decision, 2026-08-06)

**This amends epic requirement 2** ("the user controls the text, the font, and the font colour")
**for CARDS only.** Recorded as epic decision 12.

- The user picks: **which facts show** (composition), **the treatment**, **photo framing**, and
  **free text** (subtitle, and their profile fields).
- The **template** owns: font, colour, size, alignment, weight, shadow, stroke, and spacing —
  derived from the treatment and expressed in the SHARED contract so preview and export agree.
- Therefore **remove font, the custom colour picker, colour swatches, shadow blur and stroke width
  from the CARD editor rail** (`IntroCardRail.jsx` currently passes `hideText/hideSize/hideAlign/
  collapseEffects` + `colorSwatches` to the shared `TextSpecEditor`; size and align are ALREADY
  layout-owned — extend that same host-specific pattern to the rest).
- **Do NOT remove them from the Overlay text rail.** Overlay text is the user annotating their own
  video; there is no template promise there and they keep full control. This is exactly why the
  shared editor takes host props instead of being forked — do not fork it.

The card in the report was reachable *because* an arbitrary colour wheel is on the card editor.
Closing that is the point of the task.

## C. The composition itself must look designed

Specific defects observed in the 16:9 photo-forward card, all of which the design pass must answer:
- **No hierarchy below the name** — position, class and club render at near-identical size and
  weight, so the block reads as a list rather than a composition.
- **Even vertical rhythm** — equal gaps everywhere, so nothing groups.
- **Arbitrary colour** — saturated green against a black panel beside a DESATURATED photo, with no
  relationship to the image; and applied inconsistently within one line ("West Coast" white,
  "ECNL" green), which reads as an error.
- **Hard 50/50 seam** between photo and panel with no bleed, gradient or overlap — the two halves
  do not read as one object.
- **No margin grid** — the text block has no consistent margin or shared baseline with the photo.
- **The photo is not composed for its frame** — subject left with dead space, head near the edge.

## D. Existing cards

Cards already store per-slot font/colour in `text_elements`. Decide EXPLICITLY in the design
whether those become dead (migrated to NULL so styling derives from the treatment — the
correct-data principle, and the precedent T6620 set for `title_text`) or are preserved. Do not
leave a silent fallback path.

If a migration is needed: **profile_db v037 is being taken by T5215 in flight** — take v038 or
later and verify against sibling branches before choosing (duplicate versions are silently skipped
by the runner).

## DESIGN GATE — stop here

Produce `docs/plans/tasks/T6640-design.md` covering A-D, and **STOP for approval before writing
implementation code.**

The design MUST include **actually rendered sample cards**, not descriptions: every treatment
(gold / dark / photo-forward), at BOTH 9:16 and 16:9, each rendered twice — once with a SHORT
one-word name and once with a LONG two-word name that wraps. That matrix is what proves the
"cannot be made ugly" claim. Save them where the supervisor can read them from the host.

## Relevant files
- `src/backend/app/services/intro_card_geometry.py` — the shared slot/treatment contract
- `src/backend/app/services/text_render.py` — PIL render (wrap + shadow/stroke)
- `src/backend/app/services/player_intro.py` — card -> MP4
- `src/frontend/src/components/RichText.jsx` — browser render, must match the above
- `src/frontend/src/components/introcards/IntroCardRail.jsx` — the card editor rail (controls to remove)
- `src/frontend/src/components/introcards/IntroCardPreview.jsx`, `introCardPreviewElements.js`
- `src/frontend/src/components/textspec/TextSpecEditor.jsx` — shared editor (**T6630 owns this
  while in flight; coordinate before editing**)
- `src/backend/tests/test_t5210_geometry_parity.py` — the parity gate

## Classification hint
L-tier, backend + frontend, **design-gated**, migration likely. Architect + Reviewer + Migration.
UI-designer input on C. Parity test extension is mandatory.

## Acceptance criteria
- [ ] A long two-word name NEVER collides with any slot below it, at 9:16 and 16:9, in EVERY
      composition, in BOTH the browser preview and the PIL render.
- [ ] Preview and export produce the same line breaks and the same slot positions (parity test
      extended to cover a wrapping title, not just a one-line one).
- [ ] The card editor exposes no control that can produce a colour or font clash — font, custom
      colour, swatches, shadow and stroke are gone from the CARD rail.
- [ ] The Overlay text rail is unchanged and still offers full font/colour/shadow/stroke control.
- [ ] Colour and font are derived from the treatment inside the shared contract, so preview and
      export agree by construction.
- [ ] The fact lines show real typographic hierarchy and grouping rather than an evenly-spaced list.
- [ ] Existing cards with stored per-slot styling render correctly under the new rules, with the
      data decision from D implemented (no silent fallback).
- [ ] Rendered evidence for the full matrix: 3 treatments x 2 aspects x {short name, long name}.

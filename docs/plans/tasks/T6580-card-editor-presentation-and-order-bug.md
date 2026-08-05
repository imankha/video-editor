# T6580: Card editor — bigger card, readable controls, treatments that visibly differ, and an order-dependent render bug

**Status:** TODO
**Impact:** 7 | **Complexity:** 4
**Follows:** [T6540](T6540-card-editor-information-design.md) (rail information design, merged bd17b228)

Four items from staging use, 2026-08-05. T6540 fixed the rail's *structure*; these are about its
*presentation* — plus one real bug.

## 1. The modal does not cover the page behind it

> The Intro card popup doesn't cover the Ready my drafts

Reel cards ("Brilliant Dribble", "Move to My Reels") are clearly legible outside the panel, with
bright cyan buttons pulling the eye away from the card being edited. T6540 already deepened the
scrim `/70 → /80` and it is still not enough.

Make the backdrop actually suppress the page. Options: a much heavier scrim, a blur, or a fuller-bleed
panel. The bar is that nothing behind competes for attention — bright accent buttons are the tell.

### CORRECTION 2026-08-05 — this is a Z-ORDER bug, and a scrim CANNOT fix it

Second round of user screenshots (reel cards painted crisply over the modal *panel*, cyan buttons
undimmed) plus a code read settle the question T6540 left open (*"resolve whether a reel card seen
inside the modal is page bleed-through or a layering bug"*). **It is a layering bug.** Both passes so
far have raised the scrim (T6540 `/70`→`/80`, this task `/80`→`/90`+blur) and neither could work,
because the offending elements paint ABOVE the scrim:

- `ManageProfilesModal`'s root is `fixed inset-0 ... z-50` (`ManageProfilesModal.jsx:302`), which
  **establishes a stacking context**.
- `IntroCardsModal` is rendered as a CHILD of that subtree (`ManageProfilesModal.jsx:451`) and sets
  its own `fixed inset-0 z-50` (`IntroCardsModal.jsx:88`). That `z-50` is scoped to the parent's
  context, so the intro card modal's effective root-level ceiling is z-50 — it cannot rise above
  anything else on the page at z-50 or higher, no matter what number it uses internally.
- `DraftTile` portals its overlays **to `document.body`** at `z-[60]` and `z-[70]`
  (`DraftTile.jsx:708,711`) — deliberately, because the tile's `hover:scale-[1.03]` transform
  (`:411`) makes it a containing block and breaks `fixed` descendants.

So draft/reel tiles outrank the intro-card modal BY CONSTRUCTION. Raising the scrim to `/100` would
still leave them on top.

**Fix the stacking, not the opacity.** Requirements:
- The intro-card modal must not be trapped inside another modal's stacking context — portal it to
  `document.body` like `DraftTile` already does, or hoist it out of `ManageProfilesModal`'s subtree.
- Give the app ONE ordered z-index scale in a single place (values are currently scattered ad hoc:
  z-40/50/[60]/[70]/[90] across ~30 components) and place both modals on it. Nested-modal order must
  be expressible, since ManageProfiles → IntroCards → ConfirmationDialog can all be open at once.
- Do NOT solve it by bumping IntroCardsModal to a bigger number in isolation — that just moves the
  collision to `CollectionPlayer` (`z-[70]`) and `LockedReasonModal` (`z-[90]`).
- Verify with the modal open AND a draft tile hovered (the hover state is what portals), at desktop
  and 375px. The scrim change is still fine to keep, but it is not the fix and must not be reported
  as one.

## 2. The card is too small

> The Card should be bigger.

`STAGE_MAX_H = 420`, `STAGE_MAX_W = 480` (`IntroCardStage.jsx:20-21`). The card is the thing being
designed and it currently occupies a minority of a 1024px modal. Give it materially more room —
and note the modal itself may need to grow (`IntroCardsModal.jsx:89`, `max-w-5xl h-[85vh]`).

**Constraint:** T6540 measured scroll density under the real modal box and got it to at-or-below the
pre-redesign baseline. Do not regress that — re-measure and report the same numbers. A bigger card
that pushes every control below the fold is not an improvement.

## 3. Controls are too small to read

> The controls seem too small to, I have a hard time seeing.

The rail leans on `text-xs` / `text-[11px]` throughout. Raise the floor for labels and values to
something comfortably readable, keep 44px coarse-pointer targets, and check it against the style
guide rather than picking sizes ad hoc.

## 4. Changing Style barely changes anything

> Changing Style doesn't currently change much.

Gold / Dark / Photo forward differ mainly in a backdrop that is largely hidden behind a full-bleed
photo, so switching treatment is nearly a no-op on a photo card. The treatment axis is supposed to be
the "how it looks" control (epic decision 2b) — it needs to visibly change the card.

**This is a design question, not just a value tweak.** Consider what a treatment should own: accent
colour on the text, the scrim's strength and shape, an accent rule or band, the photo's tint or
vignette. Whatever is chosen, **it must be expressed in the SHARED contract** (`intro_card_geometry`
+ its JS mirror, parity-tested) so preview and export agree — the treatment colours were centralised
there for exactly this reason. Bring the options to the supervisor with rendered samples before
committing to one.

## 5. BUG — the card renders differently depending on click order

> The card looks different depending on the order I click on the aspect ratio and the "on the card"
> buttons. This speaks to buggy code.

Real and worth root-causing properly. **Reproduce it first** with a deterministic script: apply the
same final state via two different click orders (aspect→facts vs facts→aspect) and diff the rendered
geometry (stage box, photo rect, each slot's computed rect, font sizes). Do not fix anything before
you can show the difference.

Two leads from a supervisor pass — **hypotheses, not conclusions**:
- `IntroCardStage` measures available width with a `ResizeObserver` into `availW` and computes the box
  from `Math.min(STAGE_MAX_W, availW)`. If the observed element's width can ever depend on the box it
  contains, that is a feedback loop that latches at whichever aspect rendered first.
- `RichText` fits text using canvas `measureText`, which its own comments note is APPROXIMATE against
  a custom `@font-face`. Results before vs after webfonts finish loading would differ, which is
  genuinely order/timing dependent rather than state dependent.

It may be neither. Establish the repro, then follow it.

## Relevant files
- `src/frontend/src/components/introcards/IntroCardStage.jsx:20-21` (size caps), `:61-75` (measurement)
- `src/frontend/src/components/introcards/IntroCardsModal.jsx:89` (modal box + backdrop)
- `src/frontend/src/components/introcards/IntroCardRail.jsx` (control sizing)
- `src/backend/app/services/intro_card_geometry.py` + `src/frontend/src/utils/introCardGeometry.js`
  (shared contract — treatments live here)
- `src/frontend/src/components/RichText.jsx` (text fitting)
- `docs/plans/tasks/T6540-critique.md` (the density numbers to not regress)

## Classification hint
M/L-tier, frontend-heavy with a contract touch for item 4. **ui-designer for item 4**; supervisor
approval on the treatment direction before implementing it. Reviewer required. Real-browser
verification at desktop and 375px, inside the REAL modal geometry (the harness must keep matching
`IntroCardsModal`'s box — see T6540, where an unconstrained harness hid a regression).

## Acceptance criteria
- [ ] Nothing behind the modal competes for attention; verified visually at both widths.
- [ ] The card is materially larger, and the T6540 scroll-density numbers are re-measured and NOT worse.
- [ ] Control text meets a readable floor per the style guide; 44px coarse targets preserved.
- [ ] Switching treatment visibly changes the card on a photo card, expressed through the shared
      contract with the parity test extended.
- [ ] The order-dependence bug is REPRODUCED, root-caused and fixed, with a regression test that
      applies the same state via two click orders and asserts identical rendered geometry.
- [ ] Before/after screenshots at desktop and 375px.

# T6600: Draft tiles paint over the intro-card modal — nested stacking contexts and an ad-hoc z-index scale

**Status:** TODO
**Impact:** 7 | **Complexity:** 4
**Split out of:** [T6580](T6580-card-editor-presentation-and-order-bug.md) item 1, 2026-08-05 —
that item stays scoped to the scrim/panel treatment; the layering defect is this task.

## The bug

Draft/reel tiles ("Brilliant Dribble", "Move to My Reels") render **on top of** the Intro cards
modal — over the panel itself, not merely visible through the backdrop. Two user screenshot rounds;
the tell is that the cyan buttons are **crisp and undimmed**, which content behind an 80% scrim
cannot be.

**This was misdiagnosed twice as bleed-through and "fixed" with a heavier scrim** — T6540 went
`/70 → /80`, T6580 went `/80 → /90` + blur. Neither could ever work: the offending elements paint
*above* the scrim, so opacity is not the axis. T6540's PLAN entry explicitly left the question open
(*"resolve whether a reel card seen inside the modal is page bleed-through or a layering bug"*).
It is a layering bug.

## Root cause

Two independent facts combine:

1. **The intro-card modal is trapped in another modal's stacking context.**
   `ManageProfilesModal`'s root is `fixed inset-0 ... z-50` (`ManageProfilesModal.jsx:302`), which
   **establishes a stacking context**. `IntroCardsModal` is rendered as a CHILD of that subtree
   (`ManageProfilesModal.jsx:451`) and sets its own `fixed inset-0 z-50` (`IntroCardsModal.jsx:88`).
   That inner `z-50` is scoped to the parent — the modal's effective root-level ceiling is z-50
   regardless of what number it uses internally.

2. **Draft tiles escape to the root at a higher layer.**
   `DraftTile` portals its overlays **to `document.body`** at `z-[60]` and `z-[70]`
   (`DraftTile.jsx:708,711`). That portal is deliberate and correct: the tile's `hover:scale-[1.03]`
   transform (`:411`) makes it a containing block, which would otherwise break `fixed` descendants.

So draft tiles outrank the intro-card modal **by construction**. `/100` would not change it.

## Scope

- **Get the modal out of the parent's stacking context** — portal `IntroCardsModal` to
  `document.body` (the pattern `DraftTile` already uses) or hoist it out of `ManageProfilesModal`'s
  subtree. Portaling is likely simpler and keeps the open/close logic where it is.
- **One ordered z-index scale, in one module.** Values are ad hoc today — `z-40`, `z-50`, `z-[60]`,
  `z-[70]`, `z-[90]` scattered across ~30 components with no ordering anyone can see. Define the
  layers once (page chrome / drawer / modal / nested modal / fullscreen player / alert) and move
  call sites onto it.
- **Nested modals must be expressible.** `ManageProfiles → IntroCards → ConfirmationDialog` can all
  be open simultaneously; so can `DownloadsPanel → CollectionPlayer` (a comment at
  `DownloadsPanel.jsx:267` already documents a hand-tuned `z-50` vs `z-[70]` relationship — that
  reasoning belongs in the scale, not in a comment).
- **SWEEP, don't point-fix.** Enumerate every z-index in `src/frontend/src` and place each one.
  Report any other pair that can collide — this defect class has now produced three wrong diagnoses,
  which means the ordering is not inspectable by reading the code.

**Explicitly rejected:** bumping `IntroCardsModal` to a bigger number on its own. That just moves
the collision to `CollectionPlayer` (`z-[70]`) and `LockedReasonModal` (`z-[90]`).

**Not in scope:** the scrim/blur/panel-size treatment (T6580 item 1). Keep whatever it lands; this
task is about what paints above what.

## Verification

Real browser, and **with a draft tile HOVERED** — hover is what triggers the portal, so an
unhovered screenshot proves nothing and will falsely pass. This is the failing-open harness class
that cost three verifications on 2026-08-04/05 (see the session handoff § 4).

- Intro cards modal open over a Ready/Drafts row, tile hovered — nothing from the page paints over
  the panel. Desktop and 375px.
- Nested case: ManageProfiles → IntroCards → a confirmation dialog, correct order at every level.
- Regression: `CollectionPlayer` fullscreen still covers `DownloadsPanel`; `LockedReasonModal` still
  covers the player.

## Relevant files
- `src/frontend/src/components/ManageProfilesModal.jsx:302` (parent stacking context), `:451` (mount)
- `src/frontend/src/components/introcards/IntroCardsModal.jsx:88` (trapped `z-50`)
- `src/frontend/src/components/DraftTile.jsx:411` (hover transform), `:708,711` (body portals)
- `src/frontend/src/components/collections/CollectionPlayer.jsx:198,210` (`z-[60]`/`z-[70]`)
- `src/frontend/src/components/collections/LockedReasonModal.jsx:27` (`z-[90]`)
- `src/frontend/src/components/DownloadsPanel.jsx:267-268` (the hand-tuned ordering comment)

## Classification hint
M-tier, frontend only, no schema. Reviewer required. Real-browser verification is the evidence —
jsdom cannot prove a stacking fix (T5380 rule). The scale sweep is mechanical and should be its own
commit, separate from the portal change (moves are mechanical commits).

## Acceptance criteria
- [ ] Nothing on the page paints over the intro-card modal, verified with a draft tile hovered at
      desktop and 375px.
- [ ] `IntroCardsModal` is no longer inside another modal's stacking context.
- [ ] A single ordered z-index scale exists in one module; the ad-hoc values are migrated onto it and
      the ordering is readable without tracing DOM ancestry.
- [ ] Nested modal ordering is correct for ManageProfiles → IntroCards → ConfirmationDialog.
- [ ] No regression to CollectionPlayer / DownloadsPanel / LockedReasonModal ordering.
- [ ] Any other collidable pair found in the sweep is reported (fixed or filed).

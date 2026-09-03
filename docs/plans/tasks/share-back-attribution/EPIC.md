# Share-Back Attribution

**Status:** TODO
**Started:** 2026-09-03
**Impact:** 6 | **Complexity:** 3 (aggregate)

## Goal

Close the gaps found by [T7690's audit](../T7690-share-back-surfaces-audit.md): a working
"make your own reel" viral CTA (`BrandedEndCard`, with UTM tracking) already exists and
fires on the reel and collection share pages, but is missing from surfaces that reach the
exact audience the growth thesis names — another parent on the same team. Every child task
below **reuses** something that already exists; none introduces new mechanism.

## Decision record (2026-09-03)

T7690 delivered a surface inventory + 5 ranked proposals as a decision
artifact (https://claude.ai/code/artifact/3e8c3067-2381-4d61-85c9-990ef69bce4e). User
approved all 5 for implementation, ranked in the order below (impact vs. effort, most
valuable first). No open questions — sequencing within the epic is priority order, not a
hard dependency chain; tasks are independently shippable in any order or in parallel across
different files, but do them in the listed order absent a reason not to.

## Tasks

| ID | Task | Impact | Cmplx | Pri | Status |
|----|------|--------|-------|-----|--------|
| T8410 | [Teammate-tag share page: add the "make your own reel" CTA](T8410-teammate-tag-share-cta.md) | 7 | 2 | 3.5 | TODO |
| T8420 | [Game-link share page: add the same CTA alongside the claim button](T8420-game-link-share-cta.md) | 6 | 2 | 3.0 | TODO |
| T8430 | [Link the header wordmark on the game-link and teammate-tag pages](T8430-share-page-wordmark-link.md) | 3 | 1 | 3.0 | TODO |
| T8440 | [Brand the download filename](T8440-branded-download-filename.md) | 2 | 1 | 2.0 | TODO |
| T8450 | [Unfurl descriptions: add a soft CTA line](T8450-unfurl-description-cta.md) | 4 | 3 | 1.3 | TODO |

## Why this order

Priority = Impact / Complexity, same formula as everywhere else in PLAN.md — it happens to
reproduce T7690's own ranking exactly, which is a good sign the ranking wasn't arbitrary:

1-2 are the real gaps (an existing, proven CTA missing from surfaces that need it) and cost
almost nothing (reuse `BrandedEndCard` as-is). 3-4 are small, safe, zero-copy-decision
fixes. 5 is real but ranked last on purpose — it's the only one of the five with a genuine
way to make things worse (unfurl truncation on mobile could push the useful part of a link
preview, who/what the clip is, off screen in favor of a CTA clause).

## Shared context for every child task

- **The CapCut watermark lesson** (from T7690's problem statement): default attribution
  with goodwill, never hold shared content hostage. All 5 tasks are additive UI/copy only —
  none touches the existing branded-outro mechanism (`src/backend/app/services/branded_outro.py`),
  which already ships this correctly (flag-gated, non-removable today but structured so a
  future paid tier could turn it off).
- **Brand voice**: marcom positioning centers "puts the focus on your athlete" — any new
  copy should read like the existing claim-flow copy ("Sign up to save this game and its N
  team plays, then tag your own athlete"), not a generic upsell.
- **The reusable CTA component**: `src/frontend/src/components/BrandedEndCard.jsx`, already
  consumed by `SharedVideoOverlay.jsx` (reel share) and `SharedCollectionView.jsx` (collection
  share) — see either for the wiring pattern (`visible`/`onReplay` props, shown on video-end).
  T8410 and T8420 both extend its use to a page that doesn't have it yet.
- **No backend changes expected** in any of the 5 tasks — this is share-page/download
  copy and wiring only, all frontend (T8440 is the one backend touch: a filename string).

## Completion Criteria

- [ ] All 5 tasks implemented and merged
- [ ] Each verified live on staging via the actual share link flow (not just unit tests) —
      these are non-user-facing pages by definition, so a Playwright/manual click-through as
      a signed-out visitor is the only way to catch a real regression
- [ ] `.claude/knowledge/annotate.md` or a share-specific knowledge doc updated if any of
      these reveal a landmine worth recording for future share-surface work

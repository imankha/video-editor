# T11280: Reel vocabulary sweep on published, share, legal and landing copy

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Single-Clip Editor](EPIC.md)

## Problem

With Reels gone until T11300, user-visible copy that calls a single published clip a "reel", or
promises multi-clip assembly, is wrong. Internal identifiers stay (renaming internals for UI
consistency is not done here, T7700/T9320 precedent).

## Solution (noun per R2; recommended "highlight")

| Surface | Location |
|---|---|
| Share copy "Highlight Reel", "Check out my ... highlight reel" | `PublishedReelsPanel.jsx:640,679`; `DraftReelPreview.jsx:184`; `GlobalExportIndicator.jsx:48,234` |
| RecapPlayerModal "Reel started / draft reel" | `RecapPlayerModal.jsx:261,501-502` |
| Toasts "new reel", "your reel" | `displayNames.js:528,583`; `FocusCompletionRecovery.jsx:139`; `App.jsx:655`; `AnnotateScreen.jsx:226` |
| Share email "shared a highlight reel", "Watch Reel" | `src/backend/app/services/email.py:766-780` |
| Marketing "make your own reel(s)" (R11) | `BrandedEndCard.jsx:40`; `SharePageInstallBanner.jsx:14` |
| Admin "Reels" phase tier (optional relabel) | `UserDetailPanel.jsx:91-155`; `admin.py:1980-1988` |
| Legal / pricing "exported reels" (review wording) | `PrivacyPolicy.jsx`, `TermsOfService.jsx`, `BuyCreditsModal.jsx:131` |
| Landing (R7): recruiting-reel page claims multi-clip ordering/assembly | `src/landing` `useCases.ts:34-110`; also check `cameras.ts`, `sports.ts`, `index.astro`, `how-it-works.astro` (194 hits / 24 files; keep "highlight reel" SEO phrasing only where it stays true) |

Rules: no em dashes; never claim autonomous framing/tracking; brand "ReelBallers" unchanged.
Landing ships via the separate landing deploy (`/deploy-landing`).

## Related Tasks
- Depends on: R2, R7, R11; coordinate with T11130's vocabulary (highlight-first epic)
- Downstream: T10320 reshoot, T7630 copy re-derivation

## Acceptance Criteria

- [ ] No user-visible "reel" for a single published clip in app copy (grep list in PR)
- [ ] Landing makes no multi-clip assembly claim
- [ ] E2E vocabulary specs (`T9530-library-vocabulary.qa`) updated

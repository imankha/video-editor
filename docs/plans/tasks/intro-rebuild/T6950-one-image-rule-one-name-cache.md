# T6950: One rule for the card image; card-delete must not leave lying badges

**Status:** WAITING ON USER (implemented on feature/T6930-intro-card-bugfixes, awaiting user test + merge approval)
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-12
**Updated:** 2026-08-12
**Epic:** [intro bug fixes](EPIC.md)

## Problem

Two smaller divergences from the 2026-08-12 audit (mechanisms M6 and M5):

1. **Two "which image" rules (M6, latent).** Playback/burn resolve the card image
   **cutout-first**: `intro_egress.py:117` and `:130`
   (`card.get("image_cutout_key") or card.get("image_key")`). But the card API's
   `previewUrl` — what the editor, carousel and picker display — presigns **`image_key`
   only** (`src/backend/app/routers/intro_cards.py:151`), and `MotionPreview` gates on
   `!!card.image_key` (`MotionPreview.jsx:60-61`). If `image_cutout_key` is ever set and
   stale, the editor shows one photo and playback/downloads show another. Today no live
   writer sets it (only the duplicate action copies it, `IntroCardsModal.jsx:74`, and the
   create/patch bodies still accept it, `routers/intro_cards.py:74, 92, 257`) — a loaded
   gun, not yet fired. T5200 (player cut-out) never shipped.
2. **Card delete leaves stale badges (M5).** Three frontend copies carry
   `intro_card_name`: `useDownloads.downloads` (`useDownloads.js:382-403`),
   `useCollections.members` (`useCollections.js:75-105` — never refetched once `ready`),
   and `DownloadsPanel.introBadgesByKey` (`DownloadsPanel.jsx:265-313`). Attach keeps them
   in sync only via the hand-written double-write at `DownloadsPanel.jsx:600-608`. Card
   DELETE nulls `final_videos.intro_card_id` server-side
   (`routers/intro_cards.py:354-358`) but patches NONE of the frontend copies — every
   affected reel keeps showing a badge naming a card that no longer exists or plays.

## Solution

1. **Retire `image_cutout_key` semantics** (smallest honest fix; T5200 can reintroduce
   properly if it ever lands):
   - Backend: stop accepting the field in create/patch (`routers/intro_cards.py:74, 92`,
     `_UPDATABLE_FIELDS:250-262`); change both cutout-first reads in `intro_egress.py`
     (:117, :130) to `card.get("image_key")` only.
   - Frontend: remove the copy in duplicate (`IntroCardsModal.jsx:74`).
   - Leave the COLUMN in place (dead) — dropping it can ride any future profile_db
     migration sweep; not worth its own migration.
2. **Card delete invalidates the caches.** After `introCardStore.deleteCard()` succeeds
   (`introCardStore.js:133-142`), the UI must refresh every copy: trigger
   `useDownloads` refetch AND clear/refetch `useCollections` member cache AND recompute
   `introBadgesByKey`. Implement by having the delete flow call the same refresh gestures
   the panel already owns (grep `fetchDownloads`/`fetchMembers` call sites in
   `DownloadsPanel.jsx`) rather than adding a fourth hand-sync — the pattern to follow is
   "server changed N rows → refetch the lists", not "predict the N rows client-side".

## Context

### Relevant Files (REQUIRED)
- `src/backend/app/routers/intro_cards.py` — create/patch field acceptance (~74, ~92,
  ~250-262); `previewUrl` presign (~151) stays image_key-only (now the single rule)
- `src/backend/app/services/intro_egress.py` — the two cutout-first reads (~117, ~130)
- `src/frontend/src/components/introcards/IntroCardsModal.jsx` — duplicate copies the key
  (~74); delete flow (~144)
- `src/frontend/src/stores/introCardStore.js` — `deleteCard` (~133-142)
- `src/frontend/src/components/DownloadsPanel.jsx` — cache double-write (~600-608), badge
  effect (~265-313); wire delete → refetch
- `src/frontend/src/hooks/useDownloads.js`, `src/frontend/src/hooks/useCollections.js`
- Backend tests: `src/backend/tests/test_t5195_intro_cards.py` (create/patch surface),
  whatever covers delete-cascade (grep `intro_card_id = NULL` in tests)

### Related Tasks
- T5200 (player cut-out) never shipped — if it ever lands it must reintroduce
  `image_cutout_key` semantics across ALL consumers at once, not just egress

### Technical Notes
- Surgical scope: no store refactor, no new abstraction. The double-write at
  `DownloadsPanel.jsx:600-608` stays for the attach path (it's an optimistic update);
  delete uses refetch because the affected-row set is server-side knowledge.
- API change (rejecting `image_cutout_key` in bodies) is backward-safe: nothing live sends
  it; still, return 422 only if pydantic does so naturally — silently ignoring the field
  is acceptable if that's the existing model behavior for unknown fields.

## Implementation

### Steps
1. [ ] Backend: single image rule (image_key everywhere); prune field from create/patch
2. [ ] Frontend: remove duplicate's cutout copy
3. [ ] Frontend: card delete → refetch downloads + collections members + badges
4. [ ] Tests + lint

### Test Plan (relevant set)
- Backend: create/patch no longer persists `image_cutout_key`; egress resolution uses
  `image_key` even when a row has a stale cutout value seeded directly in the fixture
- Frontend unit: deleteCard triggers the refetches (mock the hooks)
- Manual QA: attach card to reel → delete the card from the library → reel tile badge
  disappears WITHOUT a page reload; play shows no intro

## Acceptance Criteria
- [ ] Exactly one image-resolution rule (`image_key`) across editor/preview/burn/playback
- [ ] No write path can set `image_cutout_key`
- [ ] Deleting a card immediately clears every badge/picker preselection that referenced it
- [ ] Relevant tests green; eslint + ruff clean

## Progress Log

**2026-08-12**: Implemented. ONE image rule: image_cutout_key removed from create/patch models, INSERT, _UPDATABLE_FIELDS, _serialize, _card_payload, and both egress reads (image_key only); duplicate no longer copies it; column stays as dead data. Delete cascade: deleteRevision bump in the store; DownloadsPanel effect reconciles the flat list + member caches (new pruneDanglingIntroCards local-only helpers) and re-fires the collection badge batch GET. DEVIATION (reviewer-accepted, rationale in introCardStore.js): local reconciliation against the surviving library instead of the task's refetch - AUTOINCREMENT ids are never reused so the set-difference is exact, vs N refetches for a rare gesture. Known gap left as-is (reviewer OUT OF SCOPE): card delete does not null collection_settings intro ids - dangling ids resolve to no-intro and ids cannot re-bind; row-level cleanup would be a separate task.

# T11110: Rename the 5-star "Brilliant" to "Highlight"

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-09-24
**Updated:** 2026-09-24
**Epic:** [Highlight-First Annotate Flow](EPIC.md)

## Problem

The 5-star rating is the gesture that makes a highlight in the new flow, so its label should say
so. Today it reads "Brilliant" (4 Good, 3 Interesting, 2 Technical Lapse, 1 Mental Lapse stay).

## Solution

Rename the user-facing adjective everywhere it is shown; keep persisted identifiers unchanged.

**Change (user-visible):**
- `src/frontend/src/components/shared/clipConstants.js:9` `RATING_ADJECTIVES[5]`; hardcoded
  "Brilliant play" / "Brilliant team play" in `getRatingCaption` (:88) and `getEditRatingCaption`
  (:109-112). `getEditRatingCaption` also still says "create a clip below", a control that no
  longer exists: fix in the same edit. Drop the unused `BRILLIANT_RATING` (:28, no consumers).
- Consumers pick it up via `getRatingLabel`: `StarRating`, `ClipListItem:128`,
  `ClipRegionLayer:281`, `NotesOverlay:91`, `ClipDetailsEditor:48`, `PlayProgressBadges:280,303`,
  `utils/clipDisplayName.js:45`, `ShareGameModal.jsx:59-61`.
- Backend `src/backend/app/constants.py:100` `RATING_ADJECTIVES` / `get_rating_adjective`
  (drives `queries.derive_clip_name` and `games.py:216` `generate_clip_name`), so new derived
  names read "Highlight Goal". Label only for `SourceType.BRILLIANT_CLIP` (:235 "Brilliant Clip")
  and `constants/sourceTypes.js:16`.

**Do NOT rename (persisted / API identifiers):** `source_type = 'brilliant_clip'`, quest step id
`annotate_brilliant` (`quest_config.py:56`), API field `brilliant_count` (`games.py:1405`),
`auto_export._export_brilliant_clip`. Renaming these needs a migration and buys nothing visible.

**Open (H10):** legacy `projects.name` rows persisted as "Brilliant ..." by
`_create_auto_project_for_clip` (`clips.py:1099`) and migration v019. Recommended: no backfill
(names are user-visible data). If the user rules backfill, add a profile_db migration that only
rewrites names that exactly equal the derived pattern, and include the Migration agent.

**Open (H11):** quest copy that mentions Brilliant (`questDefinitions.jsx`) is updated here.

## Context

### Relevant Files
- `src/frontend/src/components/shared/clipConstants.js`
- `src/frontend/src/constants/sourceTypes.js`
- `src/frontend/src/config/questDefinitions.jsx`
- `src/backend/app/constants.py`
- `scripts/audit_rating_export_correlation.py:35`, `README.md:512` (doc/script labels)

### Tests pinning the word
`src/backend/tests/test_constants.py:40,48`, `test_clip_name_derivation.py` (~12 asserts),
`clipConstants.test.js`, `clipDisplayName.test.js:20`, e2e
`T8490-star-semantics-caption.qa.spec.js:191,257` (`/^5 stars - Brilliant/`).

### Related Tasks
- Independent of T11120-T11140; can land first.

## Acceptance Criteria

- [ ] Red-then-green: a test asserting the 5-star label is "Highlight" fails on master, passes after
- [ ] New derived names read "Highlight ..." (backend test)
- [ ] `grep -ri brilliant src/frontend/src` shows only persisted identifiers, no UI copy
- [ ] Persisted identifiers unchanged; explicit lint clean

# T11110: Rating 5 becomes "Highlight", in gold

**Status:** STAGING (merged PR #503, 739ff784)
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

**Gold (owner ruling 2026-09-24, round 2: "instead of light blue, we should use gold for
highlights"):** `RATING_BADGE_COLORS[5]` / `RATING_BACKGROUND_COLORS[5]` (`clipConstants.js:33-48`,
teal `#17B3A3` today) become the gold picked in the T11100 mockups. **Collision:** rating 2
(Technical Lapse) is Amber Yellow `#F9A825`, indistinguishable from gold at badge size, so it
gets the recolor ruled in H15; keep the 5-color set color-blind distinguishable. These maps feed
the timeline, play list, recap and share surfaces, so check every consumer renders the new pair.
Also drop the "Brilliant" comments in that block (`Excellent` / `Brilliant` notes).

**Do NOT rename (persisted / API identifiers):** `source_type = 'brilliant_clip'`, quest step id
`annotate_brilliant` (`quest_config.py:56`), API field `brilliant_count` (`games.py:1405`),
`auto_export._export_brilliant_clip`. Renaming these needs a migration and buys nothing visible.

**RULED H10 = port (owner 2026-09-24: "port previous brilliants to highlight").** The rating
is an integer, so ratings need nothing. But derived names were persisted (audit 2026-09-24):

| Store | Writer | Action |
|---|---|---|
| `projects.name` | `clips.py:1099-1108` (only when the clip had no stored name; since T10610 new plays are "Play N", so mostly legacy), `materialization.py:934`, `clips.py:2173`; migration v019 | **Migrate** |
| `final_videos.name` | copied from `projects.name` at publish (`publish_final_video.py:233-235,285`), v019 (`:89`), reel move (`downloads.py:1768-1775`). Shows in Published, recap, download filename and MP4 title | **Migrate** |
| `raw_clips.name` from the upload modal auto-fill (`UploadClipModal.jsx:66-73` -> `clips.py:2250-2257`) | looks identical to a typed name | **Leave** (QB1, owner 2026-09-24) |
| Collection names suggested by `GameClipSelectorModal` ("... Brilliants", "Good To Brilliant"), user-accepted | **Leave** (QB1) |
| Postgres `share_videos.video_name` (snapshot at share time, public page title + download name) | postgres track cannot re-derive (inputs live in per-user SQLite) | **Leave** (QB2), consistent with renames not updating snapshots today |

**Migration** (include the Migration agent): a new `profile_db` migration (JIT at the per-user
seam, no admin step), numbered after v019 (v019 imports live `derive_clip_name`, so accounts
still below v019 will already get "Highlight ..." from it). Rewrite only names whose origin is
provable:
- `projects`: `is_auto_created = 1`, the linked `raw_clips.name` empty, and
  `p.name == "Brilliant " + tag_part(rc.tags)` using the exact join logic of
  `queries.py:56-59` -> `"Highlight " + tag_part`. Notes-derived names have no adjective and are
  untouched. A clip whose tags changed after creation is missed (acceptable: can't prove origin).
- `final_videos`: same test through `source_clip_id`, only `source_type='brilliant_clip'`, and
  `fv.name` equal to the old derived name (user renames won't match).
- R2 project archives (`archive/{id}.msgpack`) are not migrated; only re-inserted when a row is
  missing, which is rare.

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
- [ ] Rating 5 renders gold and rating 2 renders the H15 color on every consumer of the color maps
- [ ] `grep -ri brilliant src/frontend/src` shows only persisted identifiers, no UI copy
- [ ] Persisted identifiers unchanged; explicit lint clean

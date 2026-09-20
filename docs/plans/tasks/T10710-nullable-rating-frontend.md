# T10710: Nullable rating — frontend unset badge + stop seeding a default

**Status:** TODO
**Impact:** 5
**Complexity:** 5
**Created:** 2026-09-19
**Updated:** 2026-09-19
**Blocked by:** T10700 (backend migration + compat) — must be merged and verified live on staging first, or create-at-tap 500s on the still-`NOT NULL` column.

## Problem

T10690 (approved design, `docs/plans/tasks/T10690-design.md`) makes `raw_clips.rating` nullable
so the Annotate rated badge can show a genuine "unset" state instead of always reading DONE
(today's T10610 behavior: every play gets a real default rating at creation, so the badge lies
about the user having done anything). T10700 made the backend capable of storing NULL; this task
is the frontend half: stop seeding a default rating at create-at-tap, remove every place that
silently coerces a missing rating back to a number, and give the rated badge a real unset visual.

## Solution

Read `docs/plans/tasks/T10690-design.md` §§ 3.B, 3.C, 3.D, 4, 6 (open questions, already ruled —
see Decisions Locked below) and § E for the full line-numbered plan. This file summarizes it into
an actionable checklist; the design doc is the source of truth for exact pseudocode.

### Decisions locked (from T10690's approved decision artifact — do not re-open)
- **C1 (unset badge visual): Option A.** Reuse `BADGE_STATE.UNDONE`'s existing amber-dashed
  treatment — **no new `BADGE_STATE` member, no new `DISC_STATE` row.** `rated: false` already
  routes there and the disc already renders a hollow star with no notation. The only changes are
  the predicate (real, not hardcoded) and the copy: badge `title` becomes "Not rated yet" instead
  of the generic rate-prompt.
- **C2 (clear rating back to unset): NO.** Do not add a "no rating" row to the picker, do not
  touch `clips.py` (that's T10700's file anyway and it's explicitly unchanged there). Unset is
  reachable only *before* the play's first rating pick, never after.
- **D (unrated derived name):** drop the adjective — `generateClipName(null, tags)` returns
  tag-only text ("Goal and Dribble"), matching T10700's backend `derive_clip_name` change exactly.
- **B11 (TSV round-trip):** **deferred, out of scope for this task.** Keep the existing
  `|| DEFAULT_RATING` in `generateTsvContent`/`validateTsvContent` (`useAnnotate.js:81,156-161`) —
  do not touch TSV import/export in this task. (If picked up later, it's a ~6 LOC follow-up per
  design doc § 3.B row B11.)
- **ShareGameModal:** omit the rating chip entirely for an unrated play (cleanest for the compact
  chip row) rather than rendering an unrated disc there.

### B — Create-at-tap stops seeding a rating, and every coercion between (design doc § 3.B table)
Read the full table — it is exhaustive and line-numbered; deleting both default constants (below)
turns any site you miss into a build error instead of a silently-reintroduced default:
- `AnnotateContainer.jsx:1400` — delete `rating: NEW_PLAY_DEFAULT_RATING,` (omit the field
  entirely); drop the now-unused `NEW_PLAY_DEFAULT_RATING` import at line ~37.
- `useRawClipSave.js:152` — `clipData.rating || 3` → `clipData.rating ?? null`.
- `useAnnotate.js:397` — `addClipRegion(..., rating = DEFAULT_RATING, ...)` → `rating = null`.
- `useAnnotate.js:434` — `rating || DEFAULT_RATING` → `rating ?? null`.
- **`useAnnotate.js:726` (`loadAnnotations`) — THE CRITICAL ONE.** Today:
  `rating: Math.max(1, Math.min(5, annotation.rating || DEFAULT_RATING))`. This re-invents a
  default on every page load and alone would defeat the entire task if missed. Add a small
  module-local `clampRating(r) => r == null ? null : Math.max(1, Math.min(5, r))` and use it here.
- `useAnnotate.js:311` (pending/TSV annotations) — same `clampRating()` helper (used by both = the
  3rd-duplication threshold is satisfied by two plus the explicit intent of exactly one clamp).
- `useAnnotate.js:3, 218, 827` — remove the `NEW_PLAY_DEFAULT_RATING as DEFAULT_RATING`
  import/alias and its dependency-array entries.
- `AnnotateFullscreenOverlay.jsx:52` — delete the **third, file-local** `const DEFAULT_RATING = 4;`
  copy (missed by T10610's own note).
- `AnnotateFullscreenOverlay.jsx:172, 237` — `existingClip.rating || DEFAULT_RATING` →
  `existingClip.rating ?? null` in both (the editor's local echo state must be able to hold null).
- `clipConstants.js:53-58` — delete `NEW_PLAY_DEFAULT_RATING` (zero callers left after the above)
  and `DEFAULT_RATING = 3` (delete once D's three consumers below stop using it — see D table).

**Rating-driven branches — verified already safe with `null`, no change needed:** the 5-star clip
nudge (`playProgress.js:92`), the quest step (`questAchievements.js:9` — add a one-line comment so
nobody "fixes" it), auto-export's brilliant selection, Glicko seeding for single-clip reels. There
is no rating-driven `my_athlete`/auto-project-creation branch (verified non-existent).

### C — The badge (design doc § 3.C)
`playProgress.js`:
```js
rated: rating != null,   // != is deliberate: covers null AND undefined
```
Replace the header comment's `RATED` bullet with the **full rule history** (T10520 rejected /
T10610 rejected / T10690 why) — this file has changed the rule three times in four days; write it
so a fourth change doesn't have to re-derive the reasoning from git log. Full text in design doc
§ 3.C.1.

`PlayProgressBadges.jsx` (C1-A, no new state): the `RatingBadge`'s `title` when `state !==
BADGE_STATE.DONE` changes from the current generic rate-prompt to "Not rated yet" — add a header
comment explaining that unset deliberately reuses `UNDONE`'s look (don't let a future pass "fix"
this into its own state without re-reading why). No change to `RATING_VALUES`/the picker rows —
`aria-checked={rating === value}` is already false for every row when `rating` is `null`, so the
picker already opens with nothing selected.

### D — Every other rating-display call site (design doc § 3.D has the full table)
The null branch lands in the **shared primitives**, not in each call site (N35's "one rating
descriptor function" invariant):
- `clipConstants.js` `getRatingLabel` — `if (rating == null) return 'Not rated';` then existing
  body. This is the one string every surface shows for an unrated clip.
- `clipConstants.js` `getRatingDisplay` — null → `{ notation: '', badgeColor: <new neutral
  constant>, backgroundColor: <new neutral constant> }`. Add two new slate/neutral color constants
  next to the existing rating palettes (e.g. `#64748b` / `rgba(100,116,139,0.15)`).
- `clipConstants.js` `getRatingCaption`/`getEditRatingCaption` — already correct (`if (!rating)`);
  comment update only (the no-rating branch is now a real reachable state, not just a create-form
  transient).
- `RATING_NOTATION`/`RATING_ADJECTIVES`/`RATING_BADGE_COLORS`/`RATING_BACKGROUND_COLORS` —
  **unchanged**, stay 1-5 maps, no null/0 key.
- `src/frontend/src/utils/clipDisplayName.js:37` `generateClipName` — mirror T10700's backend
  `derive_clip_name` exactly: `if (rating == null) return tagPart;` before applying the adjective.
- `RatingIcon.jsx:58-91` — currently `RATING_NOTATION[rating] ? rating : DEFAULT_RATING`, which
  draws a blue `!?` disc for anything falsy. Change to: `rating == null` → render a **dedicated
  unrated disc** (dashed neutral ring, transparent face, no glyph, `data-rating="unrated"`,
  `<span className="sr-only">Not rated</span>`). One definition, inherited by every consumer below.
- `ClipListItem.jsx:80` — drop `region.rating || 3` → `region.rating ?? null`. Primary surface
  where unrated plays actually show up in the list.
- `ClipRegionLayer.jsx:219-222, 274-277` — drop `region.rating || 3`; take the marker color from
  `getRatingDisplay(rating).badgeColor` instead of indexing the local `RATING_COLORS` map a second
  time.
- `NotesOverlay.jsx:29-30` — notation guard already correct; only its border-color fallback
  (currently `RATING_COLORS[3]`, reads as "Interesting"/blue) changes to the new neutral constant.
- `ClipDetailsEditor.jsx`'s local `StarRating` and shared `components/shared/StarRating.jsx` (used
  by `AnnotateFullscreenOverlay`'s landscape-inline layout) — both already route their label
  through `getRatingLabel`, so "Not rated" comes for free; verify the fill comparison
  (`i <= rating`) renders zero filled stars when `rating` is `null`. No structural change.
- `ClipSelectorSidebar.jsx:208-209` (Focus mode) — **no change**, already `clip.rating != null`.
- `ShareGameModal.jsx:55-61` — add a branch: skip the rating chip entirely when `c.rating == null`
  (locked decision above).
- `RecapPlayerModal.jsx`, `recap/RecapClipsSidebar.jsx` — audit during implementation; both render
  through the shared primitives, so D covers them if they don't pre-coerce. Any stray `|| 3` found
  gets the same treatment as the B table.
- **Out of scope (Glicko, not stars) — do not touch:** `rank.py`/`glicko.py` equivalents on the
  frontend (`useRanking`, `reelOrder`, `useCollections`, `PublishedReelsPanel`), `final_videos.rating`.

## Context

### Relevant Files
- `src/frontend/src/containers/AnnotateContainer.jsx` — create-at-tap payload (~1400), import (~37)
- `src/frontend/src/hooks/useRawClipSave.js` — `saveClip` payload (~152)
- `src/frontend/src/modes/annotate/hooks/useAnnotate.js` — `loadAnnotations` (~726, **the critical
  site**), `addClipRegion` (~397), (~434), TSV gen (~81, unchanged this task), imports/deps (~3, 218, 311, 827)
- `src/frontend/src/modes/annotate/playProgress.js` — `getPlayProgress`, `BADGE_STATE` (no new member), `CLIP_NUDGE_RATING` (unchanged)
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` — `RatingBadge` title/copy
- `src/frontend/src/modes/annotate/components/AnnotateFullscreenOverlay.jsx` — third `DEFAULT_RATING` copy (~52), local echo state (~172, 237)
- `src/frontend/src/components/shared/clipConstants.js` — `NEW_PLAY_DEFAULT_RATING`/`DEFAULT_RATING` (delete both), `getRatingLabel`, `getRatingDisplay`, `getRatingCaption`/`getEditRatingCaption` (comment only)
- `src/frontend/src/utils/clipDisplayName.js` — `generateClipName` (~37)
- `src/frontend/src/modes/annotate/components/RatingIcon.jsx` (~58-91) — unrated disc
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx` (~80), `ClipRegionLayer.jsx` (~219-222, 274-277), `NotesOverlay.jsx` (~29-30)
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx`, `src/frontend/src/components/shared/StarRating.jsx`
- `src/frontend/src/modes/annotate/components/ClipSelectorSidebar.jsx` (no change, reference only)
- `src/frontend/src/components/ShareGameModal.jsx` (~55-61)
- `src/frontend/src/modes/annotate/components/RecapPlayerModal.jsx`, `recap/RecapClipsSidebar.jsx` — audit only

### Related Tasks
- Design: T10690 (DECIDED). Backend: T10700 (must be live on staging first).

### Technical Notes
- Every coercion this task removes is a place a missing rating was silently turned back into a
  number. The mitigation against missing one is structural: delete both `NEW_PLAY_DEFAULT_RATING`
  and `DEFAULT_RATING` so a site you forget becomes a build error (undefined reference), not a
  silently-reintroduced 3 or 4. Grep gate before calling this done: `rg "rating \|\| " src/frontend/src`
  should return nothing outside Glicko-namespace files.
- Gesture-based persistence still applies throughout — nothing here adds a new write path; every
  site either stops defaulting a value already being written on an existing gesture, or reads a
  value for display.

## Implementation

### Steps
1. [ ] Confirm T10700 is merged AND verified live on staging (real dev-login round trip) before starting
2. [ ] Load `.claude/knowledge/annotate.md` (rating entries)
3. [ ] Tester Phase 1: failing tests per design doc § E (`playProgress.test.js`, `AnnotateContainer.createAtTap.test.jsx`, `AnnotateFullscreenOverlay.progressBadges.test.jsx`, `clipConstants.test.js`, `useAnnotate.test.js` — the `loadAnnotations` null-preservation regression guard is the one that matters most)
4. [ ] Implement B (stop seeding + remove coercions), C (badge predicate + comment + copy), D (display sites)
5. [ ] Run the grep gate (`rg "rating \|\| " src/frontend/src`), resolve any hit
6. [ ] Reviewer pass
7. [ ] Targeted tests green (curated set per B/C/D, not the whole suite) + one e2e: Mark play → rated badge is not green → pick a rating → turns green
8. [ ] Update `.claude/knowledge/annotate.md` (T10520/T10610/T10690 rating rule history, delete the `DEFAULT_RATING`/`NEW_PLAY_DEFAULT_RATING` landmine note now that both are gone) and `persistence-sync.md` (note v054 as the first profile_db table rebuild)
9. [ ] Status -> STAGING

### Progress Log

**2026-09-19**: Filed from the approved T10690 design, blocked by T10700. Not started.

## Acceptance Criteria

- [ ] A freshly Marked play's rated badge shows the amber "undone" treatment ("Not rated yet"), not green, until the user picks a rating
- [ ] Picking a rating turns the badge DONE with the correct notation glyph, same as today
- [ ] `loadAnnotations` (`useAnnotate.js:726`) preserves a `null` rating across a page reload — regression-tested explicitly
- [ ] No `|| DEFAULT_RATING` / `|| NEW_PLAY_DEFAULT_RATING` coercion remains anywhere in `src/frontend/src` (grep gate)
- [ ] `ClipListItem`, `ClipRegionLayer`, `NotesOverlay`, `ShareGameModal` all render an unrated play without inventing a rating
- [ ] `generateClipName(null, tags)` matches T10700's backend `derive_clip_name(None, tags)` exactly (no adjective)
- [ ] Targeted unit tests + the one e2e pass; knowledge docs updated

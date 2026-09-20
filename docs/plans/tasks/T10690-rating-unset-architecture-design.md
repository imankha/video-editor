# T10690: Architect design — true "unset" rating state (nullable raw_clips.rating)

**Status:** DECIDED
**Impact:** 5
**Complexity:** 6
**Created:** 2026-09-19
**Updated:** 2026-09-19

## Problem

On the Annotate play editor, the rated badge (`PlayProgressBadges.jsx`'s `RatingBadge`) shows
green/DONE unconditionally for every play. That's deliberate, and it's fresh: T10610 (merged
today, 2026-09-19, PR #470) moved to a "create-at-tap" model — Mark Play immediately creates the
`raw_clips` row with a real rating, seeded from `NEW_PLAY_DEFAULT_RATING = 4`
(`clipConstants.js:58`) — so `playProgress.js`'s `getPlayProgress()` now hardcodes `rated: true`
with a comment explaining a saved play always carries a genuine 1-5 value. That itself replaced
an even earlier rule (T10520) that read an untouched default-4 as unrated, which the user
rejected after live-testing it: "green doesn't mean not 4, it just means it's been set."

The user saw a screenshot of the current (T10610) behavior and asked why the badge shows
complete before they've touched it. Told this conflicts with today's T10610 decision and given
the alternatives (a session-only "touched" flag — reintroducing what T10610 just removed — vs. a
true null rating requiring a schema change), the user's ruling was **true null rating**: a play
can genuinely have no rating on record; `raw_clips.rating` becomes nullable; nothing seeds a
default at creation; the badge gets a real "unset" visual, distinct from the amber `UNDONE` state
the other three badges use (theirs means "you haven't done this yet" on a value that already
defaults to something; this one means "no rating exists in the data at all").

## Solution (what this task produces)

`docs/plans/tasks/T10690-design.md` per [2-architecture.md](../../../.claude/workflows/2-architecture.md):
current state, target state, implementation plan (file-by-file, function-by-function), risks —
plus a decision artifact for the user (the design gate). Design only; no source edits. Must
answer, concretely:

### A. Schema change
- `raw_clips.rating` (`database.py:1182`, `profile_db` track, `PRAGMA user_version`) goes from
  `INTEGER NOT NULL` to nullable. New migration file
  `src/backend/app/migrations/profile_db/v{NNN}_nullable_rating.py` — SQLite can't `ALTER COLUMN
  DROP NOT NULL` in place, so the design must specify the rebuild-table-and-copy sequence (see
  existing `profile_db` migrations for the established pattern) and confirm existing rows (all
  currently 1-5, never NULL) copy across unchanged. No backfill needed since NULL is a NEW valid
  state, not a correction of bad data — say so explicitly, this is not the "correct data via
  migration" case, it's a widened domain.
- `RawClipCreate.rating` (`clips.py:135`, currently `int`) and every other typed `rating: int` /
  `rating: int | None` field on the six-plus request models in `clips.py` — decide which ones
  legitimately need to accept "no rating" (create-at-tap: yes; bulk import at line 2152 which
  already defaults to 5 when absent; video-upload create at line 2200 which defaults to 3) vs.
  which should keep requiring a value.
- `normalize_rating()` (`app/queries.py`, imported at `clips.py:35`) currently coerces
  out-of-range values — decide its contract for `None` (pass through vs. reject) and audit every
  caller (lines ~1090, ~1752 in `clips.py` plus any others `queries.py` itself calls).
- `derive_clip_name()` (`queries.py`) reads `rating` to help generate a name (`RATING_NOTATION`/
  `RATING_ADJECTIVES` lookups) — decide what an unrated clip's generated name/notation looks like
  (a real gap in the lookup tables, not just "missing key falls back to DEFAULT_RATING" — that
  fallback is display-only today per `clipConstants.js:120,131` and would silently un-blank an
  intentionally-unset rating everywhere the display fallback is used).

### B. Create-at-tap no longer seeds a default
- `AnnotateContainer.jsx:1400` sends `rating: NEW_PLAY_DEFAULT_RATING` on
  `handleFullscreenCreateClip` — decide whether it now sends `rating: null` explicitly or omits
  the field, and whether `NEW_PLAY_DEFAULT_RATING` is deleted outright (it would have no more
  callers) or kept for another surface (check the bulk-import/video-upload defaults above before
  deleting — they are separate constants already, `5` and `3` literal, not this one).
- The 5-star clip-nudge path (`CLIP_NUDGE_RATING = 5` in `playProgress.js`) and any other
  rating-driven branch (auto `my_athlete` flip, etc. — see `annotate.md` T9830 entries on
  rating-driven auto-flip sites) must handle `rating == null` as "not nudging," not crash or
  coerce to a number.

### C. The "unset" badge treatment
- `PlayProgressBadges.jsx`'s `RatingBadge`: a fourth visual state alongside `UNDONE`/`DONE` (the
  existing `BADGE_STATE` enum in `playProgress.js`) or a distinct new one — decide which, and
  whether it reuses `DISC_STATE`'s dashed-amber `UNDONE` look (same visual, different meaning) or
  needs its own treatment so it doesn't read as "this is a checkbox you haven't ticked" the way
  the other three badges do. `Disc`'s `glyph` prop currently only renders `RATING_NOTATION[rating]`
  when `DONE` — decide what (if anything) renders in the unset state's disc.
- `getPlayProgress()`'s `rated` field goes from the current hardcoded `true` back to a real
  predicate: `rating != null`. Update the comment block (lines 8-15) to state the new rule the
  same way it stated the old one — this file's own history (three rule changes in four days) is a
  landmine for the next person; write the comment so the NEXT change doesn't have to re-derive
  the reasoning from git log.
- The rating picker (`RATING_VALUES` rows in `RatingBadge`) — does it gain a "clear rating" /
  "no rating" option, or is unset only reachable by never having rated (no way back to unset once
  set)? Get an explicit ruling in the decision artifact; don't assume.

### D. Every other rating display site
`clipConstants.js`'s `getRatingLabel`/`getRatingCaption`/`getEditRatingCaption`/`RATING_NOTATION`/
`RATING_COLORS_*` all currently assume 1-5. `ClipListItem.jsx`, `ClipSelectorSidebar.jsx`,
`ClipRegionLayer` timeline markers, `NotesOverlay.jsx`'s in-video text overlay, and the sidebar's
own `StarRating` (per `annotate.md`'s N35 invariant — ONE rating descriptor function, don't
reintroduce a duplicate) all render a rating somewhere. List every call site that needs an
explicit `rating == null` branch vs. ones that can never see one (e.g. anything reading an
existing pre-migration clip, which always has 1-5).

## Context

### Relevant Files (read; this task writes only the design doc)
- `src/backend/app/database.py:1178-1200` — `raw_clips` schema (`ensure_database`, `profile_db` track)
- `src/backend/app/migrations/profile_db/` — existing migration files, for the SQLite rebuild-and-copy pattern to follow
- `src/backend/app/routers/clips.py` — `RawClipCreate`/`RawClipUpdate`/related models (~135-240), `create_raw_clip` (~1360), `update_raw_clip` (~1490-1505), bulk import (~2146-2165), video-upload create (~2200-2250), every `derive_clip_name`/`normalize_rating` call site listed above
- `src/backend/app/queries.py` — `derive_clip_name`, `normalize_rating`
- `src/frontend/src/components/shared/clipConstants.js` — `NEW_PLAY_DEFAULT_RATING`, `DEFAULT_RATING`, `RATING_NOTATION`, `RATING_ADJECTIVES`, `RATING_COLORS_*`, `getRatingLabel`/`getRatingCaption`/`getEditRatingCaption`
- `src/frontend/src/modes/annotate/playProgress.js` — `getPlayProgress`, `BADGE_STATE`, `CLIP_NUDGE_RATING`
- `src/frontend/src/modes/annotate/components/PlayProgressBadges.jsx` — `RatingBadge`, `Disc`, `DISC_STATE`
- `src/frontend/src/containers/AnnotateContainer.jsx:1400` — create-at-tap payload
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx` — sidebar's own local `StarRating` (separate component, per `annotate.md` T9630 entry)
- `src/frontend/src/modes/annotate/components/ClipListItem.jsx`, `ClipSelectorSidebar.jsx`, `ClipRegionLayer` (timeline markers), `NotesOverlay.jsx` — other rating display sites

### Knowledge docs
- `.claude/knowledge/annotate.md` — search `rating` (T9630, T10520, T10590, T10610 entries; the N35 "one rating descriptor function" invariant; the `DEFAULT_RATING`/`NEW_PLAY_DEFAULT_RATING` landmine note)
- `.claude/references/coding-standards.md` § "Correct data, not workarounds" — this change widens a domain rather than fixing bad data; the design doc should say so explicitly rather than framing it as a correction
- Migration System section of root `CLAUDE.md` — `profile_db` track mechanics (JIT migration at the per-user/per-profile seam, `PRAGMA user_version`, floor mechanism currently inert)

### Related Tasks
- Reopens part of T10610 (merged 2026-09-19) and its predecessor T10520 — read both for the
  rejected alternatives before re-proposing either
- Will block a follow-up implementation task (file it once this design is approved; needs the
  Migration agent for the `profile_db` migration file)

### Technical Notes
- This is explicitly NOT the "no silent fallbacks / correct data via migration" pattern from
  CLAUDE.md — no data is wrong today (every existing rating is a real 1-5). This migration widens
  what's a valid value, it doesn't fix a corruption. Say this in the design doc so a future reader
  doesn't confuse it with a data-integrity migration.
- Gesture-based persistence still applies: if the picker gains a "clear rating" action, that's a
  gesture (a tap) calling the same `onRatingChange`-shaped setter with `null`, not a reactive
  effect.
- Keep the amber `UNDONE` styling question honest in the artifact — reusing it for "unset" is
  cheaper but may mislead the user into tapping it expecting the same "one-time checklist" meaning
  the other three badges have. Surface this as a real design decision, not a default.

## Implementation

### Steps
1. [x] Load `.claude/knowledge/annotate.md` (rating-related entries) + `persistence-sync.md`'s
   migration section, then read the files listed above (no broader audit)
2. [x] Spawn the `architect` agent with this file; it writes `docs/plans/tasks/T10690-design.md`
3. [x] Build the decision artifact (schema diff, call-site table, badge-state mock, the
   reachable-vs-not "clear rating" question) and hand it to the user
4. [x] Status -> WAITING ON USER; on approval -> DECIDED, and the implementation task may be filed

### Progress Log

**2026-09-19**: Filed from a screenshot-driven UI question about the rated badge, after
surfacing the conflict with T10610 (merged same day) and getting the user's explicit ruling
(true null rating over a session-only touched-flag). Not started.

**2026-09-19 (architect):** `docs/plans/tasks/T10690-design.md` written. Decision artifact:
https://claude.ai/artifact/2zgMz83fZa7cAA3NE1tF8g (source `docs/plans/tasks/T10690-decision-artifact.html`).
Migration target `v054_raw_clips_rating_nullable.py` (v053 is current head — recheck unmerged
siblings before implementing). Found beyond the task file's own ask: (1) SQLite's rebuild-and-copy
for `DROP NOT NULL` runs with `foreign_keys=ON` in two existing openers
(`database.py:1753`, `materialization.py:63`) and would **cascade-delete** `working_clips`/
`modal_tasks`/`clip_teammates` rows via `DROP TABLE raw_clips` — migration must force
`PRAGMA foreign_keys=OFF` itself; (2) `DROP TABLE` also resets `sqlite_sequence`, so ids get
reused, and `final_videos.source_clip_id` (T3630) holds frozen ids with no FK — capture/restore
`seq` and reindex; (3) `RawClipResponse.rating` MUST become `int | None` or every clip list on an
unrated row 500s; (4) `normalize_rating`/`UNRATED_RATING` get deleted (their contract is the
repealed rule), 3 callers each need an explicit treatment, notably `games.py:1355` which today
would silently badge an unrated play as 3 stars; (5) a THIRD file-local `DEFAULT_RATING = 4` at
`AnnotateFullscreenOverlay.jsx:52` and a re-invented 4 in `useAnnotate.js:726`'s `loadAnnotations`
— either one alone would defeat the whole task if missed; (6) `projects.py:715`'s
`COALESCE(rc.rating,0) >= 1` would make unrated plays invisible in multi-clip clip pickers.
Bulk-import (`or 5`) and video-upload-form (`Form(3)`) defaults are kept as-is (no unrated
affordance on those flows), which confines NULL to annotate-created plays. `CLIP_NUDGE_RATING`,
the quest step, auto-export and Glicko seeding verified already null-safe; no rating-driven
`my_athlete` auto-flip exists. Open questions posed in the artifact for the user's ruling (not
silently picked): (1) unset badge visual — recommends reusing `UNDONE`'s amber dashed look with
"Not rated yet" copy, flagging honestly that gray was already ruled out (T10440) and the "other
badges default to something" framing doesn't fully hold; (2) whether a rating is clearable back
to unset once set (recommends NO for v1 — YES requires `clips.py:1499`'s `if update.rating is not
None` to become a `model_fields_set` check, ~10 LOC, fully specced either way); (3) whether an
unrated derived clip name drops its adjective; (4) whether a TSV export round-trip fix (~6 LOC)
ships with this or is deferred; (5) whether `ShareGameModal` omits its rating chip for unrated
plays. Suggested split once approved: backend/compat PR first, frontend PR second (shipping
frontend first would 500 every Mark-play tap). Status -> WAITING ON USER.

**2026-09-19: APPROVED by the user ("spec approved, proceed").** Went with the artifact's
recommended option on each open question, EXCEPT #4 which the artifact left with no
recommendation — deferred as the more conservative default (kept explicit as a call made without
a user signal, flagged back to the user in the handoff):
1. Unset badge = option A, reuse `UNDONE`'s amber dashed look, copy "Not rated yet". No new
   `BADGE_STATE` member.
2. No "clear rating" action in v1 — unset is reachable only pre-first-rating.
3. Unrated derived name drops the adjective ("Goal and Dribble", not "Interesting Goal and Dribble").
4. TSV round-trip fix DEFERRED (kept an explicit `|| 3` in the TSV writer only) — flag to the user
   as a call made without an explicit recommendation in the artifact; can be pulled into scope on
   request.
5. `ShareGameModal` omits its rating chip entirely for an unrated play.

Status -> DECIDED. Filed implementation as two tasks (backend/compat first, frontend second,
matching the artifact's ship-order risk mitigation): T10700, T10710.

## Acceptance Criteria

- [ ] `docs/plans/tasks/T10690-design.md` exists and answers A-D above with named functions/files, not prose
- [ ] Every `rating: int` call site in `clips.py` is enumerated with a explicit nullable-or-not decision
- [ ] The "unset" badge's visual is specified concretely (not "reuse UNDONE" left implicit)
- [ ] Whether a rating can be cleared back to unset after being set is an explicit ruling, not an assumption
- [ ] User approved the decision artifact

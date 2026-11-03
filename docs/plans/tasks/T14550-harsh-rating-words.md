# T14550: Harsh rating words in play names and captions

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Low ratings use coach jargon that reads harsh for a parent tagging their own kid, and the
words leak into names other families see:

- Backend default play names are built from the rating word: `constants.py:102-108`
  (`2: 'Skill miss'`, `1: 'Decision miss'`) via `derive_clip_name` in `queries.py` give names
  like "Skill miss Goal" and "Decision miss Dribble and Assist". Those names show on game share
  pages (`src/frontend/functions/shared/game/[token].js` clip rail) and in collections and emails.
- Frontend rating captions: "Mental lapse - a play to learn from." / "Technical lapse - a play
  to learn from." and the "Skill miss" / "Decision miss" labels (`src/frontend/src/components/shared/clipConstants.js` ~14-15, 112-113, 134-135).
- The 5-star rating label is "Highlight", a sixth meaning of that word.

## Solution (user decision D6, 2026-11-03)

- 1 star: **"Needs work: decision"**; 2 stars: **"Needs work: skill"**. 5 stars: **"Brilliant"**.
- Rating words are **never** used in default play names. Default names use only the tags
  (e.g. "Goal") or a time ("Play at 12:30") when there are no tags.
- Positive words (Brilliant, Good) may stay out of names too, for one rule; implementer's call,
  note it in the PR.

## Context

### Relevant Files
- `src/backend/app/constants.py`, `src/backend/app/queries.py` (`derive_clip_name`)
- `src/frontend/src/components/shared/clipConstants.js`
- Any frontend copy of the name derivation (grep `Skill miss`, `Decision miss`, `Mental lapse`)
- Tests asserting derived names

### Technical Notes
- **Check first whether derived names are persisted** (stored in `raw_clips.name` or similar) or
  computed on read. If computed on read, the fix is code-only. If persisted, existing rows
  keep the old names: the fix then needs a `profile_db` migration that rewrites ONLY names that
  still equal the old auto-derived value (never a name the user typed). Ask the user before
  adding a migration.
- See [copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md) for the glossary.

## Implementation

1. [ ] Determine persisted vs derived; record the answer in this file
2. [ ] Failing tests: a 1-star play with tag Dribble is not named "Decision miss Dribble"; captions use "Needs work"
3. [ ] Change labels, captions and name derivation (backend and any frontend twin)
4. [ ] If persisted: stop and confirm the migration with the user
5. [ ] Relevant tests + lint

## Acceptance Criteria

- [ ] No default play name contains a rating word
- [ ] 1 and 2 star labels read "Needs work: decision" / "Needs work: skill"; 5 stars reads "Brilliant"
- [ ] Share pages show the new names for new plays
- [ ] Tests pass

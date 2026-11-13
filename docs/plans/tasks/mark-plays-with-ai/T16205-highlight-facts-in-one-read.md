# T16205: Highlight facts in one read

## In plain words

A highlight is a finished short clip of an athlete, made from a play (a marked moment in a game). What we know about a highlight is scattered today: its tags and comparison-game standing sit on the highlight, its note and star rating sit on the play it was made from, the AI's description of the play sits with the play's AI detail, and the athlete's position and graduation year sit on the profile. The AI reel builder planned after the reel builder will need all of it at once, as text, for every highlight an athlete has. This task builds that one read on the server and proves the chain behind it: a play marked by the AI, assigned to the parent's athlete and turned into a highlight, still carries what the AI said it demonstrates. Building it now, inside this epic, means any gap in what the analysis stores is found while it is cheap to fix, before games have been analysed and stored. Done when one call returns every fact below for a test athlete and the chain is proven end to end.

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Tier:** M (one read-only service and endpoint; no stored-data change)
**Created:** 2026-11-13
**Updated:** 2026-11-13

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 8 of 8. It serves the [AI reel builder](../ai-reel-builder/EPIC.md).

## Problem

The reel model reads text only, so it is only as good as the facts we can hand it. If those facts can only be gathered by several separate lookups, or some are lost on the way from the game analysis to the finished highlight, the reel builder will be built on gaps that cost a new analysis of every stored game to close.

## Solution

One read-only server call, for one athlete profile, that returns:

- **The athlete:** name, sport, position, graduation year, team.
- **Each finished highlight:** its name, length, shape (portrait or landscape), the date it was made, and the game it came from with the date and opponent when known.
- **What it shows:** the tags, the star rating and the note from its play. When the play came from the AI and a player in it was marked as the parent's athlete: that player's qualities (what the play demonstrates, from the sport's fixed list), the sentence saying so, whether it is impressive for social media and why, the coaching note, and the decision and execution scores. Each entry says plainly whether the highlight is Brilliant for scouting, for social media, or both, and whether its play was a learning opportunity (rated Needs work), because the owner ruled on 2026-11-13 that learning opportunities are never considered for a reel.
- **How it ranks:** its standing in the comparison game (the "which is better?" game), how many comparisons it has been in, and how settled that standing is.
- **Where the facts came from:** AI analysis, a play marked by hand, or a clip uploaded directly, so the reader knows how much to trust a thin entry.

A highlight with no AI detail returns the same shape with those parts empty. Nothing is copied or stored by this task; it reads what is already there.

## Why this and not something else

Copying the AI's description onto the highlight when it is made was considered. It would survive the play being deleted, but it creates a second copy that goes stale when the parent edits the play's note or changes which player is theirs. Reading through the link from highlight to play keeps one copy of each fact. A highlight whose play was deleted returns only what the highlight itself holds.

Leaving this read to the AI reel builder epic was ruled out by the owner on 2026-11-13: the data work belongs here so the two epics are one design.

## How we will know it worked

- [ ] One call for a profile returns the athlete's details and one entry for every finished highlight, with every field above present or explicitly empty.
- [ ] End-to-end test: a play imported from an analysis, marked as the athlete's from a player chip, and made into a highlight returns that player's qualities, sentence, note and scores, and not another player's.
- [ ] A highlight from a hand-marked play and one from a directly uploaded clip each return tags, rating and note with the AI parts empty and the source named.
- [ ] A highlight whose play was deleted is still returned, with what the highlight itself holds.
- [ ] The answer for an athlete with fifty highlights is plain text under twenty thousand tokens, and the call reads no video and makes no model call.
- [ ] Only the profile's owner and an admin can make the call.

## For the implementer

### Relevant Files (REQUIRED)
- `src/backend/app/services/highlight_facts.py` (new: one function, one joined query on the profile database, pure mapping with table-driven tests)
- `src/backend/app/routers/analysis.py` or `routers/collections.py`: `GET /api/highlights/facts`
- `src/backend/app/database.py` (read only: `final_videos` to `projects.source_raw_clip_id` to `raw_clips` to `games`)
- `src/backend/app/services/user_db.py` (profile fields: position, class, team)
- `.claude/knowledge/backend-services.md`

### Technical Notes
- Join path: `final_videos.project_id` to `projects.source_raw_clip_id` to `raw_clips` (`notes`, `rating`, `tags`, `ai_source`), then `games`. `final_videos` carries `tags`, `rating`, `rd`, `match_count`, `quality_score`, `duration`, `aspect_ratio`.
- The athlete's mention is the entry in `raw_clips.ai_source.mentions` whose `assigned` marks the athlete (written by T16200). If the play is in My athlete and no mention is marked, return the play-level facts only; do not guess a mention.
- Published highlights only; drafts are excluded.
- The athlete's profile fields live in the per-user database, the rest in the profile database: two reads on the server, one answer to the caller.
- No write path, no migration.

### Related Tasks
- Depends on: T16190 (`ai_source` with qualities and sentence), T16200 (which mention is the athlete). Blocks: T16330, T15890.

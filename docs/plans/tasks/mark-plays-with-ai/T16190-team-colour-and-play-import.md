# T16190: Team colour and play import

## In plain words

When an analysis finishes it holds every play (a marked moment) for both teams, named only by kit colour, because the same result serves parents on either side. Nothing is in the parent's game yet. We will ask the parent one question, which colour their team wears, and then bring in only the plays the model rated as strong for that team, a few dozen for a full game. They arrive on the Team line (the app's lane for plays that are not specifically the parent's own child) with tags, a short note and a star rating already filled in, and a small AI mark until the parent touches them. Bringing in everything would bury the parent in routine passes, and the owner asked for high relevance only. Done when a parent picks a colour and sees that team's strong plays on the Team line with tags, note and rating, can switch team without paying again, and can remove the AI plays they have not touched.

**Status:** WAITING ON USER (design review: https://claude.ai/artifact/AfoPPibjtfSS3HKx5ktoh9)
**Impact:** 9
**Complexity:** 6
**Tier:** L (per-profile schema change, new import path, Annotate surfaces; Migration agent)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 7 of 8.

## Problem

The stored analysis is team-neutral and lives outside the parent's data. The app's play record has no notion of which team is the parent's, no place for the model's per-player detail, and no way to tell an untouched AI play from one the parent made or corrected.

## Solution

Build sections 5 ("Pick your team colour") and 6 ("What arrives in Annotate") of [UX-FEEDBACK.md](UX-FEEDBACK.md).

1. **Choose.** Two large choices showing the two kit colours from the analysis. The choice is saved on the parent's game.
2. **Import.** Every play whose relevance for the chosen team is at or above the threshold (4 of 5; set by T16140) becomes a real play on the Team line:
   - **Start and end** from the analysis, on the right video of a multi-video game.
   - **Tags**: every tag the model gave to players of the chosen team in that play, without repeats.
   - **Rating** (proposal, checked in T16140): 1 "Needs work: decision" if any of the team's players has a decision score of 2 or lower; otherwise 2 "Needs work: skill" if any has an execution score of 2 or lower; otherwise 5 "Brilliant" if relevance is 5 and all scores are 4 or higher; otherwise 4 "Good" if the average score is 3.5 or higher; otherwise 3 "Interesting".
   - **Note**: the play's one-sentence summary, then the players' notes, cut to the 280-character limit. The full text stays in the play's AI detail.
   - **AI detail**: the model's player mentions for the chosen team (position, jersey number when read, tags, scores, note), kept with the play for the tagging screen (T16200).
3. **Do no harm.** A play the parent already marked wins: an AI play overlapping it by half or more is not imported. Importing twice adds nothing. Imported plays do not start any automatic highlight creation or any charge.
4. **Summary.** "46 plays added to the Team line", then the call to action into tagging (T16200).
5. **Switch team.** Free. Removes the old team's untouched AI plays and imports the other team's. Plays the parent edited, tagged or moved stay.
6. **Undo.** "Remove AI plays I have not touched."
7. **Sharing.** No change: Team-line plays are shared as they are today, with tags, note and rating.
8. **Measure.** `ai_team_chosen` and `ai_plays_imported` with the count.

## Why this and not something else

Putting AI plays in the existing suggestions list (the Veo import's rate-to-keep list) was considered. It keeps the play list clean but makes the parent accept dozens of plays one by one before they can do anything, and plays in that list cannot be shared. The owner asked for annotations to be imported with tags, notes and rating filled in and for the parent's effort to go into naming players, so they arrive as real plays. Landing them on the My player line was ruled out because the model does not know which player is the parent's child.

## For the implementer

### Schema (profile_db migration; Migration agent confirms)

| Table | Column | Type | Value |
|---|---|---|---|
| `games` | `ai_analysis_id` | INTEGER NULL | `game_analyses.id` of the purchased analysis (first video; per-video ids in `game_videos` if the Architect prefers) |
| `games` | `ai_team_key` | TEXT NULL | `team_0` or `team_1`; NULL until chosen |
| `games` | `ai_team_color` | TEXT NULL | the colour string shown to the parent |
| `raw_clips` | `ai_source` | BLOB NULL (msgpack, like `tags`) | `{analysis_id, play_index, team_key, relevance, touched, mentions:[{position, jersey_number, tags, decision_score, execution_score, note, assigned}]}`; NULL for plays the parent made |

Import inserts through the existing clip save path with `my_athlete=0` and empty `tagged_teammates`. `touched` flips to true on any edit gesture on that play (rating, tags, notes, range, lane, teammate tags). Copies made by sharing drop `ai_source` (materialization copies named columns only; confirm).

### Relevant Files (REQUIRED)
- `src/backend/app/routers/analysis.py`: `POST /api/games/{id}/analysis/import` (body: team key), `DELETE /api/games/{id}/analysis/plays?untouched=1`
- `src/backend/app/services/analysis_import.py` (new: threshold, mapping, overlap rule; pure functions with table-driven tests)
- `src/backend/app/routers/clips.py` (`save_raw_clip`, update path sets `touched`), `app/database.py` (`ensure_database` schema), `app/migrations/profile_db/v{next}_ai_plays.py`
- `src/backend/app/services/auto_export.py` and anything keyed on rating 5 or `auto_project_id`: prove bulk import triggers nothing
- `src/frontend/src/components/analysis/TeamColourChooser.jsx` (new), `ImportSummary.jsx` (new)
- `src/frontend/src/modes/annotate/components/AnnotateTimeline.jsx`, `ClipRegionLayer.jsx`, `ClipsSidePanel.jsx` (AI mark), `hooks/useAnnotateSuggestions.js` as the pattern for mirroring new plays into the list
- `.claude/knowledge/annotate.md` (new section)

### Technical Notes
- The play's natural key is (game_id, end_time, video_sequence); use it with `ai_source.play_index` to make import idempotent.
- Tag names from the analysis are the stored names (`Save`, shown as "Keeper Save"); they must pass the same validation as hand-entered tags.
- The import is one gesture (choosing the team) and one server call that writes all plays; the frontend never loops per play.
- Recap, watch and counts treat AI plays as ordinary Team-line plays. Check the coach guide's play-count rules do not congratulate the parent on 46 plays they did not mark.
- Threshold and rating rule are constants in `analysis_import.py`, with T16140's note cited.

### Related Tasks
- Depends on: T16150 (stored result), T16160 (purchase), T16170 (the ready state leads here). Blocks: T16200.

## Acceptance Criteria

- [ ] A ready analysis shows the two kit colours; nothing is imported before a choice.
- [ ] After choosing, only plays at or above the threshold for that team are on the Team line, each with tags, a note of at most 280 characters and a rating that follows the rule (table-driven test).
- [ ] No imported play is on the My player line.
- [ ] A hand-marked play overlapping an AI play by half or more is kept and the AI play is not imported.
- [ ] Importing twice adds no plays.
- [ ] Switching team charges nothing, replaces untouched AI plays, and keeps plays the parent touched.
- [ ] "Remove AI plays I have not touched" removes exactly those.
- [ ] Editing an AI play removes its AI mark.
- [ ] Importing 60 plays, several rated 5, creates no highlight project and no credit charge.
- [ ] A shared game delivers imported Team-line plays to the recipient with tags, note and rating.
- [ ] `ai_team_chosen` and `ai_plays_imported` appear in the admin Journey inspector.

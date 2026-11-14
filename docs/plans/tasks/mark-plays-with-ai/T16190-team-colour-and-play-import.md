# T16190: Team colour and play import

## In plain words

When an analysis finishes it holds every play (a marked moment) for both teams, named only by kit colour, because the same result serves parents on either side. Nothing is in the parent's game yet. We will ask the parent one question, which colour their team wears, and then bring in only the plays the model rated as strong for that team, a few dozen for a full game. They arrive on the Team lane (the app's lane for plays that are not specifically the parent's own child) with tags, a short note and a star rating already filled in, and a small AI mark until the parent touches them. Bringing in everything would bury the parent in routine passes, and the owner asked for high relevance only. Done when a parent picks a colour and sees that team's strong plays on the Team lane with tags, note and rating, can switch team without paying again, can flip a single play the model gave to the wrong team, and can remove the AI plays they have not touched.

**Status:** TODO
**Impact:** 9
**Complexity:** 6
**Tier:** L (per-profile schema change, new import path, Annotate surfaces; Migration agent)
**Created:** 2026-11-12
**Updated:** 2026-11-13

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 6 of 7.

## Problem

The stored analysis is team-neutral and lives outside the parent's data. The app's play record has no notion of which team is the parent's, no place for the model's per-player detail, and no way to tell an untouched AI play from one the parent made or corrected.

## Solution

Build sections 5 ("Pick your team colour") and 6 ("What arrives in Annotate") of [UX-FEEDBACK.md](UX-FEEDBACK.md).

1. **Choose.** Two large choices showing the two kit colours from the analysis. The choice is saved on the parent's game. This happens after the analysis, which always covers both teams; asking before it and analysing one team was tested and ruled out (see T16150).
2. **Import.** Every play whose relevance for the chosen team is at or above the threshold (4 of 5) becomes a real play on the Team lane:
   - **Start and end** from the analysis, on the right video of a multi-video game.
   - **Tags**: every tag the model gave to players of the chosen team in that play, without repeats.
   - **Two ways to be Brilliant** (owner, 2026-11-13). A play is scoutable when a player of the chosen team demonstrates at least one quality (something a college coach looks for, from the sport's fixed list) with decision and execution scores of 4 or higher. A play is social-worthy when the model marked a player of the chosen team's action as impressive for social media. The bar for both kinds (owner, 2026-11-13, ruling on T16320) is that the player did better than a good player at that level would be expected to do; a learning opportunity is never Brilliant. A play that is either, or both, is always imported and is rated 5 "Brilliant", whatever else happened in it. Both count equally. The rule below rates every other play, and no other play is rated 5.
   - **The note says which kind.** A scoutable play's note opens with "Scouts:" and the sentence saying what it demonstrates; a social-worthy play's note opens with "Social:" and the sentence saying why it impresses; a play that is both carries both, scouting first. The stored AI detail records the kind as well, so a recruiting reel can draw on scoutable plays and a social post on the impressive ones without reading the note.
   - **Rating** for a play that is not Brilliant: 1 "Needs work: decision" if any of the team's players has a decision score of 2 or lower; otherwise 2 "Needs work: skill" if any has an execution score of 2 or lower; otherwise 4 "Good" if the average score is 3.5 or higher; otherwise 3 "Interesting".
   - **Note**: the play's one-sentence summary, then for each player what the action demonstrates and the player's note, cut to the 280-character limit. What is demonstrated comes before the lesson, so it survives the cut. The full text stays in the play's AI detail.
   - **AI detail**: the model's player mentions for the chosen team (position, jersey number when read, tags, qualities, the sentence saying what the action shows, scores, note), kept with the play for the tagging screen (T16200) and for the AI reel builder's one read of highlight facts (T16205).
3. **Do no harm.** A play the parent already marked wins: an AI play overlapping it by half or more is not imported. Importing twice adds nothing. Imported plays do not start any automatic highlight creation or any charge.
4. **Summary.** "46 plays added to the Team lane", then the call to action into tagging (T16200).
   The parent can change any of these afterwards with the play editor, exactly as for a play they marked themselves.
5. **Switch team.** Free, because the stored result already holds both teams and no new analysis runs. Removes the old team's untouched AI plays and imports the other team's. Plays the parent edited, tagged or moved stay.
6. **Wrong team on one play flips it** (owner, 2026-11-13). The model sometimes mixes the teams up on a play: it writes one team's actions under the other team's colour. The stored result holds two sections for every play, one for each team, so when that happens the truth about the parent's team is sitting in the other section. Each AI play carries a "Wrong team" button. One tap keeps the play, with the same start and end, and rebuilds its tags, rating, note and player chips from the other team's section, using the same rules as the import. Tapping again flips it back. This usually turns a highlight into a lesson or a lesson into a highlight, because a play that is good for one team is bad for the other: a Brilliant run credited to the wrong side becomes the beaten defender's lesson, and a "your defender was beaten" play that was really the parent's own winger becomes the Brilliant run. Removing the play instead was considered and dropped by the owner: it does nothing a delete does not already do, and it throws away the half of the play that is about the parent's team. The flip is remembered for that play: adding the AI plays again or switching team keeps it flipped, relative to whichever team is chosen. Each flip is counted, so we can see how often the model mixes the teams on real games. The stored analysis is not changed, because other parents share it. Two limits, stated on screen where they apply: the play's one-sentence name was written once for both teams and may still name the wrong colour, and when the other section holds no players the flipped play keeps only its start, end and name.
7. **Undo.** "Remove AI plays I have not touched."
8. **Sharing.** No change: Team-lane plays are shared as they are today, with tags, note and rating.
9. **Measure.** `ai_team_chosen`, `ai_plays_imported` with the count, and `ai_play_team_flipped` for each play flipped (and again when it is flipped back).

## Why this and not something else

Putting AI plays in the existing suggestions list (the Veo import's rate-to-keep list) was considered. It keeps the play list clean but makes the parent accept dozens of plays one by one before they can do anything, and plays in that list cannot be shared. The owner asked for annotations to be imported with tags, notes and rating filled in and for the parent's effort to go into naming players, so they arrive as real plays. Landing them on the My athlete lane was ruled out because the model does not know which player is the parent's child.

## For the implementer

### Schema (profile_db migration; Migration agent confirms)

| Table | Column | Type | Value |
|---|---|---|---|
| `games` | `ai_analysis_id` | INTEGER NULL | `game_analyses.id` of the purchased analysis (first video; per-video ids in `game_videos` if the Architect prefers) |
| `games` | `ai_team_key` | TEXT NULL | `team_0` or `team_1`; NULL until chosen |
| `games` | `ai_team_color` | TEXT NULL | the colour string shown to the parent |
| `games` | `ai_flipped_plays` | BLOB NULL (msgpack list) | play indexes the parent flipped with "Wrong team"; for these the import reads the opposite slot from the chosen team |
| `raw_clips` | `ai_source` | BLOB NULL (msgpack, like `tags`) | `{analysis_id, play_index, team_key, flipped, relevance, touched, brilliant_for:["scouting","social"], mentions:[{position, jersey_number, tags, qualities, shows, social, social_reason, decision_score, execution_score, note, assigned}]}`; NULL for plays the parent made |

Import inserts through the existing clip save path with `my_athlete=0` and empty `tagged_teammates`. `touched` flips to true on any edit gesture on that play (rating, tags, notes, range, lane, teammate tags). Copies made by sharing drop `ai_source` (materialization copies named columns only; confirm).

### Relevant Files (REQUIRED)
- `src/backend/app/routers/analysis.py`: `POST /api/games/{id}/analysis/import` (body: team key), `DELETE /api/games/{id}/analysis/plays?untouched=1`, `POST /api/games/{id}/analysis/plays/{clip_id}/flip-team` (the same call flips back)
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
- Recap, watch and counts treat AI plays as ordinary Team-lane plays. Check the coach guide's play-count rules do not congratulate the parent on 46 plays they did not mark.
- Teams are matched by slot (`team_0`, `team_1`), never by comparing colour text; the colour name shown is the one stored on the analysis.
- The prototype saw the model credit a play to the wrong team and report goals that did not happen (T16150 records how often on a full game). The AI mark, the play editor, "Wrong team" on a single play (which flips it) and "Remove AI plays I have not touched" are the parent's remedy; do not add automatic highlight creation or congratulation on AI plays.
- "Wrong team" is one gesture and one server call. It rebuilds the play from the opposite slot through the same pure mapping the import uses (tags, Brilliant rule, rating rule, note, mentions), writes `ai_source.team_key` and `flipped`, and adds or removes the play index in `games.ai_flipped_plays`, all in one write. Start, end and name are not changed. The relevance threshold does not apply to a flipped play: the parent asked for it, so it stays whatever the other slot's relevance is. If the parent had already edited tags, rating or note, the flip replaces them; the button's confirm line says so in that case only. A flip does not clear the AI mark, because the new content has not been checked either. The import consults `ai_flipped_plays`: a play in the list is always imported and reads the slot opposite the chosen team, so a whole-game switch followed by a re-import leaves it flipped. The list is per parent and never written back to the shared analysis. Every play in the stored result has both `team_0` and `team_1` sections (required by the schema in `gemini_analysis_test/prompts.py`), so the other section always exists; it may have an empty `players` list.
- Threshold and rating rule are named constants in `analysis_import.py`, so they can be tuned once real games have been through.

### Related Tasks
- Depends on: T16150 (stored result), T16160 (purchase), T16170 (the ready state leads here). Blocks: T16200.

## Acceptance Criteria

- [ ] A ready analysis shows the two kit colours; nothing is imported before a choice.
- [ ] After choosing, only plays at or above the threshold for that team, and every Brilliant play, are on the Team lane, each with tags, a note of at most 280 characters and a rating that follows the rule (table-driven test).
- [ ] Each imported play's AI detail keeps every player's qualities and sentence exactly as the analysis stored them, and the note states what is demonstrated before any lesson (table-driven test).
- [ ] Every scoutable play and every social-worthy play for the chosen team is imported and rated Brilliant; no other play is rated Brilliant (table-driven test).
- [ ] Each Brilliant play's note opens with "Scouts:", "Social:", or both, matching its kind, and the stored detail records the same kind (table-driven test covering scoutable only, social only, and both).
- [ ] On the staging game the number of Brilliant plays for each team, split into scoutable, social-worthy and both, is recorded and the owner has seen it before the feature is switched on, so a rating that lands on nearly every play is caught.
- [ ] No imported play is on the My athlete lane.
- [ ] A hand-marked play overlapping an AI play by half or more is kept and the AI play is not imported.
- [ ] Importing twice adds no plays.
- [ ] Switching team charges nothing, replaces untouched AI plays, and keeps plays the parent touched.
- [ ] "Wrong team" on an AI play keeps its start, end and name and replaces its tags, rating, note and player chips with what the import rules produce from the other team's section (table-driven test: Brilliant becomes a lesson, a lesson becomes Brilliant, other section empty).
- [ ] Tapping "Wrong team" a second time returns the play to exactly what it was.
- [ ] A flipped play stays flipped when the AI plays are added again and when the team is switched and switched back.
- [ ] Flipping a play in one account changes nothing for a second account that imports the same stored analysis.
- [ ] "Remove AI plays I have not touched" removes exactly those.
- [ ] Editing an AI play removes its AI mark.
- [ ] Importing 60 plays, several rated 5, creates no highlight project and no credit charge.
- [ ] A shared game delivers imported Team-lane plays to the recipient with tags, note and rating.
- [ ] `ai_team_chosen`, `ai_plays_imported` and `ai_play_team_flipped` appear in the admin Journey inspector.

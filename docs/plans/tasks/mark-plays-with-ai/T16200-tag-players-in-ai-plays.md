# T16200: Tag players in AI plays

## In plain words

After the import, a parent has a few dozen plays (marked moments) on the Team line, each describing what the right winger or the left centre-back did, but none saying who that is. The model reads a jersey number in almost no play from a sideline camera, so it cannot know which player is the parent's child; only the parent can. We will give them a fast tagging screen: one play at a time, the clip looping, and each player the model mentioned shown as a chip with their position and what they did. One tap on a chip says "this is my player", which moves the play to the My player line, or names a teammate. The app remembers that the right winger was Maya and offers it first on the next play, without ever applying it on its own. Done when a parent can work through 40 plays on a phone in a few minutes and their child's plays end up on the My player line, ready to become highlights.

**Status:** WAITING ON USER (design review: https://claude.ai/artifact/AfoPPibjtfSS3HKx5ktoh9)
**Impact:** 8
**Complexity:** 5
**Tier:** L (new Annotate surface, phone and desktop; UI design in UX-FEEDBACK.md)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 8 of 8.

## Problem

Parents come for their own child's highlights. An import that leaves every play on the Team line has done the scrubbing but not the finding, and the only tool today is opening each play's editor and flipping a My player / Team switch, which is slow and shows none of the model's player detail. The owner asked for the effort to sit with the parent and for the screen that takes it to be a good one.

## Solution

Build section 7, "Tag players", of [UX-FEEDBACK.md](UX-FEEDBACK.md).

1. **Chips on every AI play.** In the play editor and the play list, each player mention is a chip: position, jersey number when the model read one, and that player's tags. Tapping a chip opens the two choices below.
2. **"This is [athlete]."** Moves the play to the My player line. The play's tags, rating and note narrow to that player's own (their tags, a rating from their scores by T16190's rule, their note), since the play is now about them.
3. **Name a teammate.** Adds the name to the play's teammate tags, with names already used in this game offered first. The play stays on the Team line.
4. **Memory within the game.** Once "right winger" has been given a name, that name is the first suggestion on later chips with the same position. It is a suggestion only; positions change during a game.
5. **The tagging pass.** Opened from the import summary and from a "Tag players" action on the game: one play at a time, looping clip, chips, large thumb targets, next and previous, skip, a real count ("12 of 46 plays"), and a filter for plays that might be the parent's child once at least one position has been tagged as theirs. A done state says how many plays are now on the My player line and leads to making a highlight.
6. **Measure.** `ai_play_tagged` (with kind: my player or teammate) and `ai_tag_pass_finished`, so the Journey shows whether imported plays turn into a child's plays.

## Why this and not something else

Asking the parent to tap their child in the video and tracking them through the game is the Player Moments epic, which is prototype-gated and months away. Asking for a roster with jersey numbers was ruled out because the model reads almost no numbers. Auto-assigning by position was ruled out because players switch positions and a wrong assignment the parent did not make is worse than none.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/components/analysis/PlayerMentionChips.jsx` (new), `TagPlayersPass.jsx` (new), tests for both
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx`, `AnnotateFullscreenOverlay` (chips in the editor), `ClipsSidePanel.jsx`
- `LayerSegmentedControl.jsx` and `components/shared/TeammateTagInput.jsx` (existing gestures to reuse)
- `src/backend/app/routers/clips.py` (update path: persist `ai_source.mentions[].assigned`)
- `src/frontend/src/components/instructions/displayNames.js`, `resolveGuide.js`, `.claude/knowledge/guidance.md` (a coach rule that points at "Tag players" after an import)
- `.claude/knowledge/annotate.md`

### Technical Notes
- Existing rule (T5725): switching a play to My player clears its teammate tags. Keep it. The pass therefore asks "is one of these your player?" first and offers teammate names only on plays that stay on the Team line.
- Each tap is one surgical write: `{my_athlete: true, tagged_teammates: [], tags, rating, notes}` for "this is my player", or the teammate tags alone for a name. No effect-driven saves, no saving the whole play list.
- Position memory is derived from the game's plays (`ai_source.mentions[].assigned`), not stored separately.
- Plays shared in from another parent are locked to the Team line today; chips on them offer teammate names only.
- Phone first: 44 px targets, the clip and the chips visible together at 390 px without scrolling; desktop shows the play list beside the clip.
- The looping clip reuses the Annotate player and its playback of a play's range; no second video element.

### Related Tasks
- Depends on: T16190 (`ai_source` and imported plays).

## Acceptance Criteria

- [ ] An imported play shows one chip per player mention with position, number when present, and tags.
- [ ] "This is [athlete]" moves the play to the My player line and sets its tags, rating and note to that player's.
- [ ] Naming a teammate adds the name to the play and keeps it on the Team line; the name is offered first on the next chip with the same position.
- [ ] No play changes lane or gains a name without a tap on that play.
- [ ] The pass shows a true count, allows skip, next and previous, and ends with the number of plays now on the My player line.
- [ ] The filter for plays that might be the parent's child appears only after one position has been tagged as theirs.
- [ ] Usable at 390 px with every target at least 44 px; desktop layout matches the sketch in UX-FEEDBACK.md.
- [ ] Each tap produces exactly one write containing only the changed fields.
- [ ] `ai_play_tagged` and `ai_tag_pass_finished` appear in the admin Journey inspector.

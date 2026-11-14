# T16200: Tag players in AI plays

## In plain words

After the import, a parent has a few dozen plays (marked moments) in the Team lane, each describing what the right winger or player 10 did, but none saying who that is. The model reads a jersey number in almost no play from a sideline camera, so only the parent knows which player is their child and who the teammates are. We will give them a fast tagging screen: one play at a time, the clip looping, and each player the model mentioned shown as a chip. One tap on a chip either moves the play to My athlete, using the switch the app already has, or tags a teammate by name and email address exactly as the app does today, which gives that family the game and its Team plays. Nothing about moving, editing or sharing a play changes; this task only puts those existing actions one tap from each chip. Done when a parent can work through 40 plays on a phone in a few minutes, their child's plays are under My athlete, and a teammate tagged from a chip receives the game as they would today.

**Status:** TODO
**Impact:** 8
**Complexity:** 5
**Tier:** L (new Annotate surface, phone and desktop; UI design in UX-FEEDBACK.md)
**Created:** 2026-11-12
**Updated:** 2026-11-12

Epic: [mark-plays-with-ai/EPIC.md](EPIC.md). Epic task 7 of 7.

## Problem

Parents come for their own child's highlights. An import that leaves every play in the Team lane has done the scrubbing but not the finding. The tools to finish the job exist: a switch in the play editor that moves a play between My athlete and Team, and teammate tagging that takes a name and an email address and shares the game with that family. But they sit inside each play's editor, away from the model's description of who did what, so using them on 40 plays is slow.

## Solution

Build section 7, "Tag players", of [UX-FEEDBACK.md](UX-FEEDBACK.md), as corrected by the owner rulings in its section 9.

1. **Chips on every AI play.** In the play editor, the play list and the tagging pass, each player mention is a chip: position ("Right winger"), or the jersey number when the model read one ("Player 10"), and that player's tags. The player's coaching note and scores are shown with the chip's choices.
2. **"This is [athlete]."** The existing switch: the play moves to My athlete. The play keeps the tags, rating and note it arrived with; the parent edits them in the play editor if they want to, as for any play. The existing rule stays: the athlete's own plays carry no teammate names, and the button says so when names would be removed, with Undo.
3. **Tag a teammate.** The existing teammate tagging, opened from the chip: the parent enters the player's name, with names already used in this game offered first, and the email address is collected and the game shared by the existing step. The tagged family gets the game and its Team plays as today. This task does not change who receives what, when emails are sent, or how a tagged name is stored.
4. **A suggestion, never an answer.** Once "Right winger" has been given a name in this game, that name is offered first on later chips with the same position or number. The parent taps to accept and can always change it. It lasts for this game only.
5. **The tagging pass.** Opened from the import summary and from a "Tag players" action on the game: one play at a time, looping clip, chips, large thumb targets, next and previous, skip, a real count ("12 of 46 plays"), and a filter for plays that might be the parent's child once at least one position has been answered as theirs. A done state says how many plays are now under My athlete and how many have teammates tagged, and leads to making a highlight.
6. **Measure.** `ai_play_tagged` (kind: my athlete or teammate) and `ai_tag_pass_finished`, so the Journey shows whether imported plays turn into a child's plays and into shared games.

## Why this and not something else

Asking the parent to tap their child in the video and tracking them through the game is the Player Moments epic, which is prototype-gated and months away. Asking for a roster with jersey numbers was ruled out because the model reads almost no numbers. Assigning by position automatically was ruled out because players switch positions and a wrong assignment the parent did not make is worse than none. Narrowing a play's tags and note to one player when it moves to My athlete was considered and ruled out by the owner on 2026-11-12: moving and editing a play stay exactly as they are.

## For the implementer

### Relevant Files (REQUIRED)
- `src/frontend/src/components/analysis/PlayerMentionChips.jsx` (new), `TagPlayersPass.jsx` (new), tests for both
- `src/frontend/src/modes/annotate/components/ClipDetailsEditor.jsx`, `AnnotateFullscreenOverlay` (chips in the editor), `ClipsSidePanel.jsx`
- `LayerSegmentedControl.jsx` (the My athlete / Team switch; reuse its gesture)
- `src/frontend/src/components/shared/TeammateTagInput.jsx` (name entry and suggestions) and `src/frontend/src/components/ShareWithTeammatesModal.jsx` (email per tagged name, `GET /api/clips/teammate-emails`, sharing): reuse both as they are; read them and `src/backend/app/services/materialization.py` before designing, and do not fork them
- `src/frontend/src/containers/AnnotateContainer.jsx` (where the share flow is opened today)
- `src/backend/app/routers/clips.py` (update path: persist `ai_source.mentions[].assigned`)
- `src/frontend/src/config/displayNames.js` (copy; lane labels `LAYER_MINE` and `LAYER_TEAM` are used as they are, no new lane names), `resolveGuide.js`, `.claude/knowledge/guidance.md` (a coach rule that points at "Tag players" after an import)
- `.claude/knowledge/annotate.md`

### Technical Notes
- No change to sharing. The acceptance test is that a teammate tagged from a chip ends in the same stored state, and triggers the same share, as one tagged from the play editor today. If the existing flow collects the email in a later step than the name, the chip follows that order; it may shorten the path to that step but not replace it.
- Existing rule (T5725): switching a play to My athlete clears its teammate tags. Keep it. The pass therefore asks "is one of these your athlete?" first and offers teammate tagging on plays that stay in the Team lane.
- Each tap is one surgical write, the same one the existing control sends: `{my_athlete: true, tagged_teammates: []}` for "This is [athlete]", or the teammate tags alone for a name. No effect-driven saves, no saving the whole play list.
- "This is [athlete]" from a chip also marks that one mention as the athlete's (`ai_source.mentions[].assigned`), in the same write. The AI reel builder's read of highlight facts (T16205) uses this mark to take the right player's qualities and note, so a play moved to My athlete with the plain switch, without a chip, has no marked mention and that is correct.
- Position memory is derived from this game's plays (`ai_source.mentions[].assigned`), not stored separately.
- Plays shared in from another parent are locked to the Team lane today; chips on them offer teammate tagging only.
- Phone first: 44 px targets, the clip and the chips visible together at 390 px without scrolling; desktop shows the chips beside the clip.
- The looping clip reuses the Annotate player and its playback of a play's range; no second video element.

### Related Tasks
- Depends on: T16190 (`ai_source` and imported plays).

## Acceptance Criteria

- [ ] An imported play shows one chip per player mention with position, or "Player N" when a number was read, and that player's tags.
- [ ] "This is [athlete]" moves the play to My athlete with the same write the existing switch sends; the play's tags, rating and note are unchanged.
- [ ] After "This is [athlete]" on a chip, exactly that player's mention is stored as the athlete's, and Undo clears it.
- [ ] Tagging a teammate from a chip takes a name and an email address through the existing flow, and the tagged account receives the game and its Team plays exactly as when tagged from the play editor.
- [ ] A name given to a position is offered first on the next chip with that position in the same game, and is never applied without a tap.
- [ ] No play changes lane or gains a name without a tap on that play.
- [ ] The pass shows a true count, allows skip, next and previous, and ends with the number of plays under My athlete and the number with teammates tagged.
- [ ] The filter for plays that might be the parent's child appears only after one position has been answered as theirs.
- [ ] Usable at 390 px with every target at least 44 px; desktop layout matches the sketch in UX-FEEDBACK.md.
- [ ] Each tap produces exactly one write containing only the changed fields.
- [ ] `ai_play_tagged` and `ai_tag_pass_finished` appear in the admin Journey inspector.

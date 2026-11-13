# T16320: Recruiting reel research

## In plain words

A reel is several highlights (finished short clips of an athlete) joined into one video for a college coach. Today everything we plan for reels rests on guesses: what a coach wants to see, what goes on the title card, how long a reel should be. Three pieces of planned work depend on the answers: the AI that marks plays in a game has to write down what each play demonstrates, the reel builder has to know what its cards should hold, and the AI reel builder has to know how a good reel is put together. This task does the research once, from what college coaches and recruiting services publish and from reels that worked, and writes down the answers with their sources. It builds no screens and no code. Done when the owner has read the findings, the list of qualities a soccer play can demonstrate is fixed, and each open question below has an answer or is marked as genuinely disputed.

**Status:** WAITING ON USER
**Impact:** 8
**Complexity:** 3
**Tier:** M (research and documents only; no application code)
**Created:** 2026-11-13
**Updated:** 2026-11-13

Epic: [ai-reel-builder/EPIC.md](EPIC.md). Epic task 1 of 3. Runs before Mark plays with AI: the game analysis engine (T16150) cannot start until the quality list exists.

## Problem

The owner asked on 2026-11-13 for an AI reel builder that understands what coaches would like to see, and for research into successful reels: their best practices and the things that vary between them. Nobody has collected this. Without it the analysis prompt would invent its own words for what a play shows, the title card and end card would be designed by taste, and the reel model would have no expert knowledge to run with.

## What we will do

Research, then write three things.

**1. Findings, with sources.** One document that answers:

- What do college coaches say they look for in a reel, and what makes them stop watching?
- How long should a reel be, and how many highlights?
- What goes first? Is it always the best highlights first, or grouped by skill?
- Is it always best to show the graduation year? Where and when?
- How should position be shown? One position, or several when an athlete plays more than one?
- What belongs on the title card, and how long should it stay up?
- What makes a good end card?
- Where does contact information go: start, end, both, or only in the message that carries the link? Whose contact details: the athlete's, a parent's, the club coach's?
- How is the athlete pointed out in each highlight, and does every highlight need it?
- Landscape or portrait, music or game sound, slow motion or not?
- What else varies between good reels? List each such choice with its usual values, so the reel builder can offer it or decide it.
- Which of these answers differ by sport, and which are the same for all eleven sports the app supports?

For each answer, say how strong the evidence is: agreed by many sources, said by a few, or disputed.

**2. The quality list for soccer.** A quality is what a play shows about the athlete, such as pace, vision or composure under pressure; a tag is what happened, such as Goal or Tackle. The list is fixed, short enough for a model to choose from reliably (about twelve to twenty), covers every position including goalkeeper, uses the words coaches use, and each entry has a one-line meaning. It also marks which qualities apply to any sport and which are soccer's own, so later sports reuse the general ones.

Each quality also gets its signs: what a person watching a sideline video would actually see when a player demonstrates it at a level a college coach cares about, and what a routine version looks like that does not count. The owner asked on 2026-11-13 for the game analysis to be worked backwards from what coaches look for, so that the plays it marks as highlights are the scoutable ones. These signs are what the analysis is told to look for (T16150), so they must describe things visible in the footage, in a sentence or two each.

**2b. What impresses on social media.** The owner ruled on 2026-11-13 that a play is Brilliant when it is scoutable or when it is impressive for social media, and the second kind needs its own description. Research which youth sports clips are watched and shared most on Instagram, TikTok and YouTube Shorts, and write the visible signs of a social-worthy moment the same way: what makes a stranger stop and watch, with examples for soccer and a note on what holds for any sport. Say where the two kinds differ, for example a composed pass out of pressure that a coach values and a stranger scrolls past.

**3. Recommendations to the tasks that depend on it.** A short list, one line each: what the title card should hold (T15880), what the cards and their default lengths should be (T16300), and what the reel model must be told (T16330). These are proposals for the owner to accept or change, not changes to those tasks.

## Why this and not something else

Letting the model rely on its own general knowledge was ruled out by the owner: the expert is built from research at build time so that it can be read and corrected. Researching every sport in depth now was ruled out because only soccer is switched on for game analysis; the general findings cover all sports and each other sport gets its own short block later (T16330).

## How we will know it worked

- [ ] The findings document answers every question above, each with at least two sources and an evidence strength.
- [x] At least fifteen real recruiting reels were looked at, across at least three positions, and what they do is tabulated: length, number of highlights, title card contents, where contact details appear, how the athlete is pointed out.
- [x] The soccer quality list is written with a meaning for each entry and is marked general or soccer-only.
- [x] The signs of a social-worthy moment are written with at least two sources and soccer examples.
- [ ] Every quality has its visible signs and a routine example that does not count, and the owner, watching five plays from a real game, can say from the signs alone which qualities each one shows.
- [x] The owner has read the findings and ruled on the recommendations; the rulings are recorded in this file under `## Ruling`.
- [ ] The quality list is stored with the sport, beside its tags, where both the app and the server can read it.

## Progress

**2026-11-13: research done, waiting for the owner's rulings.**

- Findings are in [recruiting-reel-research-2026-11.md](../../research/recruiting-reel-research-2026-11.md): every question answered with its sources and an evidence strength, twenty real reels tabulated (5 goalkeepers, 6 defenders, 3 midfielders, 6 forwards and wide players), a proposed list of 18 soccer qualities with visible signs and a routine example for each, six signs of a social-worthy moment, what differs across the eleven sports, and sixteen one-line recommendations to T15880, T16300, T16330 and T16150.
- The owner's decision page, with ten choices and a recommendation for each: https://claude.ai/artifact/GdJTUGsZhBzSkj3dZ29uvZ
- Not every question has two sources. Nothing published covers how to show several positions, whether coaches watch on a phone, or what a routine play looks like in a coach's words; the findings mark these "No evidence" and say the answer is our judgment. The first criterion stays unticked for that reason.
- The evidence on what is shared on social media is thin: one general study and a handful of reported cases. The findings say so.
- The quality list is not yet stored with the sport. Its names become fixed identifiers once a game is analyzed, so it is stored after the owner rules on decision 1.
- Found while researching: the app's default shape for a highlight is portrait, and every source and all twenty reels say a recruiting reel is landscape. This is decision 8.
- Another task was filed the same day under this number ("Admin choice in the dev sign-in presets"). This is decision 10.

## Ruling

The owner ruled on 2026-11-13, after reading the findings and the decision page.

- **General first.** "Our tool is general purpose and anything we do for soccer will need to be multiplied out by every sport we support. Best to keep things as generic as possible but remember to store strings that go with the specific sports that can be injected into the prompt for those sports." The quality list is therefore split: ten general qualities stored once, and for each sport its own qualities and its own wording, stored with the sport.
- **One bar for Brilliant (decision 2, in the owner's words).** "Both for social media and scouts, we are looking for a play where the focused player did better than a good player at that level would be expected to do. For IG specifically it can be anything players see in highlights for their favorite players on YouTube. For scouting specifically it's what the research tells us and it's demonstrating both strong decision making and execution. The AI should also find learning opportunities, but those won't be marked Brilliant and therefore won't be considered in the highlight reel system."
- **Everything else as recommended.** "I defer to your recommendations for any other issue."
  - Decision 1, quality list: the eighteen proposed, now ten general and eight soccer (three of those for goalkeepers).
  - Decision 3, length: about 3 minutes and 12 to 20 highlights, never past 5 minutes.
  - Decision 4, order: the best three to five highlights first, then sections.
  - Decision 5, title card: name, graduation year, position (a primary and up to two others), jersey number, club or team, for about 3 to 4 seconds; high school, height and grade average optional and off.
  - Decision 6, contact details: on the end card only, the athlete's email and optionally the club coach; phone optional and off; no parent field.
  - Decision 7, highlights with no spotlight: prefer the ones that have it and show a count of those without; never block.
  - Decision 8, shape: a recruiting reel is landscape and prefers landscape highlights; portrait ones are used only when needed, with bars at the sides, and the parent is told how many. No slow motion, no music by default, plain cuts.
  - Decision 9, sports: all eleven run on the general part; baseball and softball carry a note that coaches expect a skills video.
  - Decision 10: this task keeps the number T16320; the admin sign-in task became T16430.

## Still open

- The general qualities and soccer's strings are stored in the app by pull request 754 (https://github.com/imankha/video-editor/pull/754), which waits for the owner to merge. Its test checks that the general part names no sport and that a sport with no strings gets the ten general qualities.
- The owner, watching five plays from a real game, checks that the signs alone are enough to name the qualities each one shows. This needs a real game on screen and is easiest on the first staging analysis (T16150).

## For the implementer

### Where things go
- Findings: `docs/plans/research/recruiting-reel-research-2026-11.md`.
- Quality list (general first, owner ruling 2026-11-13): the ten general qualities in `src/frontend/src/modes/annotate/constants/generalQualities.js`; each sport's own strings beside its tags (`soccerTags.js` export `sportStrings`: its own qualities, the general qualities in its words, social examples, reel notes), read through `tagRegistry.js` (`getQualities`, `getSportStrings`). A sport with no strings works from the general part. T16150 adds the server mirror and the cross-language guard test.
- Stored names are stable identifiers once an analysis has used them: renaming a quality later means a new prompt version.

### Sources to start from
College coaches' own published advice, recruiting services (NCSA, SportsRecruits, FieldLevel, Hudl guides), club and high-school coach guidance, and public reels of athletes who were recruited.

### Related Tasks
- Blocks: T16150 (quality list in the first prompt version), T16330.
- Informs: T15880, T16300, T11300.

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
- [ ] The owner has read the findings and ruled on the recommendations; the rulings are recorded in this file under `## Ruling`.
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

## Waiting on the owner

Ten rulings, listed on the decision page: the quality list, the social-worthy signs, reel length, order and sections, title card contents, where contact details go, highlights with no spotlight, portrait highlights, which sports, and the duplicate task number. After the rulings: record them here under `## Ruling`, store the quality list in `soccerTags.js`, and carry the accepted recommendations into T15880, T16300 and T16330.

## For the implementer

### Where things go
- Findings: `docs/plans/research/recruiting-reel-research-2026-11.md`.
- Quality list: beside the sport's tags in `src/frontend/src/modes/annotate/constants/soccerTags.js` (export `qualities`, registered in `tagRegistry.js`), mirrored for the server where `T16150` puts the tag list, with the same cross-language guard test that task adds for tags. If T16150 has not landed, commit the list in the findings document and in `soccerTags.js` only; T16150 adds the server mirror.
- Stored names are stable identifiers once an analysis has used them: renaming a quality later means a new prompt version.

### Sources to start from
College coaches' own published advice, recruiting services (NCSA, SportsRecruits, FieldLevel, Hudl guides), club and high-school coach guidance, and public reels of athletes who were recruited.

### Related Tasks
- Blocks: T16150 (quality list in the first prompt version), T16330.
- Informs: T15880, T16300, T11300.

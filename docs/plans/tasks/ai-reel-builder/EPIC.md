# Epic: AI reel builder

## In plain words

A highlight is one finished short clip of an athlete, and a reel is several of them joined into one video for a college coach. Once the reel builder exists, a parent still has to decide which highlights go in, in what order, and what the section cards (still screens with a heading) say, and most parents do not know what a coach wants to see. This epic adds a suggestion: a language model reads what we know about each of the athlete's highlights and proposes the picks, the order and the sections, and the parent edits and finishes as usual. The model never watches video. It reads text only: the note on each highlight, the list of qualities the highlight demonstrates, its tags, its star rating, and its standing in the comparison game (the "which is better?" game parents already play). The sections come from what this athlete actually has good highlights of, not from a fixed template for their position. The first version builds recruiting reels only.

**Status:** TODO
**Filed:** 2026-11-13
**Started:** not started
**Impact:** 7 **Complexity:** 5 **Priority:** 1.4
**Placement:** after the Highlight reel builder and before the Referral programme (owner, 2026-11-13). Its research task runs earlier, before Mark plays with AI, because that epic's prompt and stored data depend on it.

## Goal

A parent with a bank of finished highlights taps once and gets a recruiting reel laid out the way a college coach wants to see it, built from the highlights this athlete really has, ready to edit and export.

## Owner decisions (2026-11-13)

1. **Text only.** The reel builder is strictly a language model reading notes and ratings. No video or pictures are sent.
2. **An expert built from research.** We research what college coaches look for and what successful recruiting reels do, once, at build time. The findings become the prompt the model runs with.
3. **General first, sport second.** The expert is mostly general, because the app supports eleven sports. Knowledge that belongs to one sport is stored with that sport, beside its tags, and added to the prompt for athletes of that sport.
4. **The athlete's bank decides.** Every athlete has a different set of highlights. We send the notes for all of them and the model decides which to use, in what order, and how to group them. The groups become section cards. A winger and a centre-back will get different sections, but because of what they have good highlights of, not because of a position template.
5. **A fixed list plus a sentence.** Each play marked by the AI records what it demonstrates in two ways: one to three qualities from a fixed list for the sport, and one plain sentence a parent can read. A quality is what the play shows about the athlete (pace, vision, composure); a tag is what happened (Goal, Tackle).
6. **Use what exists for the rest.** Highlights from plays a parent marked by hand, or from clips uploaded directly, have no AI note. For those the model works from tags, star rating, comparison-game standing and any note the parent typed. No extra video analysis and no extra questions.
7. **Recruiting only at first.** Other purposes, such as a season recap, can be added later as another prompt over the same data.
8. **Designed before Mark plays with AI is built.** The data the reel builder needs is written into that epic's tasks now, so the two are one design and the stored game analyses never have to be redone.

## Why the data work happens early

A game analysis is stored once for each video and reused by every parent of that game. If the first analyses did not record what each play demonstrates, every stored game would have to be analysed again later, at about $2.84 each, to feed the reel builder. So the quality list and the sentence go into the very first version of the analysis prompt.

## How the pieces fit (one design across three epics)

1. **Research and the quality list (this epic, runs first).** Produces what coaches want, how successful reels are built, and the fixed list of qualities for soccer. Its answers on cards also feed the reel builder's title card and end card.
2. **Capture (Mark plays with AI, the game analysis engine).** For every player's part in a strong play the model records the qualities and the sentence, beside the tags, scores and coaching note it already records.
3. **Carry (Mark plays with AI, the import and the tagging screen).** The qualities and sentence travel with the play into the parent's game. When the parent says "this is my athlete" on a player, we record which player's description belongs to their child.
4. **One read (Mark plays with AI, last task).** One server call returns everything the reel builder needs for an athlete: the athlete's own details and, for each finished highlight, its note, qualities, tags, ratings, comparison-game standing, length, shape and game. It is text small enough to send to a model in one message.
5. **The expert prompt (this epic).** The research turned into the general prompt, plus a short block of knowledge for each sport, stored with the sport.
6. **The suggestion (this epic).** The one read plus the expert prompt go to the model; the answer opens the reel builder already filled in.

## What the model receives and returns

Receives: the athlete (name, sport, position, graduation year, team), and for each finished highlight the facts in point 4 above. Nothing else.

Returns: which highlights to use, their order, the sections with a heading for each, a title, and one line of reasoning for each pick, in a fixed format the builder can load.

## Tasks (dependency order)

| ID | Task | Status | Runs |
|----|------|--------|------|
| T16320 | [Recruiting reel research](T16320-recruiting-reel-research.md) | TODO | Before Mark plays with AI |
| T16330 | [Reel expert prompt](T16330-reel-expert-prompt.md) | TODO | After the Highlight reel builder |
| T15890 | [Suggested reel](../T15890-llm-reel-assembly.md) | TODO | After T16330 |

The capture, carry and one-read work lives in the Mark plays with AI epic ([EPIC.md](../mark-plays-with-ai/EPIC.md): the game analysis engine T16150, the import T16190, the tagging screen T16200, and highlight facts in one read T16205).

T16330 and T15890 are outlines. Their detail is written after the Highlight reel builder ships, when the builder's real screens and stored format are known.

## Out of scope

- Sending video or pictures to the reel model.
- Analysing hand-marked or uploaded highlights with a video model to write notes for them.
- Reels for purposes other than recruiting.
- Exporting a reel without the parent pressing Finish.

## Completion criteria

- [ ] The research is written, the owner has read it, and the soccer quality list is stored with the sport.
- [ ] A play marked by the AI carries its qualities and its sentence from the analysis to the finished highlight made from it.
- [ ] One call returns every fact the reel builder needs for an athlete, and no video is read to answer it.
- [ ] A parent with five or more finished highlights gets a suggested recruiting reel with sections in under twenty seconds and can edit every part of it.
- [ ] The suggestion has been compared with ten reels the owner built by hand, and the result is recorded.
- [ ] The owner can read how many reels were started from a suggestion, how many of those were exported, and what the suggestions cost.

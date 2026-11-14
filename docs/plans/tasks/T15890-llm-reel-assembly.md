# T15890: Suggested reel

## In plain words

Once the reel builder exists, a parent can join highlights (finished short clips) into a reel (one video for a college coach), but they still have to choose which ones, the order and the section headings, and most parents do not know what a coach wants. Competitors sell "AI picks the best". With this change the Reels tab gains one button, Suggest a reel. A language model reads the facts we hold about each of the athlete's highlights, with the expert instructions built from our research, and the builder opens already filled in: picks, order, section cards and a title. The model reads text only and never watches video, so a suggestion costs about a cent. The parent edits anything and nothing is exported until they press Finish. Done when a parent with five or more highlights gets a sensible suggested recruiting reel in under twenty seconds, and the suggestions have been compared with ten reels the owner built by hand.

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-09
**Updated:** 2026-11-13

Epic: [ai-reel-builder/EPIC.md](ai-reel-builder/EPIC.md). Epic task 3 of 3. This file is an outline; its detail is written after the Highlight reel builder ships.

## Outline

1. **Suggest a reel** on the Reels tab. The server gathers the athlete's highlight facts in one read (T16205), adds the expert instructions (T16330) and asks the model once.
2. **The answer fills the builder.** Picks and order become the running order, each section becomes a section card, the title fills the title card. The parent sees one line of reasoning beside each pick and edits as usual.
3. **Honest about thin data.** Highlights with no AI note are judged on tags, star rating, comparison-game standing and any typed note. When most of an athlete's highlights are like that, the suggestion says it is working from little.
4. **Recruiting reels only** in the first version.
5. **Checked against the owner.** Ten reels the owner would build by hand are compared with the suggestions, by overlap of picks and agreement of order, before the button is shown to everyone.
6. **Measured.** How many reels start from a suggestion, how many of those are exported, and the cost of each call.

## How we will know it worked

- [ ] Suggest a reel fills the builder with picks, order, section cards and a title for an account with five or more finished highlights in under twenty seconds, on phone and desktop.
- [ ] No video or picture is sent to the model.
- [ ] The owner's ten hand-built reels share at least 70% of their picks with the suggestions on average; the result is recorded in this file.
- [ ] The model name and the instructions are settings, and the cost of each call is recorded.
- [ ] The owner can read how many reels were started from a suggestion and how many of those were exported.

## For the implementer

### Related Tasks
- Depends on: T11300 and T16300 (the builder and its section cards), T16205, T16330.

### Relevant Files (REQUIRED)
- `src/backend/app/routers/reels.py` (new in T11300)
- `src/backend/app/services/highlight_facts.py` (new in T16205)
- `src/backend/app/routers/collections.py` (comparison-game order)
- `src/frontend/src/components/reels/` (new in T11300)

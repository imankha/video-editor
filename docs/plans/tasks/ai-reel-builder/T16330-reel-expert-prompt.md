# T16330: Reel expert prompt

## In plain words

The AI reel builder suggests which highlights (finished short clips) go into a reel (several highlights joined for a college coach), in what order and under which headings. For that it needs to know what a coach wants, and today that knowledge exists only as a research document. This task turns the research into the instructions the model runs with: one general part that holds for every sport, and a short part for each sport that is stored with that sport, beside its tags, and added for athletes of that sport. The instructions tell the model to build the sections from what this athlete has good highlights of, not from a template for their position. Done when the owner has read the instructions in plain text, and a trial on the owner's own highlights produces sections that make sense for two athletes who play different positions.

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-11-13
**Updated:** 2026-11-13

Epic: [ai-reel-builder/EPIC.md](EPIC.md). Epic task 2 of 3. This file is an outline; its detail is written after the Highlight reel builder ships.

## Outline

- The general instructions come from the findings of the recruiting reel research (T16320) and the owner's rulings on it.
- Each of the eleven supported sports gets a short block of its own knowledge, stored where the sport's tags and qualities are stored. A sport with no block yet still works from the general part.
- The answer format is fixed: picks, order, sections with headings, a title, and one line of reasoning for each pick.
- The instructions and the answer format carry a version number, so a later change can be compared with the one before.

## How we will know it worked

- [ ] The general instructions and the soccer block are readable as plain text and the owner has approved them.
- [ ] Every supported sport has a block or is listed as running on the general part only.
- [ ] A trial on real highlight facts gives different, sensible sections for two athletes in different positions.

## For the implementer

### Related Tasks
- Depends on: T16320 (research), T16205 (the facts the instructions refer to). Blocks: T15890.

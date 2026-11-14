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

## From the recruiting reel research (owner accepted 2026-11-13)

Findings: `docs/plans/research/recruiting-reel-research-2026-11.md`, sections 8a, 8c and 8d. The owner repeated that the instructions are general first: nothing in the general part names a sport, and each sport's reel notes, quality names and wording are strings stored with that sport (`getSportStrings` in `tagRegistry.js`) and added for athletes of that sport.

The general part must say:

- Use only highlights from Brilliant plays and from plays the parent rated well. Never use a learning opportunity.
- Open with the athlete's three to five strongest highlights whatever their type, then group the rest into two to four sections named from the sport's quality names.
- Aim for about 3 minutes and 12 to 20 highlights. Never go past 5 minutes. With few highlights, a shorter reel is better than a padded one.
- Rank by what counts for scouting: plays under pressure and against a set opponent beat the same action unopposed. Do not pick a play only because it is Brilliant for social media.
- Show range for the position; do not repeat one kind of play.
- Prefer landscape highlights, highlights where the athlete is pointed out, and recent games.

Each sport's reel notes are drafted in section 8c of the findings for all eleven sports. Baseball and softball carry a note to the parent that coaches in those sports expect a staged skills video. Flag football and rugby have almost no published guidance and run on the general part.

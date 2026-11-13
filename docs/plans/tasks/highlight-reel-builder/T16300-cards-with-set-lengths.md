# T16300: Cards with set lengths

## In plain words

In the first version of the reel (several highlights, which are finished short clips, joined into one video) a card is a still screen with a title and an optional second line, and it always stays up for two and a half seconds. That is too long for a one-word heading such as "Goals" and too short for an end card with a phone number and an email address a coach has to read. With this change the parent can add three kinds of card anywhere in the reel: a title card, a section card and an end card. Each card has its own length, suggested from the number of words on it and changed with plus and minus buttons. Done when a parent on a phone adds a section card of one and a half seconds and an end card of five seconds, and both last exactly that long in the exported reel.

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-12
**Updated:** 2026-11-13
**Milestone:** Highlight reel builder (see [EPIC.md](EPIC.md)). Task 4 of 6.

## Ruling

The owner ruled on the decision page (owner, 2026-11-13), both as recommended:

- **Kinds of card (choice 5):** title, section and end card. A stat card waits.
- **Card length (choice 6):** suggested from the number of words on the card, changed with plus and minus in half-second steps.

## How we got here

On 2026-10-20 cards were ruled to be a title card plus section cards at a fixed 2.5 seconds, hidden behind a switch. On 2026-11-12 the owner asked for cards with defined lengths. Recruiting guides ask for the athlete's details at the start and contact details at the end, and those two cards hold very different amounts of text.

## The problem

One fixed length fits no card well. A coach gives a reel a few seconds before deciding to keep watching, so a heading that lingers wastes them, and contact details that vanish before they can be read lose the reply the reel was made to get.

## What we will do

1. "Add card" at any join in the Arrange list, with three kinds: title, section and end card.
2. Each kind has its own layout and its own fields. The end card has the athlete's name, a contact line and the club.
3. Each card shows its length on the row. Plus and minus change it in half-second steps between one and eight seconds.
4. The app suggests a length from the words on the card until the parent changes it; after that the parent's value stays.
5. Cards are items in the list: they can be dragged and removed, and the reel's one transition plays on each side of them.
6. The preview shows each card for its length, and the total length of the reel includes them.

## Why this and not something else

A slider is hard to set to an exact value with a thumb. Typing seconds brings up a keyboard for one digit. A handful of fixed choices is the simplest but leaves the same mismatch between a short heading and a long contact card. A stat card with a table of numbers is left out until parents ask for it.

## How we will know it worked

- [x] The owner has ruled on choices 5 and 6 of the decision page, and the answers are recorded in this file.
- [ ] On a phone and on desktop, a parent can add a title, a section and an end card at any join, edit the words, and remove the card.
- [ ] Plus and minus change a card's length in half-second steps and never go below one second or above eight.
- [ ] A new card's suggested length grows with the number of words; once the parent changes the length, editing the words does not change it back.
- [ ] Each card lasts its set length in the preview and, within a tenth of a second, in the exported reel.
- [ ] The text on every card is readable on a phone held upright, in a portrait reel and in a landscape reel.

## For the implementer

### Related Tasks
- Depends on: T11300's text frame rows (`TextFrameRow`) and section-card template; T16280's card rendering at an exact length.
- Related: T15880 (the title card's athlete fields and its use as the cover); T16290 (the reel's transition plays around a card).

### Relevant Files (REQUIRED)
- `src/frontend/src/components/reels/` (new in T11300) - `TextFrameRow`, `TextFramePreRoll`, new card sheet and length stepper
- `src/backend/app/services/serve_time_video.py` - card templates
- `src/backend/app/routers/reels.py` (new in T11300) - surgical writes for card text and card length
- `src/frontend/src/constants/displayNames.js` - copy

### Technical Notes
- Suggested length: a floor of 1.5 s plus reading time per word, capped at 8 s; the constants live in one place and the design names them.
- Store whether the length was set by hand, so the suggestion stops overriding it. This is a stored fact about the card, written on the plus or minus gesture.
- The fixed 2.5 s from T11300 becomes the starting value for cards made before this task.

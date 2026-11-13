# T16290: Transition at each join

## In plain words

In the first version of the reel (several highlights, which are finished short clips, joined into one video) the parent chooses one transition for the whole reel: a straight cut or a fade to black. A real reel wants more control than that: quick cuts through a run of goals, then a slower fade into a new section. With this change the list of highlights shows a small button at every join. Tapping it offers cut, fade through black or crossfade, in a quick, normal or slow length, and one more tap applies that choice to every join. The preview plays the transitions, so the parent sees the reel as it will be before exporting. Done when a parent on a phone can give three joins three different transitions and the exported reel plays each one as chosen.

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-12
**Updated:** 2026-11-12
**Milestone:** Highlight reel builder (see [EPIC.md](EPIC.md)). Task 3 of 5.
**Waits on:** the decision page linked in the epic. Choices 1, 2, 3, 4 and 7 set this screen.

## How we got here

On 2026-10-20 the first version was ruled to have one transition for the whole reel, cut by default with fade as the option. On 2026-11-12 the owner asked for a builder where the parent defines the transitions. The apps parents already know put a small button between two clips and open a short list from it; the decision page shows them side by side.

## The problem

One setting for the whole reel cannot mark a change of section, and a parent who wants one soft join among cuts has no way to ask for it. A setting the parent cannot see playing is also a guess: in the first version a fade only appears after export.

## What we will do

1. Show a small button at every join in the Arrange list. It shows the current transition as an icon, so the whole reel can be read at a glance.
2. Tapping it opens a sheet with the transitions and the three lengths. Each option plays a short moving sample.
3. The sheet has "Use for every join". The reel-wide choice from the first version stays as the starting value for new joins.
4. The preview plays cuts, fades and crossfades between highlights and cards.
5. The total length shown already allows for crossfades, which shorten the reel.
6. A join next to a card offers the same choices.

## Why this and not something else

A film-editor timeline gives the most control and is the hardest thing to use on a phone, where most parents are. A button at the join is the pattern in the phone editors parents already use. Wipes, spins and zooms are left out because recruiting guides tell families that coaches dislike effects.

## How we will know it worked

- [ ] The owner has ruled on choices 1, 2, 3, 4 and 7 of the decision page, and the answers are recorded in this file.
- [ ] On a phone and on desktop, every join in the Arrange list shows its transition and can be changed in two taps.
- [ ] "Use for every join" changes all joins in one gesture and one write.
- [ ] The preview plays each join with the transition and length chosen for it.
- [ ] The exported reel plays the same transitions as the preview, in the same places.
- [ ] The total length shown equals the length of the exported file to the second.
- [ ] Reordering highlights keeps a sensible transition at every join and never leaves a join without one.

## For the implementer

### Related Tasks
- Depends on: T11300's Arrange step (`ReelMemberList`) and reel draft endpoints; T16280's render of each transition.
- Related: T16300 (cards share the same joins).

### Relevant Files (REQUIRED)
- `src/frontend/src/components/reels/` (new in T11300) - `ReelMemberList`, new join button and transition sheet
- `src/frontend/src/components/introcards/IntroStoryPlayer.jsx`, `CompositeScrubber.jsx` - preview
- `src/backend/app/routers/reels.py` (new in T11300) - surgical write for one join, and for all joins
- `src/frontend/src/constants/displayNames.js` - copy

### Technical Notes
- A transition belongs to the join after an item; decide in the design what happens to it when that item moves, and test it.
- Preview fades with two stacked video elements and opacity; the exported file is the truth and the copy must not promise frame accuracy.
- Each write names its gesture: tap a transition, tap a length, tap "Use for every join". No effect-driven writes.
- Sheets close with their own button, never on a backdrop tap.

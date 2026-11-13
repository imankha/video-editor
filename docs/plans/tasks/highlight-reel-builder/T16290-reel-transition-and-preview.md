# T16290: Reel transition and preview

## In plain words

In the first version of the reel (several highlights, which are finished short clips, joined into one video) the parent chooses a straight cut or a fade to black for the whole reel. The fade has one fixed length, and it only appears after export, so the parent picks it without seeing it. The owner ruled that one transition for the whole reel is enough: no separate setting at each join. With this change that one choice gains crossfade as a third kind and a slider for how long the transition lasts, and the preview plays it, so the parent sees the reel as it will be before exporting. Done when a parent on a phone picks crossfade, drags the length to about one second, watches it in the preview, and the exported reel plays the same at every join.

**Status:** TODO
**Impact:** 7
**Complexity:** 4
**Created:** 2026-11-12
**Updated:** 2026-11-13
**Milestone:** Highlight reel builder (see [EPIC.md](EPIC.md)). Task 3 of 6.

## Ruling

The owner ruled on the decision page (owner, 2026-11-13):

- **Shape of the builder (choice 1):** one list in playing order. Not a film-editor timeline.
- **Reach of a transition (choice 2):** one transition for the whole reel. No setting at each join. This keeps the 2026-10-20 ruling and is simpler than the recommendation.
- **Which transitions (choice 3):** cut, fade through black, and crossfade. Cut is the starting value.
- **Transition length (choice 4):** a slider, not three named lengths.
- **Preview (choice 7):** the transition and the cards play in the preview before export.

One detail the ruling leaves to the design, proposed here: the slider runs from 0.2 to 2.0 seconds in steps of a tenth, starts at half a second, and shows its value as a number beside it.

## How we got here

On 2026-10-20 the first version was ruled to have one transition for the whole reel, cut by default with fade as the option. On 2026-11-12 the owner asked for a builder where the parent defines the transitions, and this task was first filed as a separate transition at every join. On 2026-11-13 the owner looked at the choices and ruled that one transition for the whole reel is all that is needed, with more kinds and a length the parent can set.

## The problem

Two kinds and one fixed length is a thin choice, and a setting the parent cannot see playing is a guess: in the first version a fade only appears after export.

## What we will do

1. Keep the single transition control on the Arrange screen and give it three kinds: cut, fade through black, crossfade. Each plays a short moving sample.
2. Show a length slider when the kind is fade or crossfade. Cut has no length.
3. Apply that one kind and length to every join in the reel, including the joins beside cards.
4. Play cuts, fades and crossfades in the preview, between highlights and cards.
5. Show a total length that already allows for crossfades, which shorten the reel.

## Why this and not something else

A separate setting at every join gives more control, but fifteen highlights would mean fourteen decisions, and recruiting guides tell families that coaches want reels plain. One setting keeps every join matching. A slider on a single setting does not have the usual weakness of sliders, where each join ends up a slightly different length, because there is only one value. Wipes, spins and zooms are left out because coaches dislike effects.

## How we will know it worked

- [x] The owner has ruled on choices 1, 2, 3, 4 and 7 of the decision page, and the answers are recorded in this file.
- [ ] On a phone and on desktop, the parent can pick cut, fade through black or crossfade for the reel in two taps.
- [ ] The slider sets the length between 0.2 and 2.0 seconds, shows the value as a number, and is hidden for a cut.
- [ ] The preview plays every join with the chosen kind and length.
- [ ] The exported reel plays the same transition as the preview at every join.
- [ ] The total length shown equals the length of the exported file to the second.
- [ ] Adding, removing or reordering highlights and cards never leaves a join without the reel's transition.

## For the implementer

### Related Tasks
- Depends on: T11300's Arrange step and reel draft endpoints (the reel-level transition already exists there as cut or fade); T16280's render of each transition.
- Related: T16300 (cards share the same joins).

### Relevant Files (REQUIRED)
- `src/frontend/src/components/reels/` (new in T11300) - Arrange step, transition control, new length slider
- `src/frontend/src/components/introcards/IntroStoryPlayer.jsx`, `CompositeScrubber.jsx` - preview
- `src/backend/app/routers/reels.py` (new in T11300) - surgical writes for the reel's transition kind and length
- `src/frontend/src/constants/displayNames.js` - copy

### Technical Notes
- The transition kind and its length are two fields on the reel, not on a join. No per-join storage.
- Slider write: one surgical write on release (pointer up or key up), never while dragging and never from an effect.
- Preview fades with two stacked video elements and opacity; the exported file is the truth and the copy must not promise frame accuracy.
- A crossfade longer than the shorter neighbour (a 1.0 s card with a 2.0 s crossfade) must be clamped at render and in the shown total; decide the rule in the design and test it.

# Epic: Highlight reel builder

## In plain words

Today a parent can finish a highlight (one short clip of their athlete) and share it, but there is no way to join several highlights into one video. A reel (several highlights joined, for a college coach or for the end of a season) is the only reason the app gives a parent to come back next weekend, and only 17 of 402 parents returned after a week. This epic lets a parent pick finished highlights, put them in order, choose how each one moves into the next, and add cards (a still screen with words, such as a title, a section heading or contact details) that each stay up for a length the parent sets. The first task ships the plain version that was designed in October: pick, order, one title card, straight cuts, export. The tasks after it add a transition at each join and cards with their own lengths. The export stays free, because every highlight in a reel was already paid for.

**Status:** TODO
**Filed:** 2026-11-12
**Started:** not started
**Impact:** 8 **Complexity:** 8 **Priority:** 1.0
**Placement:** after Mark plays with AI and before the Referral programme (owner request, 2026-11-12).
**Design:** decision page https://claude.ai/artifact/Ug2wkCAVfxhUCfBgKQWq2H . It shows how other apps do this, the choices, and a recommendation for each. The three new tasks wait for the owner's answers on that page.

## Goal

A parent with two or more finished highlights can build one reel on a phone in a few minutes, see it play with its transitions and cards before exporting, and share one link or one file.

## What is already decided

The first version was designed and ruled on 2026-10-20 (twelve rulings, recorded in [T11300](../T11300-reels-v2-post-publish-stitcher.md)). This epic keeps all of them except the two it widens:

| Decided on 2026-10-20 | In this epic |
|---|---|
| Reels get their own tab after Finished | Kept |
| Pick finished highlights with tick boxes; one shape (portrait or landscape) per reel | Kept |
| Order starts best first; drag by a handle to change it | Kept |
| Free to export; a gentle warning above five minutes | Kept |
| The reel is saved as the parent builds it, with no save button | Kept |
| One transition for the whole reel: cut, or fade to black | Widened: each join can have its own (T16290) |
| Cards are a fixed 2.5 seconds | Widened: each card has its own length (T16300) |

## What the decision page asks

Eight choices, each with a recommendation. The recommended answers, which the task files assume until the owner says otherwise:

1. **Shape of the builder:** one list in playing order, with a small button at every join. Not a film-editor timeline.
2. **Reach of a transition:** one choice for the whole reel, and any single join can be changed.
3. **Which transitions:** cut, fade through black, and crossfade. No wipes, spins or zooms.
4. **Transition lengths:** three named lengths (quick, normal, slow), not a slider.
5. **Kinds of card:** title, section and end card. A stat card waits.
6. **Card length:** suggested from how many words are on the card, changed with plus and minus in half-second steps.
7. **Preview:** transitions and cards play in the preview before export.
8. **Sound:** each highlight keeps its own sound, which fades with the picture; one switch mutes the reel. No music library.

## How it fits together

- **A reel is a running order.** It is a list of items: highlights and cards. Between two neighbouring items is a join, and a join carries a transition and a length. A card carries its words and a length.
- **Cuts stay fast.** A reel with only cuts is joined without re-making the picture, which takes seconds. A fade or a crossfade needs the picture re-made, which takes longer and costs us computer time. The render engine task (T16280) measures both before any screen promises a wait.
- **A crossfade overlaps.** Two highlights share the screen for the length of a crossfade, so the reel gets shorter by that much at each one. The total length shown to the parent must already include this.
- **One table design.** The design for the first version (T11300) defines how a reel is stored. It must leave room for a transition on each join and a length on each card, so the later tasks add no second change to stored data.

## Tasks (dependency order)

| ID | Task | Status |
|----|------|--------|
| T11300 | [Highlight reel, first version](../T11300-reels-v2-post-publish-stitcher.md) | TODO |
| T16280 | [Reel render engine](T16280-reel-render-engine.md) | TODO |
| T16290 | [Transition at each join](T16290-transition-at-each-join.md) | TODO |
| T16300 | [Cards with set lengths](T16300-cards-with-set-lengths.md) | TODO |
| T15880 | [Reel title card and cover](../T15880-reel-title-card-is-the-cover-recruiting-kit.md) | TODO |

T11300 ships on its own and is useful alone. It needs two clean-up tasks to land first (T11250 and T11260, which remove old code for projects with several clips). T16280 to T16300 build on it in order. T15880 can follow T11300 at any point.

After this epic: [Suggested reel](../T15890-llm-reel-assembly.md) (T15890), where a model proposes the picks, the order and the card text.

## Out of scope

- A music library. Coaches watch muted and licensed music is its own project.
- Mixing portrait and landscape highlights in one reel.
- Trimming a highlight inside the builder. A highlight is trimmed where it was made.
- Words or stickers drawn over a playing highlight. Cards are separate screens.

## Completion criteria

- [ ] A parent on a phone builds a reel of at least five highlights with a title card, one section card and an end card, and exports it.
- [ ] Each join plays the transition chosen for it, and each card stays up for the length set for it, in the exported file.
- [ ] The preview shows the same order, transitions and card lengths as the exported file.
- [ ] A reel with only cuts exports as fast as a joined download does today.
- [ ] The owner can read how many reels were started, exported and shared, and how many of their makers came back the next week.

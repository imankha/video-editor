# Epic: Highlight reel builder

## In plain words

Today a parent can finish a highlight (one short clip of their athlete) and share it, but there is no way to join several highlights into one video. A reel (several highlights joined, for a college coach or for the end of a season) is the only reason the app gives a parent to come back next weekend, and only 17 of 402 parents returned after a week. This epic lets a parent pick finished highlights, put them in order, choose how each one moves into the next, and add cards (a still screen with words, such as a title, a section heading or contact details) that each stay up for a length the parent sets. The first task ships the plain version that was designed in October: pick, order, one title card, straight cuts, export. The tasks after it add a wider transition choice that plays in the preview, cards with their own lengths, and music if a usable music bank is found. The export stays free, because every highlight in a reel was already paid for.

**Status:** TODO
**Filed:** 2026-11-12
**Started:** not started
**Impact:** 8 **Complexity:** 8 **Priority:** 1.0
**Placement:** after the Referral programme and Click-once Spotlight (owner, 2026-11-13; it was first placed between Mark plays with AI and the Referral programme on 2026-11-12).
**Design:** decision page https://claude.ai/artifact/Ug2wkCAVfxhUCfBgKQWq2H . It shows how other apps do this, the choices, and a recommendation for each. The owner answered all eight on 2026-11-13; the answers are below and in each task file.

## Goal

A parent with two or more finished highlights can build one reel on a phone in a few minutes, see it play with its transitions and cards before exporting, and share one link or one file.

## What is already decided

The first version was designed and ruled on 2026-10-20 (twelve rulings, recorded in [T11300](../T11300-reels-v2-post-publish-stitcher.md)). This epic keeps all of them and widens two:

| Decided on 2026-10-20 | In this epic |
|---|---|
| Reels get their own tab after Finished | Kept |
| Pick finished highlights with tick boxes; one shape (portrait or landscape) per reel | Kept |
| Order starts best first; drag by a handle to change it | Kept |
| Free to export; a gentle warning above five minutes | Kept |
| The reel is saved as the parent builds it, with no save button | Kept |
| One transition for the whole reel: cut, or fade to black | Kept as one for the whole reel. Widened: crossfade added, and a slider for the length (T16290) |
| Cards are a fixed 2.5 seconds | Widened: each card has its own length (T16300) |

## What the owner chose

The decision page asked eight things. The answers (owner, 2026-11-13); five follow the recommendation and three differ:

| # | Choice | Answer | Against the recommendation |
|---|---|---|---|
| 1 | Shape of the builder | One list in playing order. Not a film-editor timeline | Same |
| 2 | Reach of a transition | One transition for the whole reel | Simpler: no separate setting at each join |
| 3 | Which transitions | Cut, fade through black, crossfade. No wipes, spins or zooms | Same |
| 4 | Transition length | A slider | Different: three named lengths were recommended |
| 5 | Kinds of card | Title, section and end card. A stat card waits | Same |
| 6 | Card length | Suggested from the words on the card; plus and minus in half-second steps | Same |
| 7 | Preview | The transition and the cards play in the preview before export | Same |
| 8 | Sound | Each highlight keeps its sound; one switch mutes the reel. Music as well, if an open music bank with a good sports or high-energy category can be found | Wider: music was left out (T16310) |

With one transition for the whole reel, the list needs no button at each join; the gaps between rows only offer "Add card".

## How it fits together

- **A reel is a running order.** It is a list of items: highlights and cards. The reel carries one transition and its length, and that plays at every join. A card carries its words and a length.
- **Cuts stay fast.** A reel with only cuts is joined without re-making the picture, which takes seconds. A fade or a crossfade needs the picture re-made, which takes longer and costs us computer time. The render engine task (T16280) measures both before any screen promises a wait.
- **A crossfade overlaps.** Two highlights share the screen for the length of a crossfade, so the reel gets shorter by that much at each one. The total length shown to the parent must already include this.
- **One table design.** The design for the first version (T11300) defines how a reel is stored. It must leave room for a transition kind and length on the reel, a length on each card and one music track, so the later tasks add no second change to stored data.

## Tasks (dependency order)

| ID | Task | Status |
|----|------|--------|
| T11300 | [Highlight reel, first version](../T11300-reels-v2-post-publish-stitcher.md) | TODO |
| T16280 | [Reel render engine](T16280-reel-render-engine.md) | TODO |
| T16290 | [Reel transition and preview](T16290-reel-transition-and-preview.md) | TODO |
| T16300 | [Cards with set lengths](T16300-cards-with-set-lengths.md) | TODO |
| T16310 | [Music for reels](T16310-music-for-reels.md) | TODO |
| T15880 | [Reel title card and cover](../T15880-reel-title-card-is-the-cover-recruiting-kit.md) | TODO |

T11300 ships on its own and is useful alone. It needs two clean-up tasks to land first (T11250 and T11260, which remove old code for projects with several clips). T16280 to T16300 build on it in order. T16310 starts with a search for a music bank and builds nothing unless one qualifies and the owner approves it. T15880 can follow T11300 at any point.

What goes on the title card and the end card, and where contact details belong, is being researched from what college coaches publish and from reels that worked ([T16320](../ai-reel-builder/T16320-recruiting-reel-research.md)). The card tasks (T16300, T15880) read the owner's rulings on that research before they are designed.

After this epic: the [AI reel builder](../ai-reel-builder/EPIC.md), where a language model reads the notes and ratings on an athlete's highlights and proposes the picks, the order and the section cards.

## Out of scope

- A separate transition at each join. The owner ruled one for the whole reel is enough.
- Music a parent uploads themselves, and cuts timed to the beat. Music from an approved bank is in scope (T16310).
- Mixing portrait and landscape highlights in one reel.
- Trimming a highlight inside the builder. A highlight is trimmed where it was made.
- Words or stickers drawn over a playing highlight. Cards are separate screens.

## Completion criteria

- [ ] A parent on a phone builds a reel of at least five highlights with a title card, one section card and an end card, and exports it.
- [ ] Every join plays the reel's transition at the length set on the slider, and each card stays up for the length set for it, in the exported file.
- [ ] The preview shows the same order, transition and card lengths as the exported file.
- [ ] Music for reels is either shipped from an approved bank or closed with the reason written down.
- [ ] A reel with only cuts exports as fast as a joined download does today.
- [ ] The owner can read how many reels were started, exported and shared, and how many of their makers came back the next week.

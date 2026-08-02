# T6320: Two progress-bar implementations - player polish lands on one and misses the other

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-08-01
**Follows:** T5130 (sport-ball playhead handle) - this task exists because T5130 could not reach My Reels

## Problem

**T5130 shipped the sport-ball playhead handle and it never reached the My Reels player.** Not an
oversight in the implementation - a structural one. There are **two independent progress-bar
implementations** in the app, and polish applied to one is invisible in the other.

Verified 2026-08-01 (grep over `src/frontend/src`):

| | `VideoControls.jsx` (via `MediaPlayer`) | `CollectionPlayer.jsx` |
|---|---|---|
| Rendered by | `DraftTile.jsx:726`, `SharedVideoOverlay.jsx:99` | `DownloadsPanel.jsx:522` (**My Reels**) |
| Shape | One continuous track for one video | `reels.map(...)` - one `<button>` segment per reel |
| Track | `bg-white/25 rounded-full`, height 3 / 5 / 6px (rest / hover / coarse) | `h-1 rounded-full bg-white/25`, fixed 1px visual, `py-2` hit padding (T4760 pattern) |
| Fill | `bg-purple-500` | `bg-white` |
| **Playhead handle** | **Yes** - dot, or sport glyph since T5130; coarse/hover sizing | **None at all** |
| Hover preview fill | Yes (`hoverPercent`) | No (tooltip with reel name instead) |
| Seek | Continuous drag (mouse + touch) on the container | Discrete: click a segment -> jump to that reel + seek to the clicked fraction |

The task file for T5130 listed `DownloadsPanel` / `RankingGame` / `ProjectManager` as consumers to
thread the sport prop through. **That list was stale** - none of them render `MediaPlayer`. They play
through `CollectionPlayer`, which has no handle to put a glyph on. So T5130's acceptance criterion
*"works on the author's My Reels player"* could not be met without this refactor.

**The cost is recurring, not one-off.** Every future player improvement - handle styling, coarse
targets, hover affordances, scrub precision - has to be written twice or it silently applies to only
some surfaces. T5130 is the first time this was actually paid.

## Solution

Extract a **shared, store-free progress-track primitive** that both players compose, then give the
My Reels active segment a playhead handle (which is what delivers the sport ball to My Reels).

Suggested shape - keep it minimal:

```
ProgressTrack   - track background + progress fill + optional hover fill.
                  Props: progress (0-100), height, fillClass, trackClass, hoverPercent?
PlayheadHandle  - the dot OR the glyph, centred on the track, pointer-transparent.
                  Props: progress, glyph?, size tokens (rest / hover / coarse)
```

`VideoControls` composes both across its full width. `CollectionPlayer` composes `ProgressTrack` per
segment and renders `PlayheadHandle` **only on the active segment**.

### This is NOT a pure mechanical move - there is a design gate

The two bars do not look alike today (purple 3-6px continuous vs white 1px segmented). Making them
share a primitive forces a decision:

- **(a) Parameterize** - the primitive takes height/fill tokens and each surface keeps its current
  look. Lowest risk, no visual change, but the primitive earns less.
- **(b) Converge the visuals** - both adopt one treatment. Higher value, but it restyles My Reels,
  which nobody asked for.

**Recommend (a)**, and treat any visual convergence as a separate, explicitly-approved task.
**Get the choice approved before implementing** - do not silently restyle My Reels.

### Honest caveat on the project's own rule

CLAUDE.md says *"abstract on the 3rd duplication, never the 1st."* **This is the 2nd.** The
justification for going early is not DRY-for-its-own-sake - it is that the duplication has already
demonstrably swallowed a shipped feature (T5130). Keep the primitive small and boring; if it starts
growing options to serve both callers, that is the signal the abstraction is wrong and the two bars
should stay separate with the handle simply duplicated.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/shared/VideoControls.jsx` - the continuous track + handle
  (post-T5130: track ~`:255-275`, handle glyph/dot branches ~`:276-305`)
- `src/frontend/src/components/collections/CollectionPlayer.jsx` - segmented bar `:202-238`,
  `handleSegmentClick` `:170`, `segmentProgress` from the playback hook `:71`
- `src/frontend/src/components/MediaPlayer.jsx` - threads `sport` -> `handleGlyph` (`:205`)
- `src/frontend/src/components/DownloadsPanel.jsx` - renders `CollectionPlayer` `:522`; the My Reels
  surface that must end up with the ball
- `src/frontend/src/modes/annotate/constants/tagRegistry.js` - `sportEmoji(sport)`

### CRITICAL constraint - the landing site
`VideoControls` / `useStandaloneVideo` / `timeFormat` are imported by the **landing build** via the
`@editor` Vite alias and MUST stay **store-free** (memory: "Landing shares editor player").
**Any extracted primitive is imported by `VideoControls`, so the primitive must also be store-free**
and must live where the landing build can resolve it (i.e. under `components/shared/`, not under a
store-coupled folder). **Verify `src/landing` still builds** - T5130 confirmed exit 0 / 32 pages.

### Where the sport comes from for My Reels
`CollectionPlayer` is an author-side surface, so the sport is the active profile's:
`profiles.find(p => p.id === currentProfileId)?.sport` - the same read `ProfileSportButton.jsx` uses.
Resolve it in `DownloadsPanel` (or the CollectionPlayer's own app-side parent) and pass the glyph
down as a plain string, mirroring how `MediaPlayer` does it. **Do not read `profileStore` inside the
shared primitive.** Unknown sport -> plain dot, never a hardcoded soccer fallback (T5130 rule).

### Related Tasks
- **T5130** (the trigger) - added `handleGlyph` to `VideoControls`; surfaced the split. Its handle
  code is what gets extracted, so **this task must branch from the T5130 commit, not from a master
  that predates it**.
- **T4760** - the `py-2` transparent-hit-region pattern CollectionPlayer's bar uses; preserve it.
- **T5100** - compilation timeline hover/click, same player-polish family.

### Technical Notes
- Follow the project refactoring rules: **characterization tests before the structural change**;
  **strangler-fig** (introduce the primitive -> move one caller -> compare -> move the second ->
  delete the old code), never big-bang; **moves are mechanical commits** - code motion must not mix
  with behaviour change; keep reviewable units **under ~200 lines of meaningful diff**.
- `CollectionPlayer` segments are `<button>`s with per-segment `aria-label` and a hover tooltip;
  `VideoControls` is one container owning mouse/touch drag. **The interaction models genuinely
  differ** - share the *rendering*, do not try to unify the seek behaviour.
- Handle placement near a segment boundary can overflow into the `gap-1` between segments. Decide
  deliberately (clamp within the segment, or allow overflow) and state the choice.
- Keep drag-to-seek, hover sizing, and coarse-pointer targets byte-identical for `VideoControls` -
  it is the surface with the most existing behaviour to regress.

## Implementation

### Steps
1. [ ] Characterization tests pinning both bars' current rendered output + seek behaviour
2. [ ] Get the design gate answered: parameterize (recommended) vs converge visuals
3. [ ] Extract `ProgressTrack` (+ `PlayheadHandle`) into `components/shared/`, store-free
4. [ ] Move `VideoControls` onto the primitive - **no visual change**, characterization tests stay green
5. [ ] Move `CollectionPlayer`'s segments onto the primitive - no visual change
6. [ ] Add `PlayheadHandle` to CollectionPlayer's **active segment**; thread the active profile's
       sport from the app-side parent so My Reels shows the ball
7. [ ] Verify the `src/landing` build still compiles
8. [ ] Delete the superseded inline markup

## Acceptance Criteria

- [ ] One shared, **store-free** progress-track primitive; both players compose it
- [ ] **My Reels shows the sport-ball playhead** on the active reel segment (the T5130 gap closed)
- [ ] Ball reflects the active profile's sport; unknown sport -> plain dot, no soccer fabrication
- [ ] `VideoControls` behaviour unchanged: drag-to-seek, hover sizing, coarse targets, glyph-vs-dot
- [ ] `CollectionPlayer` behaviour unchanged: segment click-to-jump, hover tooltip, `py-2` hit region
- [ ] Visual treatment decision explicitly approved (no unapproved restyle of My Reels)
- [ ] `src/landing` build compiles (show the output)
- [ ] Characterization tests written BEFORE the move and green after; frontend unit suite green
- [ ] Real-browser verification at 375px and desktop, evidence per criterion

# Tutorial Redesign: guided essential path

**Status:** TODO (SEQUENCED AFTER all P1 bug fixes: upload-integrity epic + T7540 + T7580 + T7590)
**Started:** filed 2026-08-24
**Impact:** 9 | **Complexity:** 7 | **Priority:** 1.3

## Goal

Replace the current "watch a video" quest UI with an in-context guided tutorial that
walks a new user through the ESSENTIAL PATH of making a reel, using a modal shade +
bouncy arrow that anchors to the real UI element the user must touch next. User
directive 2026-08-24.

Why (evidence from the 2026-08-24 funnel analysis): the watch-a-video model demonstrably
does not transfer. Three mobile users COMPLETED the tutorial and stopped dead at the very
next step ("upload a game"); lisagee completed the quest chain and still never found reel
creation; cschwartz watched his game for 28 minutes across five visits and never saved a
clip. Users watch, then face the real UI alone and get lost. The redesign guides them ON
the real UI instead.

## Product requirements (user-specified 2026-08-24)

1. **Toggleable, default ON.** A user can turn the tutorial off and back on; new
   accounts start with it on. (A real preference, so persisting it is legitimate,
   gesture-based: the toggle click is the gesture.)
2. **Guides the essential path of making a reel**: upload a game -> open it -> create a
   clip (rate + save, including the tag field's Enter behavior) -> Framing (crop/follow
   the athlete) -> Create Reel (export) -> see it in My Reels -> share. Each step
   completes by the USER performing the real action, not by watching.
3. **Modal shade + bouncy arrow**: dim everything except the one element that advances
   the path; an animated arrow points at it. The user is funneled to the right action
   (escape hatch: the off toggle + a "not now" affordance; never a hard lock).
4. **Tested on all screen sizes**: 320px iPhone SE class through desktop, keyboard
   open/closed on mobile, per the responsiveness skill. The shade/arrow must anchor
   correctly across breakpoints and after layout shifts.

## Design constraints

- Motion is core product value (animation polish direction memory): the arrow bounce and
  shade transitions deserve real motion design, `prefers-reduced-motion` respected.
- The engine anchors to real DOM elements: it needs a robust target registry (stable
  data-tutorial-target attributes, NOT brittle selectors), a scroll-into-view step
  advance, and re-anchoring on resize/route change.
- Steps advance on the SAME gestures the app already persists; the tutorial itself
  writes nothing except its own on/off preference and current-step bookmark.
- Quest UI: the existing quest system remains for post-tutorial goals, but the
  tutorial's essential path replaces quest_1's watch-video steps; reconcile with the
  quest definitions rather than running two competing guides (design call in T7620).
- Tutorial assets contract (assets.reelballers.com) may become partially obsolete;
  T5140's reshot videos stay for the help surface (watching stays available as optional
  reference, no longer the primary mechanism).

## Tasks

| ID | Task | Status |
|----|------|--------|
| T7620 | [Architect design: guided-tour engine + step definitions](T7620-guided-tour-design.md) | TODO |
| T7630 | [Implement engine + essential-path steps](T7630-guided-tour-implementation.md) | TODO |
| T7640 | [Screen-size matrix verification + quest reconciliation + rollout](T7640-screen-size-matrix-rollout.md) | TODO |

## Sequencing

After ALL P1 bug fixes, explicitly: the guided path walks users straight into upload and
clip-save, so shipping it while uploads fail (T7480), failed uploads destroy work
(T7470), Save can dead-end (T7540), and the mobile entry point is broken (T7590) would
guide users INTO the walls. T7580's "Create Reel" language should also land first so the
tutorial and the chrome say the same words.

## Completion Criteria

- [ ] New user with tutorial on is walked element-by-element to a published reel
- [ ] Toggle off/on works and persists; default on for new accounts
- [ ] Verified at 320/375/428/768/1280px, mobile keyboard open/closed, reduced motion
- [ ] Quest UI reconciled (no competing guidance)

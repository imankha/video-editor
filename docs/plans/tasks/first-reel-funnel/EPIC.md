# First Reel Funnel (walkthrough remediation)

**Status:** TODO
**Started:** -
**Created:** 2026-09-03

## Goal

Ship the user-approved fixes from the 2026-09-02 first-time-parent staging walkthrough
([artifact](https://claude.ai/code/artifact/79e0afa6-666f-44ea-9e42-7c39939e3e2e), UX
designer expert review included) so that a brand-new soccer parent can get from landing
page to a shared reel without hitting the reproduced cliff-1 and cliff-4 failures.
Prod ground truth this epic answers (2026-08-27 drop-off refresh): 50% of users never
start an upload, and NO real user has ever exported a reel.

## User decisions recorded at filing (2026-09-03)

1. The first-session "Update now" interstitial is a bug. The user should NEVER need to
   click update; update silently and report progress while it happens (T8460).
2. Reel is NOT on by default globally. Below 4 stars a play is probably not reel-worthy.
   Instead: communicate what the stars mean, and at 5 stars the Reel toggle defaults ON
   (T8490). **Spec-time correction (2026-09-03): the 5-star auto-enable ALREADY EXISTS**
   (AnnotateFullscreenOverlay.jsx:476 - rating 5 + My Athlete layer flips the switch on;
   explicit user toggle wins; covered by layer tests). T8490 is therefore a
   COMMUNICATION task (star-scale caption, label the !/!! badges, Keeper Save rename),
   not a behavior change - the walkthrough misread its own toggling as a default-off.
3. Focus staying disabled after a reel exists is a bug: if a reel has been created, Focus
   must be enabled and working. Add a toast: "Reel started, click Focus to complete"
   (T8480).
4. Export buttons sometimes sit below the scroll line; test at mobile sizes (T8550, and
   every task in this epic includes a 390px check in its acceptance criteria).
5. Autotracking on the Focus screen is explicitly OUT of scope for now. The unframed
   export guard and progress-honesty fixes stay in (T8510).
6. Everything else in the walkthrough report is approved as proposed.

## Tasks

Row order = intended execution order (bugs first, then flow, then polish).

| ID | Task | Status |
|----|------|--------|
| T8460 | [Silent app update, no blocking interstitial](T8460-silent-app-update.md) | TODO |
| T8470 | [One status story for a reel (created = visible)](T8470-reel-status-one-story.md) | TODO |
| T8480 | [Focus unlocks the moment a reel exists](T8480-focus-unlocks-on-reel.md) | TODO |
| T8490 | [Add Play sheet: star semantics + 5-star reel default](T8490-star-semantics-reel-default.md) | TODO |
| T8500 | [Add Game: video first, cost up front](T8500-add-game-video-first.md) | TODO |
| T8510 | [Export guard + progress honesty](T8510-export-guard-progress-honesty.md) | TODO |
| T8520 | [Overlay is an offer, not a stage](T8520-overlay-optional-skip.md) | TODO |
| T8530 | [Done means done: auto-advance finished reels](T8530-auto-advance-finished-reel.md) | TODO |
| T8540 | [Share is the primary player action](T8540-share-primary-player-action.md) | TODO |
| T8550 | [Mobile CTA visibility sweep](T8550-mobile-cta-visibility-sweep.md) | TODO |
| T8560 | [Persistent journey stepper (design gate)](T8560-journey-stepper-design.md) | FOLDED - folded into T7620/T7630 (Round 3), see T8560-design.md |

## Vocabulary constraint (binding)

The walkthrough counted six words for one object (annotation, clip, reel, project, draft,
ready). The expert proposed "Highlight"; however the First-Clip Funnel epic already locked
Plays -> Clips -> Highlight Reels (T8130, user-approved 2026-08-31), and T8260 carries a
reconciliation clause. This epic does NOT introduce a new noun. It unifies STATUS only:
a reel is "Draft" from the second it is created until it is shared, then "Shared". Kill
"Not Started", "Ready", "Complete", and the "Project #N" toast label. Any task here that
touches vocabulary must reconcile with T8130's table and T8260, never overwrite them.

## Interactions with in-flight work

- T8390 (Focus publish exit) and T8400 (publish lands on the reel) are tutorial-redesign
  prerequisites covering the same journey tail. T8530/T8540 must coordinate: T8400 lands
  the user ON the reel; T8530 removes the manual "Move to Highlight Reels" gesture that
  T8400's landing assumes is gone; T8540 gives the landing surface its Share button.
  Whichever lands second rebases on the first.
- T8360 (split single vs multi-clip drafts, merged 2026-09-02) reshaped the Highlight
  Reels drawer; T8470's drawer changes build on that IA.
- The Tutorial Redesign guided path ships AFTER this epic (user order 2026-09-03: this
  epic starts next; the tutorial group's standing rule is that UI-visible work lands
  before the tutorial is built on top of it). **T8560 resolved 2026-09-03: FOLDED into
  T7620/T7630** rather than built standalone - the stepper is T7620's already-approved
  5-rung goal ladder, unnamed and only half-drawn (see T8560-design.md). This epic ships
  with no journey-stepper code of its own; the named-rungs + full-map amendment lands
  inside T7630 instead.

## Completion Criteria

- [ ] A fresh account can go landing page -> shared reel with zero dead ends: no update
      wall, no invisible reel, no locked Focus, no manual Move, Share visible in the player.
- [ ] The three-way status contradiction ("Reel created!" / "Not Started" / "No reels
      yet") is impossible to reproduce.
- [ ] No export can be started on a clip with zero user keyframes.
- [ ] Every primary CTA in the flow is visible without scrolling at 390x844.
- [ ] Walkthrough re-run (same persona script) passes end to end on staging.

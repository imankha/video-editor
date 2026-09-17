# T10320: Re-bake instructions and reshoot the tutorial videos for the new flow and vocabulary

**Status:** TODO (decision-gated, see Problem)
**Impact:** 7
**Complexity:** 5
**Created:** 2026-09-17
**Updated:** 2026-09-17

## Problem

User, 2026-09-17: "re-film tutorial videos and redeploy. The flow has changed and vocabulary has
shifted. We don't use 'reels' anymore and 'My Reels' has become 'Published'. Go through the full
site to re-bake instructions, then reshoot. Make sure the new video is accessible from tutorial
and site."

**Conflict to resolve first.** The Tutorial Redesign epic carries a binding 2026-08-31 directive:
"No more tutorial videos. The guided branches must cover EVERYTHING the videos covered ... The
videos are removed as a mechanism, not demoted", and the approved T7620 design (§12, §20) retires
the in-app player (`TutorialVideoModal.jsx`, `tutorialVideos.js`, `WatchTutorialButton`) in T7630;
T8690 already hid the four watch-video quest steps behind `TUTORIAL_VIDEOS_ENABLED=false`. The
design's D6 keeps only the LANDING site's `TutorialModal.tsx` + R2 assets. The new ask puts videos
back in the app ("accessible from tutorial"). Per `feedback_external_review_can_override_recent_
decisions`: surfaced with dates, the user decides. The two coherent outcomes:

- **(1) Landing-only reshoot (matches the approved design):** reshoot the four videos for the
  landing site's `TutorialLauncher` (hero "Watch the full walkthrough", learn/elevate/celebrate),
  in-app stays video-free, Help panel does not link them.
- **(2) Videos return in-app as a Help-panel link (amends the design):** keep `TutorialVideoModal`
  alive (T7630 must not delete it), mount it from the new `HelpPanel` ("Watch the walkthrough")
  instead of quest steps, flip `TUTORIAL_VIDEOS_ENABLED` back on for that surface only. Reshoot
  AFTER T7630 ships so the videos show the Help overlay users will actually see.
  Note: the video gate is mirrored server-side (T9410: `quest_config.py:44` +
  `routers/quests.py:198-204`, tests `test_t9410_tutorial_step_gating.py`), and both flags are wired to
  the quest checklist the redesign deletes. So (2) must NOT resurrect the `watch_*_tutorial` quest
  steps; the Help panel gets its own entry point and the old flags stay off / get deleted with the panel.

Vocabulary drift since the 2026-08-17 shoot (T5140) is far larger than "reels -> Published":
My Reels -> Published; Add Clip -> Mark play; Focus/AI Focus -> Framing (T9860 reversed T7700);
Playback Annotations -> Preview plays; Add Spotlight (render) -> Export clip with effects;
Highlight Color / Body / Ground -> Spotlight color / Around athlete / Under athlete; Thumbnail ->
Cover image; My Athlete toggle -> Play category; Create Reel toggle -> Save play / Save and Frame
(T10290); Add Game -> Upload game / Upload clip; Build New Reel -> Create reel; Stroke Width /
Fill / Outside Dim -> Outline thickness / Spotlight fill / Dim background; plus the four-tab IA
(Games / Clips / Reels / Published), the four-choice publish bars (T9590), "Pick your athlete"
(T9620), and every Deploy Candidate copy change (T10280/T10290). Canonical source:
`src/frontend/src/config/displayNames.js`.

## Solution

Clone T5140's structure (`docs/plans/tasks/T5140-reshoot-tutorial-videos.md`, DONE 2026-08-17):
Part 1 talk tracks rewritten against `displayNames.js` + the shipped screens; Part 2 per-video
UI-drift table (what changed on screen since the last shoot); Part 3 TTS; Part 4 capture spec.
Producer pipeline is outside this repo (`C:\Users\imank\Videos\Captures\ReelBallersTutroials`,
`workflow/contract.py`, `upload_r2.py`, `verify_assets.py`; assets at `assets.reelballers.com`
`tutorials/{annotate,framing,overlay,publish}.{mp4,vtt,chapters.vtt}`). Sequence: **after** every
UI task in the Deploy Candidate has landed on staging (T10280/T10290/T10310 and, for outcome 2,
T7630), otherwise the videos are stale on release day (the T5140 lesson).

"Accessible from the site": already true via `src/landing/src/components/TutorialLauncher.tsx`
(index.astro:122/191/209/230, how-it-works.astro:108-157); fix the minor drift in
`tutorials.ts:29-30` titles and the two `aria-label`s that still say "Framing and Highlights".
Also closes T3300 (tutorial video landing page, TODO) if the user wants a dedicated page.

## Context

### Relevant Files
- `src/landing/src/config/tutorials.ts`, `components/TutorialModal.tsx`, `TutorialLauncher.tsx`,
  `pages/index.astro`, `pages/how-it-works.astro`
- In-app (outcome 2 only): `src/frontend/src/components/TutorialVideoModal.jsx`,
  `config/tutorialVideos.js`, `stores/useTutorialStore.js`, `config/questDefinitions.jsx:50`,
  `src/backend/app/quest_config.py:44`, `routers/quests.py:198-204`
- `docs/plans/tasks/tutorial-redesign/EPIC.md` (2026-09-17 directive section), `T7620-design.md` §12/§20

### Related Tasks
- Blocked by: the user's outcome (1)/(2) decision; T10280, T10290, T10310 on staging; T7630 for (2)
- Related: T3300 (tutorial video landing page), T5140 (previous reshoot, template)

## Acceptance Criteria

- [ ] Decision (1) or (2) recorded in the tutorial-redesign EPIC.md with the date
- [ ] Talk tracks re-baked against `displayNames.js`; zero retired nouns in the VTT
- [ ] Four videos + captions + chapters re-uploaded and verified (`verify_assets.py`)
- [ ] Reachable from the landing site launcher; for (2) also from the in-app Help panel

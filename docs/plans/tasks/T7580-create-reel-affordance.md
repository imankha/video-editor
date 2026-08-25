# T7580: Users do not recognize that Framing -> Export IS reel creation

**Status:** WIP
**Priority:** P1 (the 100% export cliff; cheapest high-leverage fix outside the bugs)
**Impact:** 8
**Complexity:** 3
**Created:** 2026-08-24
**Updated:** 2026-08-24

## Problem

No real user has ever exported a reel (0 final_videos, 0 export_jobs across all 15
non-team prod profile DBs, verified 2026-08-24). The clearest evidence this is a
NAMING/AFFORDANCE failure rather than disinterest is lisagee1443 (2026-06-13): 13 clips,
15 projects, 39 working_clips, opened Framing 4-5 times, completed the quest, changed an
aspect ratio, backed out, and filed bug report #21:

  "There's no way to create a reel, tag my athlete, use AI to follow my athlete, or
  anything else that I was told this website could do. I can create clips, but they can't
  be converted into a reel. There is no point to this website"

She was INSIDE the reel-creation flow when she wrote "there's no way to create a reel."
The product never says the word "reel" at the moment it matters, and the landing-page
promises she arrived with (tag my athlete, AI follows my athlete = spotlight/crop-follow)
have no recognizable on-screen counterpart vocabulary.

## Solution

A focused language + affordance pass on the essential path, NOT a redesign (the Tutorial
Redesign epic handles guidance; this makes the surfaces self-explanatory even with the
tutorial off):

1. **Name the goal where the user stands.** The path Clips -> Framing -> Export must
   speak "reel": e.g. the primary CTA in Framing/Overlay reads "Create Reel" (or
   "Export Reel"), the project-level affordance reads "Turn these clips into a reel",
   and the success state says "Your reel is ready" pointing at My Reels. Exact copy via
   the ui-designer agent against the existing style guide; the principle is the word
   "reel" appears at every step of the chain that builds one.
2. **Bridge the marketing vocabulary.** "Tag your athlete" and "focus follows your
   athlete" (brand voice: focus, never camera) need visible counterparts where those
   features live (spotlight/crop = "follow your athlete"). Audit landing-page promises
   (src/landing) against in-app labels and close the vocabulary gaps.
3. Instrument nothing new here (T7510 owns outcome analytics); this task is copy,
   labels, and CTA placement only. Keep the diff small and reviewable.

## Context

### Relevant Files
- Framing/Overlay export CTAs (FramingScreen/OverlayScreen containers + export buttons)
- Project manager / drafts surfaces (where "make a reel from these clips" should be said)
- `src/landing/` value-prop copy (audit source, likely not edited here)
- `.claude/references/ui-style-guide.md`

### Related Tasks
- Tutorial Redesign epic (guided path says the same words; this task works tutorial-off)
- T7510 (will measure whether the export cliff moves)
- Marcom focus positioning (memory: focus-not-camera brand voice binds word choice)

## Acceptance Criteria

- [ ] The word "reel" appears at each step of the clip->reel chain (inventory in PR)
- [ ] ui-designer-approved copy; user approves the wording set before merge
- [ ] Landing-promise vocabulary audit table (promise -> in-app counterpart) in the PR
- [ ] Real-browser screenshots at mobile + desktop widths

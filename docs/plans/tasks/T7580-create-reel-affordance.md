# T7580: Users do not recognize that Framing -> Export IS reel creation

**Status:** STAGING
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

## Progress Log

### 2026-08-25 — Copy inventory + vocabulary audit (WORDING-APPROVAL GATE — awaiting user)

**Key mechanical finding (verified in code):** the Framing->Export chain uses ONE shared
primary button (`ExportButtonView.jsx:138-145`) with a two-step export:
- In **Framing** mode the button says **"Export"** — but it does NOT finish a reel; it
  renders the crop/upscale and *advances the user to Overlay* (`onProceedToOverlay`).
  Overlay is mandatory (no skip path found).
- In **Overlay** mode the same button says **"Add Spotlight"** — this is the click that
  actually renders the *finished reel* into My Reels.

So the button that completes the reel is labeled "Add Spotlight," and neither export step
says "reel." This is precisely the reported confusion (user #21 / lisagee1443 was inside
this exact flow when she wrote "there's no way to create a reel").

**What already says "reel" (leave as-is):** Annotate entry "Create Reel" toggle +
"Create Reel from Clips" modal; drafts surface "Reel Drafts" / "Move to My Reels" /
"Delete reel"; library "My Reels". The gap is concentrated in the Framing/Overlay export
CTAs + the success/progress messages.

**Second genuine gap:** the landing promise "focus follows your athlete" / "the crop
follows them" has NO in-app counterpart — the Framing crop-follow feature is unlabeled
(no "follow" string anywhere in `FramingModeView.jsx`).

#### Proposed wording set (ui-designer-approved; all are string swaps in existing slots)

| # | Location | Current | Proposed (recommended) | Alternatives |
|---|----------|---------|------------------------|--------------|
| 1 | Framing CTA `ExportButtonView.jsx:143` | `Export` / `Export (X/Y)` | **`Next: Spotlight`** / `Next: Spotlight (X/Y)` | `Frame & Continue`; `Continue to Spotlight` (longer) |
| 2 | Overlay CTA `ExportButtonView.jsx:144` | `Add Spotlight` | **`Create Reel`** | `Finish Reel`; `Export Reel` |
| 3 | Success msg `ExportButtonView.jsx:231` | `Export complete! View in My Reels.` | **`Reel ready! Find it in My Reels.`** (keeps `${SECTION_NAMES.LIBRARY}` token) | `Reel ready! View in My Reels.` |
| 4 | Export-info subtext `ExportButtonView.jsx:103` | `Renders crop/trim/speed with AI upscaling at {fps}fps` | **`Builds your reel: applies your follow-framing, trim, and speed, upscaled with AI at {fps}fps.`** | terser: `Renders your reel — follow-framing, trim, and speed, AI-upscaled at {fps}fps.` |
| 5 | Exporting states `ExportButtonView.jsx:139` | `Exporting...` / `Export in progress...` | **`Creating reel...`** / **`Reel in progress...`** | — |
| 6 (optional) | Framing Settings subtitle under `ExportButtonView.jsx:84` | (none) | add one `text-xs text-gray-400` line: **`Set crop keyframes so the focus follows your athlete.`** | omit (rely on #4 alone for the follow-framing bridge) |

Design rationale for the two contentious buttons:
- **#1 Framing button** must NOT claim the reel is done (it advances to Overlay), so it
  previews the next step ("Next: Spotlight"). It trades the literal word "reel" on this
  button for honesty; "reel" is still carried at this step by subtext #4.
- **#2 Overlay button** IS the reel producer, so it says "Create Reel" — bookending the
  flow with the Annotate-entry "Create Reel" wording, the most literal answer to "how do
  I create a reel." "spotlight" is not lost: it survives in `#1` and in
  `OverlaySettingsCard` ("Ground spotlight", "Body ellipse").

#### Landing-promise -> in-app-counterpart audit

| Landing promise | Current in-app | Proposed |
|---|---|---|
| "turn footage into highlight reels" | Framing `Export`; Overlay `Add Spotlight`; success `Export complete!` — no "reel" | #1 `Next: Spotlight`; #2 `Create Reel`; #3 `Reel ready!...`; #5 `Creating reel...` |
| "focus follows your athlete" / "crop follows them" / "follow-framing" | NO label on crop-follow (genuine gap) | #4 subtext "...applies your follow-framing..."; optional #6 subtitle "...the focus follows your athlete." |
| "spotlight" | `Add Spotlight` btn + OverlaySettingsCard | bridge already exists; #1 previews it; word survives settings card after #2 rename |
| "tag your athlete" | Annotate `Tags` label | OUT OF SCOPE (not in Framing->Export chain); flagged as small follow-up |
| entry "Create Reel" / drafts "Reel Drafts" / "My Reels" | already say "reel" | leave as-is |

#### Style-guide notes
- Buttons stay Title Case (match `Create Reel`/`Move to My Reels`); helper/success/progress
  stay sentence case. Longest string is `Next: Spotlight (X/Y)` — fits the full-width `lg`
  primary button at 375px but is the one to eyeball in the mobile screenshot pass.
- Keep `${SECTION_NAMES.LIBRARY}` token in #3 (no hardcoded "My Reels").
- Flag (NOT in this task): the primary button uses the `Download` icon in both modes;
  after the rename neither reads as a "download". Icon change edges into visual redesign —
  leave as an optional follow-up.

#### Open questions for the user (please confirm before implementation)
1. **Framing button (#1):** approve `Next: Spotlight`? It deliberately does NOT say "reel"
   (honest: it advances to the spotlight step, doesn't finish the reel). If you require the
   literal word "reel" on every button, say so and I'll use e.g. `Continue Reel` instead —
   but that reads weaker and slightly misleads on finality.
2. **Overlay button (#2):** `Create Reel` (bookends Annotate entry) vs `Finish Reel` vs
   `Export Reel`?
3. **Optional #6 subtitle** under "Framing Settings" — include it, or rely on the #4
   subtext alone to carry "follow-framing"?
4. Anything to add/trim in the success (#3) and progress (#5) wording.

**STATUS: BLOCKED on wording approval — no implementation code written yet.**

### 2026-08-25 — Wording APPROVED by user; implemented + QA (PUSHREADY)

User approved the recommended set: #1 `Next: Spotlight`, #2 `Create Reel`, #6 subtitle
included, success/progress messages as proposed. Applied all 6 swaps + the subtitle in
`src/frontend/src/components/ExportButtonView.jsx` (copy-only; no layout/behavior change).

- Tests: added a `T7580 reel vocabulary` describe block to `ExportButtonView.test.jsx`
  (8 cases: Framing `Next: Spotlight` + `(2/3)` suffix, Overlay `Create Reel`, both
  in-progress variants, success `Reel ready!...`, the follow-your-athlete subtitle +
  follow-framing subtext) and flipped the old Overlay-label assertion. Relevant set run:
  34 unit tests pass (14 ExportButtonView incl. the 8 new + 20 ExportButtonContainer);
  eslint 0 errors.
- e2e: updated locators that drove the renamed buttons (T4880, T4110, T4900,
  tutorial-capture framing/overlay, screenManifests) so Branch CI's full e2e sweep still
  targets the live labels. (E2E not runnable in this container — no backend/browser CDN.)
- QA: real Chromium screenshots of the actual `ExportButtonView` (real Tailwind) in all
  four copy states at mobile 375px + desktop 1280px, saved to `qa/T7580/` (gitignored
  evidence). Verified `Next: Spotlight (2/3)` fits the full-width mobile button; all new
  strings render in context with no overflow.

Note for reviewer: the two-step export button uses the `Download` icon in BOTH modes;
after the rename neither reads as a "download" and the Framing one is really a "next
step". Icon change edges into visual redesign, so it was intentionally left out of this
copy-only task — flagged as an optional follow-up.

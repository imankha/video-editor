# T7660: Sample-game first win: clip + Create Reel in minute one, before any upload

**Status:** TODO (post-P1; user 2026-08-24: "not priorities given the clear user
blocking issues" - sequenced with/after the Tutorial Redesign epic)
**Impact:** 8
**Complexity:** 5
**Created:** 2026-08-24

## Problem

Every ReelBallers user must clear the funnel's hardest step (a 1-4GB upload) before
seeing ANY finished output. The 2026-08-24 research review named this the plan's biggest
gap: CapCut's most successful activation mechanic is a near-zero-skill first finished
video (templates: user only supplies media), and onboarding evidence shows pre-seeded
demo content cuts time-to-value harder than visual redesigns (empty states are a
documented silent drop-off point). Our measured cliffs (50% never start an upload; 75%
of uploaders never save a clip) are all downstream of "nothing to practice on."

## Solution direction (design with Tutorial Redesign)

Bundle a short sample game clip (30-60s of real soccer footage we own) available to
every new account, so a user can: open the sample -> save a clip -> hit Create Reel ->
see a finished reel in the first minutes, before or WHILE their own game uploads. The
guided tutorial (T7620-T7640) can run its clip/reel mini-tours against the sample, fully
decoupling learning from the upload cliff. Design questions for T7620 to absorb: does
the sample reel pollute My Reels (probably a clearly-labeled sample, deletable), does it
consume credits (no), does the sample game expire (no), and does it appear for existing
accounts or only new ones.

## Context

- Coordinate with tutorial-redesign/EPIC.md (T7620 design should treat the sample as
  the tutorial's practice surface); tutorial assets contract for hosting the sample.
- Storage: one shared global asset (games/-style env-free key or bundled static),
  never per-user copies.

## Acceptance Criteria

- [ ] New user can produce a finished (sample) reel with zero uploads
- [ ] Sample clearly labeled, deletable, credit-free, non-expiring
- [ ] Tutorial mini-tours can target it

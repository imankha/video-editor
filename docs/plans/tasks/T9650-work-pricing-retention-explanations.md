# T9650: Align the work, pricing and retention explanations across public and signed-in surfaces

**Status:** TODO
**Impact:** 5
**Complexity:** 4
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 first-time-parent walkthrough of **staging** (`reel-ballers-staging.pages.dev`),
run in a Codex in-app desktop browser, plus Andrew's supplied feedback and screenshots.
Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
(`05-engineering-handoff.md`, bugs `01-bugs.html`, UX specs `04-ux-change-specifications.html`,
naming `03-naming-consistency.html`). Handoff item(s): **UX-01, UX-03 (handoff E3-04)**.

The walkthrough uploaded `wcfc-carlsbad-trimmed.mp4` (45.8 MB, 1:29), saved two rated/tagged
plays (0:03-0:09 Control/Pass, 0:13-0:19 Dribble), framed and rendered a six-second highlight,
applied a spotlight and saved a private draft. Balance moved 88 -> 79 credits. No purchase,
invite or publication was performed, so publish/link-access behavior is UNVERIFIED, not proven
working. No source-code or network diagnosis was done by the reporter: every claim below is an
observation, and the mechanism is ours to establish.

## Problem

A parent can see the visual benefit but may still confuse **marking plays** (their work) with
**automatic tracking** (the app's work), and cannot predict what a first clip costs. The public
homepage and the signed-in account currently use **different free-credit wording**, which the
handoff explicitly flags as needing verification before anything is filed as a billing bug.

## Solution

- Keep the existing website demonstration and sign-in flow. **Do not** introduce a sample-game
  prerequisite, an email objection or a new sign-in screen - all three were explicitly removed from
  the recommendations.
- Add one short division-of-work explanation near the existing start action: you mark the plays,
  then frame your player, add a spotlight, and share.
- Add a **policy-accurate** cost example that uses the same rules as the displayed account estimate.
- State source, draft and published retention consistently in both places.

## Context

### Relevant Files
- `src/landing/` - the Astro marketing site (separate deploy: `/deploy-landing`)
- Signed-in credit and retention copy (`displayNames.js`, Add Game modal)

### Related Tasks
- **Depends on T9680** for the confirmed credit and retention contracts. **No placeholder policy
  copy ships** - that is the whole point of the dependency.
- T9530 / T9560 - vocabulary for these surfaces

### Technical Notes
Two deploys: the landing site and the app ship separately. Sequence so the two never disagree in
public, even briefly.

## Acceptance Criteria

- [ ] Copy distinguishes marking plays from framing and automatic following
- [ ] One cost example uses the same rules as the displayed account estimate
- [ ] Retention explanation covers the source and both draft and published outputs
- [ ] Public and signed-in surfaces state the same free-credit rules
- [ ] No placeholder policy copy ships
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green

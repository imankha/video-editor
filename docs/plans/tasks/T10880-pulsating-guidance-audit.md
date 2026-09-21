# T10880: Pulsating Next-Action Guidance — Funnel Playthrough Audit

**Status:** TODO
**Impact:** 5
**Complexity:** 2
**Created:** 2026-09-21
**Updated:** 2026-09-21

## Problem

The editor never visually anticipates what the user should do next. In Spotlight (Focus mode's
player-detection tracking boxes), when the user hasn't clicked any detection box yet, there's no
signal pointing at the one they should click first — they have to figure it out themselves. That's
one instance of a broader gap: at several points in the funnel (Annotate -> Focus -> Overlay ->
Gallery) the app already knows the single best next action for a given state, but doesn't draw the
eye to it. Users who don't find the next step stall out before creating clips, before spending
their free credits, and before ever reaching a paywall moment.

## Solution

Not scoped for implementation yet. This task is a **full playthrough audit**: go through the
product end to end as a first-time user and a returning user, and at each screen ask "does the app
currently know what the user should click next, and if so, is that made visually obvious?" Wherever
the answer is "we know, but we don't show it," record it as a candidate spot for a pulsating (or
similarly attention-drawing) affordance on the recommended next element, in priority order by how
much it likely moves users toward creating a clip, spending free credits, and converting to a paid
plan.

**Concrete seed example (Spotlight / Focus mode):** when the user is in Spotlight and hasn't
clicked any of the player-detection tracking boxes yet, the next one they should click — starting
with the first — should pulsate.

Output of this task is a written list of candidate locations (screen, element, trigger condition,
why it matters for the funnel) for the user to prioritize into follow-up implementation tasks. No
code changes in this task.

## Context

### Relevant Files (REQUIRED)
None yet — this is a research/audit task. The playthrough will touch Annotate, Focus (Spotlight
detection boxes specifically), Overlay, and Gallery screens; relevant files get listed in the
follow-up implementation task(s) this audit produces.

### Related Tasks
- None yet. This task is expected to spawn follow-up implementation tasks per identified location.

### Technical Notes
- Per [AI capability copy accuracy](../../../.claude/knowledge/) guidance (see CLAUDE.md feedback
  memory `feedback_ai_capability_copy_accuracy`), pulsing must only ever highlight a *recommendation*
  the user still acts on themselves — never imply the app is auto-selecting/auto-tracking for them.
- Should reuse one shared visual/animation primitive for "this is the recommended next thing,"
  not a bespoke pulse per screen, once locations are chosen (avoid N one-off implementations).
- Ties into the existing monetization funnel: create clip -> spend free credits -> hit paywall.
  Frame each candidate location by which funnel step it targets.

## Implementation

### Steps
1. [ ] Playthrough as first-time user (empty state) noting every screen's "obvious next action"
2. [ ] Playthrough as returning user (existing games/clips) noting the same
3. [ ] For each screen, confirm the code already has the information needed to compute the
      recommended next element (vs. would require new logic) — flag ones needing new logic
      separately since they're higher complexity than pure-CSS pulse additions
4. [ ] Write up ranked candidate list (screen, element, condition, funnel step, rough complexity)
5. [ ] Present to user for prioritization into follow-up tasks

### Progress Log

**2026-09-21**: Task filed from a user observation during a Focus/Spotlight session (screenshot
showed unclicked tracking-box markers with no visual cue for which to click next). Scope
deliberately kept to audit-only since the user was near a token budget limit; no implementation
started.

## Acceptance Criteria

- [ ] Full playthrough completed and documented (first-time + returning user paths)
- [ ] Ranked list of candidate "pulsate the recommended next action" locations delivered to the user
- [ ] Spotlight/Focus detection-box case explicitly included in the list
- [ ] No code changes made under this task; follow-ups filed separately per chosen location

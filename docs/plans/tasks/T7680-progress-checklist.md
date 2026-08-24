# T7680: Persistent progress checklist (upload -> clip -> create reel)

**Status:** TODO (post-Tutorial-Redesign; user 2026-08-24: not a priority)
**Impact:** 5
**Complexity:** 3
**Created:** 2026-08-24

## Problem

The guided tour (tutorial-redesign epic) is skippable by design (evidence: skippable
tours complete ~25% better), which means skippers lose all guidance. The 2026-08-24
research review recommends a complementary persistent checklist: a small always-visible
upload -> clip -> create reel progress element that survives tour skips (products using
checklists report ~40% activation vs the 25-30% norm; small companies see the best
checklist completion).

## Solution direction

A compact checklist chip/panel on the home surface showing the three essential-path
steps with real completion state (derived from durable data: has a ready game, has a
clip, has a reel - never from milestones, per T7510's lesson). Clicking a step routes to
that surface (and can invoke the matching tutorial mini-tour if enabled). Disappears
after first reel (or collapses into nothing once complete). Replaces whatever remains of
quest_1's essential-path presentation after T7640's reconciliation.

## Context

- Sequenced AFTER the Tutorial Redesign epic ships (T7640 decides quest reconciliation;
  this builds on it). Derivation from durable rows only - no new persisted state beyond
  a dismissed flag (gesture-written).

## Acceptance Criteria

- [ ] Checklist state derives from durable data only
- [ ] Survives tour skip; links into each step's surface
- [ ] Disappears/collapses after first reel

# T9570: Cross-surface naming audit

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **N01-N47, UX-18 (handoff E1-03)**.

> Child of the [Shared Vocabulary epic](EPIC.md). The epic's two binding overrides apply:
> mode names stay **AI Focus** / **Spotlight** (N16/N18 overridden), and statuses are not
> re-modelled (N22 overridden, T8470's Draft/Shared stands). Internal APIs, routes, store keys and
> analytics vocabulary are never renamed for UI consistency.

## Problem

Feature tasks implement their own surfaces, so nothing guarantees the *seams* agree: a button in one
task, its toast in another, its destination heading in a third. This task owns the closing audit so
47 naming groups do not become 47 independent tickets duplicating feature work.

## Solution

1. Walk all 47 groups against the shipped code. Mark each **applied**, **overridden** (with the
   reason and the deciding task), or **not applicable**.
2. Verify the seams specifically: primary action -> success toast -> destination heading -> tutorial
   wording, for each of the main flows.
3. Audit **both** normal and fullscreen modes (N47), and accessible names as well as visible text.
4. Report leftovers rather than silently fixing anything large - a finding that needs real work gets
   its own task.

## Context

### Relevant Files
- `src/frontend/src/config/displayNames.js`, `emptyStates.js`, `questDefinitions.jsx`
- The naming report table (`03-naming-consistency.html`, N01-N47) as the checklist

### Related Tasks
- Depends on: T9520, T9530, T9540, T9550, T9560 (every other child)
- Feeds T9730's traceability sign-off

### Technical Notes
Search the codebase for **every observed variant** in the report's table, not just the recommended
replacements - the point is to find the stragglers the feature tasks missed.

## Acceptance Criteria

- [ ] All 47 groups are marked applied, overridden with reason, or not applicable
- [ ] A Clips menu never says Delete reel
- [ ] Every completion message identifies its completed stage
- [ ] All first-time guide labels match the actual controls
- [ ] Normal and fullscreen modes share one action vocabulary
- [ ] Accessible names were audited alongside visible text
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green

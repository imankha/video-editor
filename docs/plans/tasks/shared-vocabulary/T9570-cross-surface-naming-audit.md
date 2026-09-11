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

## Handoff from T9560 (2026-09-11)

Recorded here so the cross-audit can reconcile them without re-deriving:

- **N45 (Report not sent / Retry report) — ALREADY SATISFIED by T9400.** Verified live in
  `ReportProblemButton.jsx` (`Report not sent`, `Retry report`). Mark applied; do not re-implement.
- **N47 (fullscreen control parity) — ALREADY SATISFIED by T9500.** A full parity pass unified
  normal/fullscreen controls. Mark applied; do not re-audit.
- **UX-01 (landing copy) — DEFERRED, blocked on T9680 (still TODO).** T9560 deliberately shipped no
  `src/landing/` copy ("no landing copy ships ahead of T9680's confirmed rules"). This satisfies
  T9560's criterion; the landing copy itself is T9650/T9680 territory.
- **N34/N38/N39/N40 — APPLIED by T9560.** "Getting started" is the one onboarding name; the backend
  claim error now reads `Step not complete: "{visible task}"` (raw step id kept only in the
  structured `step_id` diagnostic field); `playback_annotations` reuses `ANNOTATE.PREVIEW_PLAYS`;
  sharing controls split action (`Share plays`) vs state-neutral (`Sharing settings`).
- **Two residual "quest" words the audit should sweep (T9560 left them as out-of-scope):**
  1. `QuestPanel.jsx` success toast still reads `Quest complete!` / `more quests await!` — the only
     place the user still meets the word "quest" on the SUCCESS path (N39 targeted the failure path,
     which is fixed). Decide: reword (e.g. "Step complete!") or record as an accepted internal-noun
     exception.
  2. Backend `quest_config.STEP_TITLES["move_to_my_reels"]` hardcodes `"Move to Highlight Reels"`
     where the frontend derives it from `SECTION_NAMES.LIBRARY`. They agree today; flag as a
     manual FE/BE sync point so a future `LIBRARY` rename doesn't drift the backend error copy.

## Acceptance Criteria

- [ ] All 47 groups are marked applied, overridden with reason, or not applicable
- [ ] A Clips menu never says Delete reel
- [ ] Every completion message identifies its completed stage
- [ ] All first-time guide labels match the actual controls
- [ ] Normal and fullscreen modes share one action vocabulary
- [ ] Accessible names were audited alongside visible text
- [ ] Relevant test set (curated ~10, per CLAUDE.md Test Scope Policy) green, with output attached
- [ ] Branch CI green

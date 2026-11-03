# T14780: Step names say the parent's goal

**Status:** TODO
**Impact:** 6
**Complexity:** 3
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

User rule (2026-11-03): "Our wording has to resonate with the users motivations at every opportunity" (glossary style rule 12 in [copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md)). The user rejected "Frame play" because a parent does not know what framing is.

The editor header names the steps **Mark plays / Frame / Spotlight** (`MODE_SWITCHER_NAMES` in `src/frontend/src/config/displayNames.js` ~L285), with **Finish** as the last step and `MODE_NAMES` nouns (`'Mark Plays'`, `'Framing'`, `'Spotlight'`) in status text, progress strips and tiles. "Frame" and "Spotlight" are tool words: a first-time parent may not know that Frame is where they keep their athlete in the picture, or that Spotlight is how people spot which kid is theirs. The landing site and guide lines repeat these names.

## Solution

1. Propose goal-first names for each step and each place the step name shows (header tabs, locked-tab reasons, progress strip, tiles, guide lines, landing "how it works"). For each candidate, apply the test: would a first-time parent know why to tap it? Example directions to evaluate, not decided:
   - Mark plays: probably stays (it is the parent's own action).
   - Frame: "Follow your athlete", "Keep them in view", "Zoom in".
   - Spotlight: "Point out your athlete", "Show who's yours".
   - Finish: stays or "Share".
   Keep header tabs short (phone width 390px with Guidance toggle and credits chip).
2. Put the options on a decision page with phone + desktop header mockups (decision-artifact rule); the user picks.
3. Apply the picked names across app copy (`MODE_NAMES`, `MODE_SWITCHER_NAMES`, `MODE_SWITCHER_LOCKED`, `GUIDE.*`), the glossary (EPIC.md, and `.claude/references/copy-glossary.md` if T14600 created it), the landing site, and the T14670 guard test's word lists.
4. Code identifiers (`FOCUS`, `OVERLAY`, `FocusModeView`) keep their names.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/config/displayNames.js` (`MODE_NAMES` ~L276, `MODE_SWITCHER_NAMES` ~L285, `MODE_SWITCHER_LOCKED`, `GUIDE.*`)
- `src/frontend/src/components/ModeSwitcher.jsx` (hardcoded descriptions), `UnifiedHeader`
- `docs/plans/tasks/copy-vocabulary/EPIC.md` (Steps row of the glossary)
- Landing: `src/landing/src/pages/index.astro`, `how-it-works.astro`
- Tests selecting header text (unit + `src/frontend/e2e`)

### Related Tasks
- Runs after the Copy audit milestone (T14600-T14670 settle the rest of the vocabulary; T14650 landing).
- T14770 uses whatever step labels are current.

### Technical Notes
- Knowledge docs: `.claude/knowledge/guidance.md` (guide lines name the tabs), `.claude/knowledge/keyframes-framing.md` (Framing naming history, T9860).
- AI capability rule: names must not imply the AI follows or tracks the athlete on its own (the parent places the box). "Follow your athlete" would need care: the parent does the following.

## Implementation

### Steps
1. [ ] List every surface that shows a step name (grep `MODE_NAMES`, `MODE_SWITCHER_NAMES`, literal "Frame"/"Spotlight" in JSX and landing)
2. [ ] Decision page: 2-3 name sets with header mockups (phone + desktop), recommendation, pros/cons
3. [ ] User picks
4. [ ] Failing tests on header labels; change strings; update selectors and glossary
5. [ ] Phone + desktop screenshots of the header in each step

### Progress Log

**2026-11-03**: Filed from the user's "name the parent's goal" rule while deciding T14770.

## Acceptance Criteria

- [ ] Every step name passes the first-time-parent test, approved by the user
- [ ] One name per step across header, status text, guide lines, glossary and landing
- [ ] No AI-capability overclaim in the new names
- [ ] Tests pass

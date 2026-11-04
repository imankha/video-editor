# T14670: Guard test for banned copy

**Status:** WIP
**Impact:** 5
**Complexity:** 3
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Copy drifts back: the 2026-09-10 Shared Vocabulary epic standardized names, and seven weeks
later the audit found clip / draft / Focus / Click / em dashes back in live copy. Nothing fails
when a retired word ships.

Task 8 of 8 in the [Copy Vocabulary epic](EPIC.md). Runs last, after T14600 to T14660 removed
the retired words, so the test starts green.

## Solution

A Vitest test that scans user-facing copy and fails on retired words:

- **Scope:** every string value exported from `src/frontend/src/config/displayNames.js` and
  `emptyStates.js` (import and walk the objects, calling function values with sample args), plus
  JSX text nodes and `title` / `aria-label` / `placeholder` attribute literals in
  `src/frontend/src/{components,modes,screens,containers}/**/*.jsx` (parse with the project's
  existing parser or a simple JSX-text regex; exclude tests and admin).
- **Banned (case-insensitive, word-bounded):** clip, clips, draft, drafts, annotation(s),
  footage, Focus (as a mode name), keyframe, segment, "Click" at the start of an instruction,
  "backend", "GPU", status-code patterns like `(4\d\d)` / `(5\d\d)`, the em dash character (U+2014), " -- ", "->".
- **Allowlist** file with a reason per entry for legitimate uses (e.g. "Instagram Reels",
  desktop-only hover tooltips that say Click).
- Error message names the file, the string and the banned word, and points to
  `.claude/references/copy-glossary.md`.

Optionally add the landing site: scan `src/landing/src/**/*.astro` visible text for " -- " and
British spellings. Implementer's call; note it in the PR.

## Context

### Relevant Files
- New test under `src/frontend/src/config/` (e.g. `copyGlossary.guard.test.js`) + allowlist JSON
- `src/frontend/src/config/displayNames.js`, `emptyStates.js`
- `.claude/references/copy-glossary.md` (created in T14600): add a line saying the guard test enforces it
- `scripts/ci_policy.py`: confirm the new test is picked up by Branch CI's vitest selection (it reads sources at runtime, so it must be in the "tests that read sources at runtime" set; see CLAUDE.md Test Scope Policy)

### Technical Notes
- Avoid false positives on identifiers: scan values and visible text only, never code identifiers.
- Keep the scan fast (under a few seconds).

## Implementation

1. [ ] Write the test + allowlist; run it and confirm it passes on the post-sweep tree
2. [ ] Prove it bites: add a temporary string containing "clip" and an em dash, see it fail with a useful message, remove it
3. [ ] Confirm Branch CI routing for runtime-source tests
4. [ ] Explicit lint

## Acceptance Criteria

- [ ] Test fails when a retired word or banned punctuation enters shipped copy, naming file and word
- [ ] Allowlist entries each carry a reason
- [ ] Runs in Branch CI on frontend changes
- [ ] Tests pass

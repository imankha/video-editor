# T13360: CLAUDE.md knowledge table calls the Framing mode "Focus (formerly Framing)"

**Status:** WIP
**Impact:** 3
**Complexity:** 1
**Tier:** S (docs only, 1 to 2 files)
**Created:** 2026-10-24
**Updated:** 2026-10-24

## Problem

`CLAUDE.md:220` (Knowledge Base table) describes `keyframes-framing.md` as covering "Focus
(formerly Framing) mode". The code says the reverse: `src/frontend/src/config/displayNames.js`
`MODE_NAMES.FRAMING = 'Framing'` (T9860), the header switcher verb is `'Frame'`
(`MODE_SWITCHER_NAMES.FRAMING`), and the comment at lines 162-164 says "Frame" was chosen
"deliberately NOT the old 'Focus' mode name". "Focus" survives in-app only as a lowercase verb
in descriptions ("Focus the action on your player"). Agents loading CLAUDE.md inherit the stale
name; the landing hero review (T13350) nearly shipped "AI Focus" as a feature name because of it.

## Solution

Rewrite the row to "Crop/highlight keyframes, splines, Framing mode (header verb 'Frame'; the
old 'Focus' name is retired, T9860)". Check the header of `.claude/knowledge/keyframes-framing.md`
for the same wording and fix it in the same commit. Docs are claims, code is truth.

## Context

### Relevant Files (REQUIRED)
- `CLAUDE.md` - Knowledge Base table, line 220
- `.claude/knowledge/keyframes-framing.md` - title/intro line if it carries the same phrase
- `src/frontend/src/config/displayNames.js` - source of truth (read-only)

### Related Tasks
- Found during: T13350 (landing hero copy review, 2026-10-24)

## Implementation

### Steps
1. [ ] Fix the CLAUDE.md row
2. [ ] Grep `.claude/knowledge/` and `.claude/references/` for "formerly Framing" and "Focus mode" claims that contradict `displayNames.js`; fix the ones that do
3. [ ] Commit (docs only)

### Progress Log

**2026-10-24**: Filed.

## Acceptance Criteria

- [ ] No instruction file says the mode is called "Focus"; the noun is "Framing", the header verb "Frame"
- [ ] Instruction-audit CI job passes

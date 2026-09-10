# T9700: Verify framing and spotlight persistence and previews

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-09-10
**Updated:** 2026-09-10

## Source

2026-09-09/10 parent walkthrough of staging. Handoff archive: `C:/Users/imank/Documents/Codex/2026-09-09/can/outputs/reelballers-engineering-handoff`
Handoff item(s): **E5-03 (UX-09, UX-10)**.

## Why this exists

**This is a regression check, not a claim that these currently fail.** The walkthrough's framing and
effects export succeeded and its private draft survived reopening. T9610 and T9620 restructure both
editors, and this task exists so that restructuring does not quietly break persistence that works
today.

## Scope

Reopen drafts and verify each survives: focus points, selected player, effect duration, aspect ratio,
speed. Confirm the preview matches the export.

## Context

### Related Tasks
- Depends on: T9610, T9620
- `.claude/knowledge/keyframes-framing.md` - read first; the keyframe identity landmines
  (`project_keyframe_identity_divergence`, T350's corruption) live in this area
- T9100, T9150 - the Overlay metadata half-record bug class, same surface

### Technical Notes
CLAUDE.md persistence rule: runtime fixups are memory-only. A verification that provokes a
write-back on load has found a bug, not a passing test.

## Acceptance Criteria

- [ ] Focus points, selected player, effect duration, aspect ratio and speed all survive reopen
- [ ] Preview matches export for both framing and spotlight
- [ ] Reopening a draft triggers no write-back
- [ ] Any failure found is filed as its own task rather than fixed inline

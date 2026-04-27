# T1940: Remove Redundant Progress Bars

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-04-27
**Updated:** 2026-04-27

## Problem

Upload/export progress is shown in 3 places simultaneously — toasts, project cards, and the main UI areas in annotate/framing/overlay. The redundancy clutters the interface and wastes screen real estate in the modes where users are actively working.

## Solution

Remove progress bar UI from the main working areas in annotate, framing, and overlay modes. Keep progress indicators in:
- **Toasts** — non-intrusive, always visible regardless of mode
- **Project cards** — visible when browsing projects, shows status at a glance

## Context

### Relevant Files
- Annotate mode progress bar component
- Framing mode progress bar component
- Overlay mode progress bar component
- Toast notification system (keep as-is)
- Project card progress strip (keep as-is)

## Acceptance Criteria

- [ ] No upload/export progress bar in annotate main UI
- [ ] No upload/export progress bar in framing main UI
- [ ] No upload/export progress bar in overlay main UI
- [ ] Toast notifications still show progress
- [ ] Project cards still show progress strip
- [ ] No regressions in upload/export functionality

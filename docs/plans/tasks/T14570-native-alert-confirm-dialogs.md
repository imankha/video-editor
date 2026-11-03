# T14570: Native alert and confirm dialogs

**Status:** WIP
**Impact:** 4
**Complexity:** 4
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Native browser `alert()` / `window.confirm()` dialogs are unstyled, show the site URL as the
title on phones, can't use the app's copy rules, and some interpolate raw error text:

- `src/frontend/src/screens/ProjectsScreen.jsx` ~366-370: file-name mismatch confirm that says "click OK to continue ... click Cancel and select the correct file"
- `src/frontend/src/components/PublishedReelsPanel.jsx` ~622-648: before/after comparison alerts including "Failed to generate comparison: ${error.message}"
- `src/frontend/src/hooks/useReEditReel.js` ~74, 90: "Could not save to the cloud yet. Your highlight moved to drafts on this device..." and "Failed to open highlight as draft: ${error.message}"
- `src/frontend/src/components/overlay/CtaBar.jsx` ~27: `window.confirm(`${title}?`)`

## Solution

Replace each with the app's existing confirmation dialog / toast components. Copy follows
[copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md) (Tap, glossary words, error voice). For
example, the file-name mismatch becomes: "This file has a different name than the one you
started with. Is it the same video?" with buttons "Yes, use it" / "Pick another".

## Context

### Relevant Files
Listed above, plus the existing confirmation dialog component (grep `ConfirmationDialog`).

### Technical Notes
- Native dialogs are synchronous; the replacements are async. Re-check each call site's control flow (a confirm that gated a branch must await the dialog result).

## Implementation

1. [ ] Failing tests: each flow renders the in-app dialog/toast and `window.confirm` / `alert` is never called
2. [ ] Replace the four call sites
3. [ ] Grep `alert(` and `confirm(` across `src/frontend/src` for any others (exclude tests)
4. [ ] Relevant tests + lint

## Acceptance Criteria

- [ ] No `alert()` / `window.confirm()` in user-facing frontend code
- [ ] Each replacement keeps the original branching behavior
- [ ] No raw error text in the new copy
- [ ] Tests pass

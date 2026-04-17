# T1550: Unified Navigation

## Summary
Add clickable breadcrumbs and a unified tab bar so users can navigate between modes and back to home without relying on browser back.

## Status: TODO

## Classification
- **Stack Layers:** Frontend
- **Files Affected:** ~6 files
- **LOC Estimate:** ~150-200 lines
- **Test Scope:** Frontend E2E (navigation flows)

## What Exists Today
- Three separate mode containers (Annotate, Framing, Overlay) each with their own headers
- No consistent way to go "back" to game list / reel list / home
- Breadcrumb component exists but is not clickable
- ModeSwitcher only shows Framing/Overlay tabs (no Annotate)

## What We Want
1. **Clickable breadcrumbs** - path like "Games / Reels > Home", clicking navigates there
2. **Unified 3-mode tab bar** - Annotate / Framing / Overlay tabs visible in all modes, highlights current
3. **Single shared header** - replaces per-container headers, contains breadcrumbs + tab bar

## Constraints
- Frontend-only. No backend or database changes.
- Follow existing Tailwind + component patterns.
- No reactive persistence - navigation is purely client-side routing/state.

## Acceptance Criteria
- [ ] User can click breadcrumb to navigate back to game list / home from any mode
- [ ] Tab bar shows Annotate/Framing/Overlay, highlights current mode
- [ ] Clicking a tab switches to that mode without losing context (same game/reel)
- [ ] Header is a single shared component used by all three modes
- [ ] No regressions in existing mode functionality

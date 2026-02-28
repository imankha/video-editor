# T240: Consistent Logo Placement Across Modes

**Status:** DONE
**Impact:** 4
**Complexity:** 2
**Created:** 2026-02-17
**Updated:** 2026-02-17

## Problem

Logo placement is inconsistent across the application modes:

1. **Framing/Overlay mode:** Logo is positioned to the left of "Projects" button, which makes it look like a clickable button when it should be in a neutral, non-interactive space.

2. **Annotate mode:** No logo is displayed at all.

This inconsistency hurts brand presence and creates visual confusion about what's clickable.

## Solution

Establish a consistent logo position across all modes:

- Place logo in a clearly non-interactive area (e.g., far left of header, separated from navigation)
- Ensure logo appears in ALL modes: Annotate, Framing, Overlay, Gallery
- Logo should not appear to be a button or link

## Context

### Relevant Files
- `src/frontend/src/modes/AnnotateModeView.jsx` - Missing logo
- `src/frontend/src/screens/FramingScreen.jsx` - Current logo placement
- `src/frontend/src/screens/OverlayScreen.jsx` - Current logo placement (if different)
- `src/frontend/src/components/` - May need shared header component

### Related Tasks
- Related to: T65 (Logo from Landing Page) - completed task that added the logo

### Technical Notes
- Consider creating a shared Header component if one doesn't exist
- Logo should be consistent size and position across all modes
- May need to adjust header layout to accommodate

## Implementation

### Steps
1. [ ] Audit current logo placement in all screens
2. [ ] Design consistent header layout with logo in non-clickable area
3. [ ] Create or update shared header component
4. [ ] Apply to all mode screens
5. [ ] Visual review across all modes

### Progress Log

- **2026-02-27:** Logo removed from Annotate, Overlay, and Framing modes by user. Logo only appears on Projects screen. Task resolved.

## Acceptance Criteria

- [ ] Logo visible in Annotate mode
- [ ] Logo visible in Framing mode
- [ ] Logo visible in Overlay mode
- [ ] Logo visible in Gallery mode
- [ ] Logo position is identical across all modes
- [ ] Logo is clearly not clickable (no hover effects, proper spacing from interactive elements)

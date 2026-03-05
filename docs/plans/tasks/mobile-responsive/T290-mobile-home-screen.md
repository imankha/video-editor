# T290: Mobile Home Screen

**Status:** TODO
**Impact:** 5
**Complexity:** 3
**Created:** 2026-03-04
**Updated:** 2026-03-04

## Problem

Home screen has minor layout issues on mobile:
- Gallery button and profile icon partially hidden behind right edge
- "Continue where you left off" cards truncate text ("Vs LA Breake...")
- Game card stats row ("34 clips - 11!! - 15! - Quality: 63") wraps awkwardly

## Solution

- Ensure header icons (Gallery, profile) are within viewport
- Allow "Continue" cards to scroll horizontally or wrap text properly
- Reflow game card stats to stack or use a tighter layout on narrow screens

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/screens/HomeScreen.jsx` or equivalent
- `src/frontend/src/components/GameCard.jsx` - Game card component
- `src/frontend/src/components/ProjectManager.jsx` - "Continue where you left off" section

### Related Tasks
- Part of: Mobile Responsive epic

## Implementation

### Steps
1. [ ] Fix header icons overflow
2. [ ] Fix "Continue" card text truncation (ellipsis or allow wrap)
3. [ ] Fix game card stats layout at narrow widths
4. [ ] Test on 360px and 428px

## Acceptance Criteria

- [ ] All header actions visible and tappable
- [ ] Game cards readable without awkward wrapping
- [ ] "Continue" cards show enough text to identify the project

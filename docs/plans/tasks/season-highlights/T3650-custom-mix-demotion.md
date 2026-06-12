# T3650: Custom Mix Demotion + Rename

**Status:** TODO
**Impact:** 5
**Complexity:** 1
**Created:** 2026-06-12

## Problem

"New Reel" is the primary CTA on the Reel Drafts tab, teaching a manual editing path the paradigm release replaces. It also overloads "reel": published outputs are reels; manual multi-clip compilations are now mixes ("Mixes & compilations" group from T3610).

## Solution

Demote and rename -- never remove (recruiting videos and themed multi-game mixes remain valid). See [EPIC.md](EPIC.md) decision #10.

1. **Remove the primary button**: cyan `size="lg"` "New Reel" at [ProjectManager.jsx:707-717](../../../../src/frontend/src/components/ProjectManager.jsx). Reel Drafts tab gets NO primary action (drafts originate from annotation; Games tab keeps "Add Game").
2. **Quiet entry point**: ghost/secondary `size="sm"` "+ Custom Mix" button right-aligned on the "YOUR REEL DRAFTS" header row. Same `disabled={!hasClips}`, same `GameClipSelectorModal` flow.
3. **Rename display surfaces** (DB `source_type` values UNCHANGED -- display only):
   - GameClipSelectorModal title -> "New Custom Mix"
   - DownloadsPanel filter pill "Custom Reels" -> "Custom Mixes" ([DownloadsPanel.jsx:648-667](../../../../src/frontend/src/components/DownloadsPanel.jsx))
   - Source-type display labels (sourceTypes.js or equivalent label map)
   - Grep for remaining user-facing "New Reel" strings (toasts, empty states, quest copy is T3660's job)

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/ProjectManager.jsx` - button removal + header-row entry point
- `src/frontend/src/components/GameClipSelectorModal.jsx` - modal title
- `src/frontend/src/components/DownloadsPanel.jsx` - filter pill label
- `src/frontend/src/config/sourceTypes.js` (or label map location) - display labels

### Related Tasks
- Depends on: nothing technically; **must ship in the same release as T3640** (do not remove the prominent path before its replacement exists -- EPIC decision #12)
- Coordinates with: T3660 (quest copy stops referencing the old flow in the same release)

### Technical Notes
- ~4 files, ~60 LOC, display-only. No migration, no API changes.
- E2E specs that click "New Reel" (e.g., quest/new-user flows) will break -- update selectors here or coordinate with T3660's e2e rewrite if same release.

## Implementation

### Steps
1. [ ] Remove primary button; add header-row "+ Custom Mix"
2. [ ] Rename modal title + filter pill + label map
3. [ ] Grep sweep for stray "New Reel" strings
4. [ ] Update affected E2E selectors

### Progress Log

## Acceptance Criteria

- [ ] Reel Drafts tab has no primary CTA; "+ Custom Mix" works with identical flow
- [ ] No user-facing "New Reel" strings remain (outside quest copy owned by T3660)
- [ ] `source_type` values in DB and API unchanged
- [ ] E2E suite green

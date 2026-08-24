# T7340: Restore admin TSV annotation import/export in production

**Status:** DONE (deployed 2026-08-24 prod)
**Impact:** 4
**Complexity:** 2
**Created:** 2026-08-19
**Updated:** 2026-08-19

## Problem

The admin (imankh) used to be able to upload a pre-made annotation file (TSV: `start_time`,
`rating`, `tags`, `clip_name`, `clip_duration`, `notes`) into a game's Annotate screen instead of
scrubbing and tagging clips by hand. That Import/Export UI is gone in production today.

The feature was never deleted. T590 ("Gate dev-only UI features from production builds", commit
`e6885618`) wrapped the Import/Export buttons in `ClipsSidePanel.jsx` with
`!import.meta.env.PROD`, which tree-shakes them out of prod builds entirely — hiding them from
every user including admins. All underlying logic is intact and unused-in-prod:
- `validateTsvContent` / `generateTsvContent` (`ClipsSidePanel.jsx`) — TSV parsing, validation,
  and generation, columns `['start_time', 'rating', 'tags', 'clip_name', 'clip_duration', 'notes']`
- `importAnnotations` (`useAnnotate.js`) — turns parsed rows into clip regions

## Solution

Swap the blanket `!import.meta.env.PROD` gate for an admin check, so the buttons render for
admin users in production (as before) but stay hidden for regular users — matching the existing
`isAdmin` pattern already used for other admin-only prod UI (`ManageProfilesModal.jsx:343`,
sourced from `authStore.js`'s `isAdmin` / `checkAdmin()`).

```
// before
{!isMobile && !import.meta.env.PROD && ( ... )}

// after
{!isMobile && (isAdmin || !import.meta.env.PROD) && ( ... )}
```

`ClipsSidePanel` does not currently receive `isAdmin` — either read it directly via
`useAuthStore(state => state.isAdmin)` in the component (matches `ManageProfilesModal`'s
pattern) or pass it down as a prop if the panel is meant to stay store-free. Check how
`ClipsSidePanel` is composed (`AnnotateContainer.jsx` / `AnnotateScreen.jsx`) before deciding.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/modes/annotate/components/ClipsSidePanel.jsx` — Import/Export buttons (~line
  206), `validateTsvContent`/`generateTsvContent` (unchanged)
- `src/frontend/src/stores/authStore.js` — `isAdmin` state, reference pattern
- `src/frontend/src/containers/AnnotateContainer.jsx` — composes `ClipsSidePanel`, check if prop
  threading is more consistent than a direct store read here

### Related Tasks
- T590 (commit `e6885618`) introduced the blanket prod gate this task narrows

### Technical Notes
- Import/export must stay `!isMobile` regardless (existing constraint, unrelated to admin gating)
- Do not remove the dev convenience: non-admins on `!PROD` (dev/staging without admin) should
  still see the buttons, same as today

## Implementation

### Steps
1. [ ] Confirm how `isAdmin` is best sourced into `ClipsSidePanel` (direct store read vs prop)
2. [ ] Update the gate condition
3. [ ] Verify in dev as a non-admin session that buttons still show (dev convenience preserved)
4. [ ] Verify (staging) as admin that buttons show; as non-admin that they don't

### Progress Log

_(none yet)_

## Acceptance Criteria

- [ ] Admin sees Import/Export buttons on the Annotate screen in production
- [ ] Non-admin users do not see them in production
- [ ] Dev/staging behavior unchanged for non-admins (buttons still visible, `!PROD` still works)
- [ ] TSV round-trip (export then re-import) still produces the same clips

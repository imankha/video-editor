# T1770: Gallery Share UI

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

Users have no way to initiate sharing from the gallery. Need a Share button and email input modal.

## Solution

Add a Share button to gallery video cards. Clicking opens a modal where users can enter one or more recipient emails. Submitting calls the POST share endpoint with the list and shows a success confirmation.

## Context

### Relevant Files (REQUIRED)
- `src/frontend/src/components/Gallery/` - Gallery components, add Share button to video cards
- New: `src/frontend/src/components/Gallery/ShareModal.jsx` - Email input modal
- `src/frontend/src/stores/` - API call for share creation

### Related Tasks
- Depends on: T1750 (backend API must exist to call)
- Blocks: T1790 (share status panel extends this UI)

### Technical Notes

- Share button: icon button (share/send icon) on gallery video cards, similar to existing download button
- Modal: email input with multi-email support (comma-separated or tag-style chips). Send button, loading state, success/error feedback.
- Validate each email format client-side before submitting
- Follow existing modal patterns in the codebase (see UI style guide)

## Implementation

### Steps
1. [ ] Add Share icon button to gallery video cards
2. [ ] Create ShareModal component with multi-email input (comma-separated or chip/tag style)
3. [ ] Wire modal submit to POST `/gallery/{video_id}/share` with list of emails
4. [ ] Success state: "Shared with N recipients!" with list of emails
5. [ ] Error handling: show per-email or general error messages in modal

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Share button visible on gallery video cards
- [ ] Clicking opens modal with multi-email input
- [ ] All emails validated before submit enabled; supports entering multiple recipients
- [ ] Submitting calls backend and shows success confirmation
- [ ] Error from backend displayed in modal
- [ ] Modal closeable via X or clicking outside

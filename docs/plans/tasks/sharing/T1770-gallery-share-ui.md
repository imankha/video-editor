# T1770: Gallery Share UI

**Status:** TODO
**Impact:** 7
**Complexity:** 3
**Created:** 2026-04-25
**Updated:** 2026-04-25

## Problem

Users have no way to initiate sharing from the gallery. Need a Share button and email input modal.

## Solution

Add a Share button to gallery video cards. Clicking opens a Google Docs-style share modal where users can:
1. Enter one or more recipient emails
2. Choose visibility: **Private** (default) or **Public** ("Anyone with the link")
3. Submit to create shares and show success confirmation with a copyable share link

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
- Modal layout (Google Docs share dialog as UX template):
  - **"People with access"** section at top showing already-shared recipients with status (watched/pending)
  - **Email input** with multi-email support (comma-separated or tag-style chips) using UserPicker
  - **Visibility selector** below email input: dropdown/toggle between "Restricted" (only named recipients) and "Anyone with the link" (public). Defaults to Restricted.
  - **Copy link** button — copies the share URL to clipboard
  - Send button, loading state, success/error feedback
- Validate each email format client-side before submitting
- Follow existing modal patterns in the codebase (see UI style guide)

## Implementation

### Steps
1. [ ] Add Share icon button to gallery video cards
2. [ ] Create ShareModal component (Google Docs share dialog layout)
3. [ ] Add "People with access" section showing existing shares
4. [ ] Add multi-email input using UserPicker (comma-separated or chip/tag style)
5. [ ] Add visibility selector: "Restricted" (private) / "Anyone with the link" (public)
6. [ ] Add "Copy link" button for share URL
7. [ ] Wire modal submit to POST `/gallery/{video_id}/share` with emails + `is_public` flag
8. [ ] Success state: "Shared with N recipients!" with list of emails + copied link
9. [ ] Error handling: show per-email or general error messages in modal

### Progress Log

*No progress yet.*

## Acceptance Criteria

- [ ] Share button visible on gallery video cards
- [ ] Clicking opens modal with Google Docs-style layout
- [ ] "People with access" section shows existing shares with watch status
- [ ] All emails validated before submit enabled; supports entering multiple recipients
- [ ] Visibility toggle between "Restricted" and "Anyone with the link" (defaults to Restricted)
- [ ] "Copy link" button copies share URL to clipboard
- [ ] Submitting calls backend with emails + visibility and shows success confirmation
- [ ] Error from backend displayed in modal
- [ ] Modal closeable via X or clicking outside

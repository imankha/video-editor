# T14530: Developer error text shown to parents (frontend)

**Status:** WIP
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

Text written for developers reaches parents through toasts, the export panel and dialogs:

- "Cannot connect to server. Please ensure the backend server is running on port 8000." and "Server error (500). Check backend console for details." plus "Check console for stack trace", "Highlight state manager not available", "No crop keyframes defined" (`src/frontend/src/containers/ExportButtonContainer.jsx` ~514-644, 941-966)
- "Backend server is not running", "Cannot connect to backend server", "Server error: {status}" (`src/frontend/src/components/ConnectionStatus.jsx`)
- Upload progress "Computing file hash...", "Computing hash... 40%", "Hash complete", "Finalizing upload...", "Game linked" (`src/frontend/src/services/uploadManager.js` ~638-1183, shown by `UploadProgressIndicator.jsx`)
- The mode-switch dialog "Uncommitted Spotlight Changes ... Generate: Create a new video (GPU processing) ... X: Cancel" (`src/frontend/src/App.jsx` ~1022-1026)
- Status codes: "Failed to send code (403)", "Verification failed (500)" (`components/auth/OtpAuthForm.jsx` ~160, 210), "Checkout failed (...)" (`BuyCreditsModal.jsx`), "Failed to create link (404)" (`ShareGameModal.jsx`), "The server rejected the report (status 500)" (`ReportProblemButton.jsx`), `HTTP ${status}` (`SharedCollectionView.jsx`, `EditGameModal.jsx`)
- Raw `result.error` / `err.message` in toasts, e.g. Framing edit failures "Failed to save crop keyframe", "Failed to save detrim changes" (`src/frontend/src/containers/FocusContainer.jsx` ~365-1060), "Generation failed: {error || 'Unknown error'}" and "Monitoring generation via server polling..." (`components/ExportButtonView.jsx`)
- "Your browser does not support the video tag." (`components/MediaPlayer.jsx` ~212), "Failed to fetch video: 403" / "video metadata" (`hooks/useVideo.js`, `utils/videoMetadata.js`, shown verbatim in `FocusModeView.jsx` ~686)

Full list with lines: [copy-vocabulary/audit/D-modes-screens-logic.md](copy-vocabulary/audit/D-modes-screens-logic.md) F-06, F-12 to F-16, F-36, F-43, F-67 to F-70; report B items 15-19, 67, 71, 81, 88; report C items 46, 55, 57.

## Solution

Apply the epic's error voice ([copy-vocabulary/EPIC.md](copy-vocabulary/EPIC.md) style rule 3):
"We couldn't [thing]. Try again." Technical detail goes to `console.error` only. Route upload
progress through the existing `UPLOAD_PROGRESS_COPY` constants. Rewrite the mode-switch dialog
as: title "Unsaved changes", body "You changed your spotlight but haven't made the highlight
yet.", buttons "Discard changes" / "Make highlight" / "Keep editing". Use the glossary words
(Make highlight, spotlight, position) in new copy.

## Context

### Relevant Files
Listed above; all new strings go in `src/frontend/src/config/displayNames.js`.

### Technical Notes
- Keep logging the technical detail; only the user-facing string changes.
- Several of these toasts have tests asserting the old text; update them deliberately, not loosely.
- The CSV/TSV import errors (`modes/annotate/hooks/useAnnotate.js` ~123-221) show column names such as `clip_duration`: rewrite as "Line 3: the start time should look like 12:30".

## Implementation

1. [ ] Failing tests: representative surfaces (export panel connection error, OTP error, upload progress, mode-switch dialog) show plain copy, no status code / "backend" / "hash" / "GPU"
2. [ ] Fix every surface listed; move strings to displayNames
3. [ ] Grep `\(\$\{.*status`, `backend`, `server`, `GPU`, `hash`, `keyframe`, `err.message`, `result.error` in user-visible paths and fix stragglers
4. [ ] Relevant tests + explicit lint

## Acceptance Criteria

- [ ] No user-visible string contains a status code, "backend", "port", "console", "stack trace", "hash", "GPU", "metadata", "keyframe" or a raw error message
- [ ] Every failure message says what failed and what to do
- [ ] Technical detail is still logged
- [ ] Tests pass

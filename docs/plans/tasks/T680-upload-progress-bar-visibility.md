# T680: Upload Progress Bar Visibility

## Pain Point

User feedback: "Is it possible to add a progress bar on the game upload?" An ActiveUploadCard with progress percentage already exists in ProjectManager, but the user either didn't see it or found it insufficient.

## Solution

Investigate and improve upload progress visibility:

1. **Audit current state**: Verify the ActiveUploadCard is visible during the full upload flow (HASHING → PREPARING → UPLOADING → FINALIZING → COMPLETE)
2. **Discoverability**: Ensure the progress indicator is prominent and not hidden by scroll position or tab state
3. **Phase clarity**: Show which phase the upload is in with user-friendly labels (e.g., "Preparing..." → "Uploading: 45%" → "Finalizing...")
4. **Persistence**: If user navigates away from Games tab, ensure they can still see upload progress (e.g., persistent banner or notification)

## Scope

**Stack Layers:** Frontend
**Files Affected:** ~2-3 files
**LOC Estimate:** ~30-50 lines
**Test Scope:** Frontend Unit

## Notes

This may be a discoverability issue rather than a missing feature. The first step is to investigate what the NUF user actually saw vs. what exists. If the progress bar is already visible and clear, this ticket may be closed as "works as designed" with minor improvements.

## Source

User feedback (2026-03-23): NUF tester asked for upload progress bar (may already exist but be insufficiently visible).

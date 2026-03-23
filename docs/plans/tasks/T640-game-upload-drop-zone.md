# T640: Game Upload Drop Zone

## Pain Point

User feedback: "Would be cool to be able to drag onto the screen instead of having to hit add game." Users expect drag-and-drop for video files — the current flow requires clicking through a file picker.

## Solution

Add a drop zone to the GameDetailsModal file upload area. The existing "Click to Upload Video" text becomes "Click or drag to upload video." Dropping a video file onto this area populates the file input and proceeds with the upload flow.

## Scope

**Stack Layers:** Frontend
**Files Affected:** ~2 files (GameDetailsModal.jsx, FileUpload.jsx)
**LOC Estimate:** ~30 lines
**Test Scope:** Frontend Unit

## Implementation Notes

- Add `onDragOver`, `onDragEnter`, `onDragLeave`, `onDrop` handlers to the file upload area in GameDetailsModal
- Visual feedback on drag hover (border highlight, background change)
- Update label text: "Click or drag to upload video"
- Accept same file types as current input (MP4, MOV, WebM)
- On drop, populate the file state the same way the file picker does

## Source

User feedback (2026-03-23): NUF tester found the game addition flow unintuitive, expected drag-and-drop.

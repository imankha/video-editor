# T1790: Download Button for Shared Reel Recipient

**Status:** TODO
**Impact:** 6
**Complexity:** 2
**Created:** 2026-05-11
**Updated:** 2026-05-11

## Problem

When a recipient opens a shared reel link, they can watch it but have no way to download it. Users want to save shared reels to their device (e.g., to post on Instagram, share via iMessage, or keep offline).

## Solution

Add a download button to the SharedVideoOverlay component. When clicked, download the video file using the `video_url` from the share data.

## Context

### Relevant Files
- `src/frontend/src/components/SharedVideoOverlay.jsx` - Shared video player overlay (add download button here)

### Related Tasks
- Depends on: T1780 (Shared Video Player Page) - DONE
- Related: T442 (Web Share API) - TODO, future native share sheet

### Technical Notes
- The share object already contains `video_url` and `video_name` from the API response
- Download should use an anchor tag with `download` attribute or fetch + blob approach to trigger browser download
- Button should appear in the overlay header bar next to the close button, only when state is 'ready'
- Use the `Download` icon from lucide-react (already a project dependency)

## Implementation

### Steps
1. [ ] Add Download icon import from lucide-react
2. [ ] Add download button to the Overlay header when video is ready
3. [ ] Implement download handler (fetch video_url as blob, trigger download with video_name as filename)

## Acceptance Criteria

- [ ] Download button visible on shared video overlay when video loads successfully
- [ ] Clicking download saves the video file to the user's device
- [ ] Download uses the video name as the filename
- [ ] Button is not shown during loading, error, or forbidden states
- [ ] Works on mobile and desktop

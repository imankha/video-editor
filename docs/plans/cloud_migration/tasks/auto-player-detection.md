# Auto Player Detection

## Overview
Automatically detect players after framing completes and create overlay keyframes on those frames. This removes the manual player detection step and makes the workflow more seamless.

## Requirements

### 1. Determine Optimal Keyframe Count
- Figure out the ideal number of overlay keyframes based on clip duration
- Space them evenly throughout the video
- Consider factors like:
  - Minimum/maximum keyframe density
  - Video duration
  - Performance constraints (detection is expensive)

### 2. Automatic Detection Trigger
- Run player detection automatically right after framing completes
- OR integrate detection as part of the framing process itself
- Should not require user interaction

### 3. Remove Manual Detection Button
- Remove the existing button that lets users manually trigger player detection
- Current button takes too long anyway
- Simplifies the UI

### 4. Auto-Create Overlay Keyframes
- Automatically create overlay keyframes on the detected frames
- Each keyframe should contain the player detection results
- Keyframes ready for the overlay mode

## Implementation Notes

### Current Flow
1. User completes framing (crop/upscale)
2. User manually clicks "Detect Players" button
3. Detection runs on all frames (slow)
4. User creates overlay keyframes manually

### New Flow
1. User completes framing
2. System automatically:
   - Calculates optimal keyframe positions
   - Runs detection on just those frames
   - Creates overlay keyframes with detection data
3. User proceeds directly to overlay mode with keyframes ready

## Technical Considerations
- Detection is GPU-intensive - limiting to N evenly-spaced frames is key
- Need to determine N based on testing (start with 5-10 keyframes?)
- Consider showing progress indicator during auto-detection
- Handle cases where detection fails on some frames

## Files to Modify
- `src/frontend/src/modes/overlay/` - Remove manual detection button
- `src/backend/app/routers/` - Add endpoint for batch detection on specific frames
- `src/frontend/src/screens/FramingScreen.jsx` - Trigger detection after framing
- `src/backend/app/modal_functions/` - Optimize detection for specific frames only

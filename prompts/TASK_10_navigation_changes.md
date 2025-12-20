# Task 10: Navigation and FileUpload Changes

## Context

**Project:** Browser-based video editor for soccer highlights with Annotate, Framing, and Overlay modes.

**Tech Stack:**
- Frontend: React 18 + Vite (port 5173)
- UI: Tailwind CSS + lucide-react icons

**Current FileUpload Component:**
```
[Add Game]           ← Loads video for Annotate mode
[Add Raw Clips]      ← REMOVE - moved to ClipSelectorSidebar
[Add Overlay Video]  ← REMOVE - overlay follows framing in project flow
```

**New FileUpload Component:**
```
[Annotate]           ← Renamed, supports multiple files
```

**ModeSwitcher Visibility Rules:**
```
No project selected:
  - Show nothing (or "Annotate Mode" badge if in annotate)

Project selected:
  - Show Framing tab (always enabled)
  - Show Overlay tab (disabled until working_video exists)
```

**Multiple Video Support:**
- Annotate button now accepts `multiple` files
- For now, use first file only (TODO: concatenation in future)

---

## Objective
Update the navigation components:
1. Remove "Add Raw Clips" button from header
2. Remove "Add Overlay To Framed Video" button from header
3. Rename "Add Game" to "Annotate" and support multiple files
4. Update ModeSwitcher for project-aware visibility

## Dependencies
- Task 06 (App refactor)

## Files to Modify

### 1. `src/frontend/src/components/FileUpload.jsx`

Simplify to only have the Annotate button:

```javascript
import React, { useRef, useState } from 'react';
import { Film, Loader } from 'lucide-react';

/**
 * FileUpload component - Annotate button only
 *
 * The "Add Raw Clips" functionality has moved to ClipSelectorSidebar.
 * The "Add Overlay To Framed Video" is no longer needed (overlay follows framing in project flow).
 */
export function FileUpload({ onGameVideoSelect, isLoading }) {
  const gameInputRef = useRef(null);
  const [loadingState, setLoadingState] = useState(false);

  const handleGameFileChange = async (event) => {
    const files = event.target.files;
    if (files && files.length > 0 && onGameVideoSelect) {
      setLoadingState(true);
      try {
        // Pass all selected files (for multi-video support)
        await onGameVideoSelect(Array.from(files));
      } finally {
        setLoadingState(false);
      }
      // Reset input so same files can be selected again
      event.target.value = '';
    }
  };

  const handleClick = () => {
    gameInputRef.current?.click();
  };

  const isButtonLoading = isLoading || loadingState;

  return (
    <div className="file-upload-container">
      {/* Hidden file input - accepts multiple files */}
      <input
        ref={gameInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleGameFileChange}
        className="hidden"
        multiple  // Enable multiple file selection
      />

      {/* Annotate button */}
      <button
        onClick={handleClick}
        disabled={isButtonLoading}
        className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
        title="Import game video(s) to annotate and extract clips"
      >
        {isButtonLoading ? (
          <>
            <Loader className="animate-spin h-5 w-5" />
            <span>Loading...</span>
          </>
        ) : (
          <>
            <Film className="w-5 h-5" />
            <span>Annotate</span>
          </>
        )}
      </button>
    </div>
  );
}

export default FileUpload;
```

### 2. `src/frontend/src/components/shared/ModeSwitcher.jsx`

Update for project-aware visibility:

```javascript
import React from 'react';
import { Crop, Sparkles, Scissors } from 'lucide-react';

/**
 * ModeSwitcher - Tab toggle for switching between editor modes.
 *
 * Visibility rules:
 * - When no project selected: Show nothing (or just Annotate if video loaded)
 * - When project selected: Show Framing and Overlay
 * - Overlay is disabled until working_video exists
 *
 * @param {string} mode - Current mode ('annotate' | 'framing' | 'overlay')
 * @param {function} onModeChange - Callback when mode changes
 * @param {boolean} disabled - Whether the switcher is disabled
 * @param {boolean} hasProject - Whether a project is selected
 * @param {boolean} hasWorkingVideo - Whether the project has a working video
 * @param {boolean} hasAnnotateVideo - Whether an annotate video is loaded
 */
export function ModeSwitcher({
  mode,
  onModeChange,
  disabled = false,
  hasProject = false,
  hasWorkingVideo = false,
  hasAnnotateVideo = false,
}) {
  // Define mode configurations
  const modes = [
    {
      id: 'framing',
      label: 'Framing',
      icon: Crop,
      description: 'Crop, trim & speed',
      available: hasProject,
      color: 'blue',
    },
    {
      id: 'overlay',
      label: 'Overlay',
      icon: Sparkles,
      description: 'Highlights & effects',
      available: hasProject && hasWorkingVideo,
      color: 'purple',
    },
  ];

  // If no project, don't show the mode switcher
  // (Annotate is accessed via the Annotate button in Project Manager)
  if (!hasProject) {
    // If in annotate mode with a video, show a simple indicator
    if (mode === 'annotate' && hasAnnotateVideo) {
      return (
        <div className="flex items-center gap-2 px-4 py-2 bg-green-600 rounded-lg">
          <Scissors size={16} />
          <span className="font-medium text-sm text-white">Annotate Mode</span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
      {modes.map((modeOption) => {
        const Icon = modeOption.icon;
        const isActive = mode === modeOption.id;
        const isAvailable = modeOption.available;

        const activeColor = {
          blue: 'bg-blue-600',
          purple: 'bg-purple-600',
        }[modeOption.color] || 'bg-purple-600';

        return (
          <button
            key={modeOption.id}
            onClick={() => !disabled && isAvailable && onModeChange(modeOption.id)}
            disabled={disabled || !isAvailable}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-md transition-all duration-200
              ${isActive
                ? `${activeColor} text-white shadow-lg`
                : isAvailable
                  ? 'text-gray-400 hover:text-white hover:bg-white/10'
                  : 'text-gray-600 cursor-not-allowed'
              }
              ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
            `}
            title={
              !isAvailable && modeOption.id === 'overlay'
                ? 'Export from Framing first to enable Overlay mode'
                : modeOption.description
            }
          >
            <Icon size={16} />
            <span className="font-medium text-sm">{modeOption.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export default ModeSwitcher;
```

### 3. Update App.jsx Header Section

Update how FileUpload and ModeSwitcher are rendered:

```javascript
{/* Header */}
<div className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
  {/* Left side - Project info or Annotate button */}
  <div className="flex items-center gap-4">
    {selectedProject ? (
      <ProjectHeader
        selectedProject={selectedProject}
        projects={projects}
        onSelectProject={selectProject}
        onBackToManager={() => {
          clearSelection();
          setEditorMode('project-manager');
        }}
      />
    ) : editorMode === 'annotate' && annotateVideoUrl ? (
      <button
        onClick={() => {
          // Exit annotate mode
          if (annotateVideoUrl) URL.revokeObjectURL(annotateVideoUrl);
          setAnnotateVideoFile(null);
          setAnnotateVideoUrl(null);
          setAnnotateVideoMetadata(null);
          resetAnnotate();
          setEditorMode('project-manager');
        }}
        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg"
      >
        ← Exit Annotate
      </button>
    ) : null}
  </div>

  {/* Center - Mode switcher */}
  <ModeSwitcher
    mode={editorMode}
    onModeChange={handleModeChange}
    disabled={isLoading}
    hasProject={!!selectedProject}
    hasWorkingVideo={selectedProject?.working_video_id != null}
    hasAnnotateVideo={!!annotateVideoUrl}
  />

  {/* Right side - other controls */}
  <div className="flex items-center gap-2">
    {/* Removed: FileUpload buttons are no longer here */}
    {/* Other controls like zoom, debug, etc. can stay */}
  </div>
</div>
```

### 4. Handle Multiple Video Files in Annotate

Update the handler in App.jsx:

```javascript
/**
 * Handle game video selection for Annotate mode
 * Now supports multiple files that get concatenated
 */
const handleGameVideoSelect = async (files) => {
  if (!files || files.length === 0) return;

  try {
    console.log('[App] handleGameVideoSelect: Processing', files.length, 'file(s)');

    // For now, just use the first file
    // TODO: Task for multi-video concatenation
    const file = files[0];

    // Extract video metadata
    const videoMetadata = await extractVideoMetadata(file);
    console.log('[App] Extracted game video metadata:', videoMetadata);

    // Create object URL for the video
    const videoUrl = URL.createObjectURL(file);

    // Clean up any existing annotate video URL
    if (annotateVideoUrl) {
      URL.revokeObjectURL(annotateVideoUrl);
    }

    // Set annotate state
    setAnnotateVideoFile(file);
    setAnnotateVideoUrl(videoUrl);
    setAnnotateVideoMetadata(videoMetadata);

    // Clear project selection
    clearSelection();

    // Transition to annotate mode
    setEditorMode('annotate');

    console.log('[App] Successfully transitioned to Annotate mode');
  } catch (err) {
    console.error('[App] Failed to process game video:', err);
    throw err;
  }
};
```

## Testing Steps

### 1. Start the App

```bash
cd src/frontend && npm run dev
```

### 2. Verify Initial State (Project Manager)

1. Load the app
2. Should see Project Manager
3. Should see "New Project" and "Annotate Game" buttons
4. Should NOT see "Add Raw Clips" or "Add Overlay To Framed Video"

### 3. Test Annotate Button

1. Click "Annotate Game" (or just "Annotate")
2. File picker should open
3. **Test multiple selection:**
   - Hold Ctrl/Cmd and select multiple videos
   - Should accept multiple files (even if only first is used for now)
4. Should enter Annotate mode

### 4. Verify Annotate Mode Header

1. In Annotate mode with video loaded
2. Should see "Annotate Mode" indicator (green badge)
3. Should see "← Exit Annotate" button on left
4. Click exit - should return to Project Manager

### 5. Test Project Mode Header

1. Create or select a project
2. Should see project name on left (ProjectHeader)
3. Should see ModeSwitcher in center with Framing/Overlay

### 6. Test ModeSwitcher Visibility

1. **No project:** ModeSwitcher hidden (or shows Annotate badge if in annotate)
2. **Project without working video:**
   - Framing tab: enabled and clickable
   - Overlay tab: disabled (grayed out)
3. **Project with working video:**
   - Both tabs enabled

### 7. Test Overlay Disabled State

1. Select a project with no working_video
2. Try to click Overlay tab
3. Should not switch (stays on Framing)
4. Hover should show tooltip about exporting first

### 8. Verify Old Buttons Removed

1. Navigate through all states
2. Confirm "Add Raw Clips" button is gone
3. Confirm "Add Overlay To Framed Video" button is gone

## Success Criteria

- [ ] "Add Raw Clips" button removed from header
- [ ] "Add Overlay To Framed Video" button removed from header
- [ ] "Add Game" renamed to "Annotate"
- [ ] Annotate button accepts multiple files
- [ ] ModeSwitcher hidden when no project
- [ ] ModeSwitcher shows Framing/Overlay when project selected
- [ ] Overlay tab disabled until working_video exists
- [ ] Annotate mode shows badge/indicator
- [ ] Exit Annotate button works
- [ ] No console errors

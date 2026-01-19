# UI/UX Navigation Recommendations

> **Document Purpose**: Comprehensive UI navigation improvements with implementation details, file references, and handoff notes for AI context continuity.
>
> **Last Updated**: 2025-01-18
> **Status**: Planning Phase

---

## Quick Reference

### Key Files for Navigation Changes

| File | Purpose | Lines of Interest |
|------|---------|-------------------|
| `src/frontend/src/App.jsx` | Main router, framing/overlay header | L196-206 (Projects button), L207-214 (header title) |
| `src/frontend/src/screens/AnnotateScreen.jsx` | Annotate header | L299-314 (Projects button and title) |
| `src/frontend/src/screens/ProjectsScreen.jsx` | Hub screen, Games/Projects tabs | L218-249 (main render) |
| `src/frontend/src/components/ProjectManager.jsx` | Hub content, tabs, lists | L241-281 (header and tabs) |
| `src/frontend/src/components/shared/ModeSwitcher.jsx` | Framing/Overlay tabs | L43-61 (modes config) |
| `src/frontend/src/components/GalleryButton.jsx` | Global gallery access | Already complete |
| `src/frontend/src/components/DownloadsPanel.jsx` | Gallery slide-out panel | Already complete |
| `src/frontend/src/stores/editorStore.js` | Editor mode state, SCREENS enum | L15-20 (SCREENS), L76-79 (setEditorMode) |
| `src/frontend/src/stores/navigationStore.js` | Navigation history, goBack | L44-52 (goBack), L23 (history) |

### Current Navigation Architecture

```
editorStore.editorMode: 'project-manager' | 'framing' | 'overlay' | 'annotate'
                              │
                              ▼
                     ┌────────────────┐
                     │    App.jsx     │
                     │  (mode router) │
                     └────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
  ProjectsScreen        AnnotateScreen       Framing/Overlay
  (editorMode !=        (editorMode ==       (editorMode ==
   'annotate' &&         'annotate')          'framing' or
   no project)                                'overlay')
```

---

## Task Status Overview

| # | Task | Priority | Status | Effort |
|---|------|----------|--------|--------|
| ✓ | Replace "Projects" button with Home icon | High | COMPLETE | Low |
| ✓ | Add breadcrumb navigation | Medium | COMPLETE | Medium |
| ✓ | Add "Annotate" mode indicator | Medium | COMPLETE | Low |
| 4 | Reorder project mode tabs | Medium | VERIFIED - NO CHANGES NEEDED | Low |
| 5 | Unify tab styling | Low | NOT STARTED | Medium |
| 6 | Add zoom controls to Annotate | Low | NOT STARTED | Low |
| 7 | Standardize list interactions | Low | REVIEWED - DEFER | Low |
| 8 | Improve Players button styling | Low | NOT STARTED | Low |
| 9 | Add "Recent" section to Home | Low | NOT STARTED | Medium |
| ✓ | Unify fullscreen button | - | COMPLETE | - |

---

## Detailed Implementation Tasks

### Task 1: Replace "Projects" Button with Home Icon

**Priority**: High | **Status**: COMPLETE | **Effort**: Low

#### Problem

The "Projects" button appears on all editing screens but goes to a hub containing BOTH Games and Projects. When a user is in Annotate mode (which they entered via Games), clicking "Projects" is misleading.

**Current locations**:
- `App.jsx:196-206` - Framing/Overlay screens
- `AnnotateScreen.jsx:299-305` - Annotate screen

#### Solution

Replace with a Home icon button that universally means "go back to hub".

#### Implementation

**File: `src/frontend/src/App.jsx`**
```jsx
// Line 2 - Add Home import
import { FolderOpen, Home } from 'lucide-react';

// Lines 196-206 - Replace:
<Button
  variant="secondary"
  icon={FolderOpen}
  onClick={() => {
    clearSelection();
    fetchProjects();
    setEditorMode('project-manager');
  }}
>
  Projects
</Button>

// With:
<Button
  variant="ghost"
  icon={Home}
  iconOnly
  onClick={() => {
    clearSelection();
    fetchProjects();
    setEditorMode('project-manager');
  }}
  title="Home"
  className="text-gray-400 hover:text-white"
/>
```

**File: `src/frontend/src/screens/AnnotateScreen.jsx`**
```jsx
// Line 2 - Change import
import { Home } from 'lucide-react';  // was FolderOpen

// Lines 299-305 - Replace:
<Button
  variant="secondary"
  icon={FolderOpen}
  onClick={handleBackToProjects}
>
  Projects
</Button>

// With:
<Button
  variant="ghost"
  icon={Home}
  iconOnly
  onClick={handleBackToProjects}
  title="Home"
  className="text-gray-400 hover:text-white"
/>
```

#### Verification
- Click Home from Annotate → Should go to hub
- Click Home from Framing → Should go to hub
- Click Home from Overlay → Should go to hub
- Home button should have hover tooltip "Home"

---

### Task 2: Add Breadcrumb Navigation

**Priority**: Medium | **Status**: COMPLETE | **Effort**: Medium

#### Problem

Users don't always know what they're editing:
- Annotate shows "Annotate Game" (mode name, not game name)
- Framing/Overlay shows "Reel Ballers" (app name, not project name)

#### Solution

Add breadcrumb showing context: `Type › Item Name`

| Screen | Breadcrumb |
|--------|------------|
| Annotate | `Games › [game name]` |
| Framing | `Projects › [project name]` |
| Overlay | `Projects › [project name]` |

#### Implementation

**New File: `src/frontend/src/components/shared/Breadcrumb.jsx`**
```jsx
import { ChevronRight } from 'lucide-react';

/**
 * Breadcrumb - Shows navigation context
 *
 * @param {string} type - Category type ('Games' or 'Projects')
 * @param {string} itemName - Name of the selected item
 */
export function Breadcrumb({ type, itemName }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-gray-400 text-sm">{type}</span>
      {itemName && (
        <>
          <ChevronRight className="w-4 h-4 text-gray-600" />
          <span className="text-white font-semibold">{itemName}</span>
        </>
      )}
    </div>
  );
}

export default Breadcrumb;
```

**Update `src/frontend/src/components/shared/index.js`**:
```jsx
export { Breadcrumb } from './Breadcrumb';
```

**File: `src/frontend/src/App.jsx`** (Lines 207-214)
```jsx
// Replace static title with Breadcrumb
import { Breadcrumb } from './components/shared';

// In header, replace:
<div>
  <h1 className="text-4xl font-bold text-white mb-2">
    Reel Ballers
  </h1>
  <p className="text-gray-400">
    Showcase your player's brilliance
  </p>
</div>

// With:
<Breadcrumb
  type="Projects"
  itemName={selectedProject?.name}
/>
```

**File: `src/frontend/src/screens/AnnotateScreen.jsx`** (Lines 306-309)

Need to pass game name from AnnotateContainer. The game info is available via `annotate.gameName` or similar (needs to be exposed from container).

```jsx
// In header, replace:
<div>
  <h1 className="text-4xl font-bold text-white mb-2">Annotate Game</h1>
  <p className="text-gray-400">Mark clips to extract from your game footage</p>
</div>

// With:
<Breadcrumb
  type="Games"
  itemName={gameName}  // Need to expose from AnnotateContainer
/>
```

#### Dependencies
- Need to expose `gameName` from `AnnotateContainer` or `useGames` hook
- Check `src/frontend/src/containers/AnnotateContainer.jsx` for game state

#### Verification
- Framing shows "Projects › [project name]"
- Overlay shows "Projects › [project name]"
- Annotate shows "Games › [game name]"
- Breadcrumb updates when switching projects/games

---

### Task 3: Add "Annotate" Mode Indicator

**Priority**: Medium | **Status**: COMPLETE | **Effort**: Low

#### Problem

Framing/Overlay have mode tabs (via ModeSwitcher), but Annotate has nothing. Users may feel "lost" without a mode indicator.

#### Solution

Add a simple "Annotate" badge/indicator in the header (non-clickable, just visual).

#### Implementation

**File: `src/frontend/src/screens/AnnotateScreen.jsx`**

Add after Breadcrumb or in the right side of header:
```jsx
import { Scissors } from 'lucide-react';

// In header right side (Line 311-313), add:
<div className="flex items-center gap-2 px-4 py-2 bg-green-600/20 border border-green-600/40 rounded-lg">
  <Scissors size={16} className="text-green-400" />
  <span className="text-sm font-medium text-green-400">Annotate</span>
</div>
```

Note: ModeSwitcher already has this logic for when `mode === 'annotate' && hasAnnotateVideo` (lines 67-76 in ModeSwitcher.jsx). Could potentially reuse by always rendering it in Annotate mode.

#### Verification
- Annotate screen shows green "Annotate" badge
- Badge is positioned consistently with mode tabs on other screens

---

### Task 4: Reorder Project Mode Tabs

**Priority**: Medium | **Status**: NOT STARTED | **Effort**: Low

#### Problem

Current tab order: `Gallery | Framing | Overlay`
Workflow order: `Framing → Overlay → Gallery`

The tabs don't match the actual workflow progression.

#### Current Code Location
`src/frontend/src/components/shared/ModeSwitcher.jsx` lines 43-61

#### Solution

**Note from code review**: ModeSwitcher only shows `Framing` and `Overlay` tabs (lines 43-61). Gallery is NOT a tab here - it's a separate button (GalleryButton component). This is actually correct behavior.

The confusion in screenshots may be from a different component. Let me verify:
- ModeSwitcher.jsx: Only Framing and Overlay modes
- GalleryButton.jsx: Separate component for gallery access

**Revised Assessment**: The current implementation is correct. Gallery is already accessible globally via GalleryButton, not as a mode tab. No changes needed for this task.

**Status Update**: VERIFIED - NO CHANGES NEEDED

---

### Task 5: Unify Tab Styling

**Priority**: Low | **Status**: NOT STARTED | **Effort**: Medium

#### Problem

- Hub (ProjectManager): Pill toggle style with count badges `[Games (3)] [Projects (19)]`
- Project screens (ModeSwitcher): Rounded tabs with background `[Framing] [Overlay]`

#### Solution

Use consistent styling. Recommend extending the ModeSwitcher style to ProjectManager tabs.

#### Implementation

**File: `src/frontend/src/components/ProjectManager.jsx`** (Lines 248-281)

Current tab buttons use custom styling. Should adopt the pattern from ModeSwitcher for consistency.

```jsx
// Current (lines 248-281):
<div className="flex gap-1 mb-6 bg-gray-800 rounded-lg p-1">
  <button
    onClick={() => setActiveTab('games')}
    className={`... ${activeTab === 'games' ? 'bg-green-600' : '...'}`}
  >
    ...
  </button>
</div>

// Could create a shared TabSwitcher component or just align styles
```

#### Verification
- Hub tabs and mode tabs have similar visual appearance
- Both use rounded-lg backgrounds with color highlighting

---

### Task 6: Add Zoom Controls to Annotate

**Priority**: Low | **Status**: NOT STARTED | **Effort**: Low

#### Problem

Framing and Overlay have ZoomControls above the video. Annotate supports zooming (code exists in AnnotateScreen lines 79-85) but has no UI controls.

#### Current State

AnnotateScreen already has:
```jsx
const { zoom, panOffset, zoomByWheel, updatePan } = useZoom();
```

And passes these to AnnotateModeView (lines 362-365).

#### Solution

Add ZoomControls component to AnnotateModeView.

#### Implementation

**File: `src/frontend/src/modes/AnnotateModeView.jsx`**

Need to check current structure and add ZoomControls similar to FramingModeView/OverlayModeView.

```jsx
import ZoomControls from '../components/ZoomControls';

// In the view, add:
<ZoomControls
  zoom={zoom}
  onZoomIn={onZoomIn}
  onZoomOut={onZoomOut}
  onResetZoom={onResetZoom}
  minZoom={MIN_ZOOM}
  maxZoom={MAX_ZOOM}
/>
```

#### Dependencies
- Need to expose onZoomIn, onZoomOut, onResetZoom from useZoom hook or create them
- Check useZoom hook implementation at `src/frontend/src/hooks/useZoom.js`

---

### Task 7: Standardize List Interactions

**Priority**: Low | **Status**: NOT STARTED | **Effort**: Low

#### Problem

- Games list: Row with explicit "Load" button
- Projects list: Entire card is clickable

#### Current Code

**Games (ProjectManager.jsx, GameCard lines 537-593)**:
- Card has `onClick={onLoad}` (line 551)
- Also has separate Load button (lines 569-577)
- Both trigger the same action - redundant but works

**Projects (ProjectManager.jsx, ProjectCard lines 744-847)**:
- Card has `onClick={onSelect}` (line 786)
- No separate button

#### Solution

Both already support card-level click. The "Load" button on Games is redundant but provides clearer affordance. Could remove the button to unify, or add a similar "Open" button to projects.

Recommend: Keep as-is, both patterns work. The "Load" button on Games provides extra clarity since loading a game is a heavier operation.

**Status Update**: REVIEWED - LOW VALUE CHANGE, DEFER

---

### Task 8: Improve Players Button Styling (Overlay)

**Priority**: Low | **Status**: NOT STARTED | **Effort**: Low

#### Problem

The "Players" toggle button in Overlay mode sits next to zoom controls with different styling.

#### Current Location

`src/frontend/src/modes/OverlayModeView.jsx` - Need to locate the Players button

#### Solution

Either integrate into ZoomControls styling or move to a dedicated toolbar position.

---

### Task 9: Add "Recent" Section to Home

**Priority**: Low | **Status**: NOT STARTED | **Effort**: Medium

#### Problem

Users have to navigate through Games/Projects tabs to find what they were working on.

#### Solution

Add "Continue Where You Left Off" section showing recently accessed items.

#### Implementation

Would need:
1. Track last accessed timestamp for games and projects
2. Backend endpoint to fetch recent items
3. UI section on ProjectManager

**Backend schema already has**:
- `projects.last_opened_at` - Already tracked!
- `games.created_at` - No last_opened tracking

#### Dependencies
- Need to add `last_opened_at` to games table
- Create API endpoint for recent items
- Update ProjectManager UI

---

## Completed Tasks

### Replace "Projects" Button with Home Icon (COMPLETE)

**Completed**: 2025-01-18

Replaced the confusing "Projects" button with a universal Home icon button.

**Files Changed**:
- `src/frontend/src/App.jsx` - Changed import from FolderOpen to Home, updated button
- `src/frontend/src/screens/AnnotateScreen.jsx` - Changed import from FolderOpen to Home, updated button

---

### Add Breadcrumb Navigation (COMPLETE)

**Completed**: 2025-01-18

Added breadcrumb component showing context: `Type › Item Name` (e.g., "Games › wcfc-vs-carlsbad").

**Files Changed**:
- `src/frontend/src/components/shared/Breadcrumb.jsx` - NEW: Breadcrumb component
- `src/frontend/src/components/shared/index.js` - Added Breadcrumb export
- `src/frontend/src/App.jsx` - Replaced static title with Breadcrumb for project name
- `src/frontend/src/screens/AnnotateScreen.jsx` - Replaced static title with Breadcrumb for game name
- `src/frontend/src/modes/annotate/hooks/useAnnotateState.js` - Added annotateGameName state
- `src/frontend/src/containers/AnnotateContainer.jsx` - Set and expose annotateGameName

**Note**: Game name currently comes from the uploaded filename. The architecture supports switching to a user-provided name (rival + date) when that feature is added - just update `gameName` in `AnnotateContainer.handleGameVideoSelect`.

---

### Add "Annotate" Mode Indicator (COMPLETE)

**Completed**: 2025-01-18

Added green "Annotate" badge in the header to match mode tabs on Framing/Overlay screens.

**Files Changed**:
- `src/frontend/src/screens/AnnotateScreen.jsx` - Added Scissors icon import and mode indicator badge

---

### Unify Fullscreen Button (COMPLETE)

**Completed**: 2025-01-18

Changed fullscreen button placement from inconsistent (Annotate: bottom bar, Framing/Overlay: zoom controls) to consistent (always in bottom control bar).

**Files Changed**:
- `src/frontend/src/components/Controls.jsx` - Added fullscreen button support
- `src/frontend/src/components/ZoomControls.jsx` - Removed fullscreen button
- `src/frontend/src/modes/FramingModeView.jsx` - Moved fullscreen to Controls
- `src/frontend/src/modes/OverlayModeView.jsx` - Moved fullscreen to Controls

---

## AI Handoff Notes

### Context for Resuming Work

1. **Navigation is managed by `editorStore`** (not `navigationStore`)
   - `navigationStore` exists but is underutilized
   - `editorStore.editorMode` is the source of truth for routing
   - `editorStore.SCREENS` provides typed screen definitions

2. **Gallery is already global**
   - `GalleryButton` component is self-contained
   - `DownloadsPanel` is a slide-out panel, not a route
   - `galleryStore` manages open/close state and count
   - No routing changes needed for Gallery access

3. **Two header locations to update**:
   - `App.jsx` lines 193-229 (Framing/Overlay)
   - `AnnotateScreen.jsx` lines 296-314 (Annotate)
   - ProjectManager has its own header (line 240-245)

4. **Project/Game context**:
   - `selectedProject` available via `useProjects()` hook
   - Game name needs to be exposed from `AnnotateContainer`
   - Check `src/frontend/src/containers/AnnotateContainer.jsx`

5. **Existing patterns to follow**:
   - Button component at `components/shared/Button.jsx`
   - Icon imports from `lucide-react`
   - Zustand stores for global state
   - Self-contained screen components own their state

### Starting Point for Implementation

Recommended order:
1. **Task 1** (Home icon) - Single file changes, immediate impact
2. **Task 3** (Annotate indicator) - Simple addition
3. **Task 2** (Breadcrumb) - New component + integration

### Testing Checklist

After any navigation changes:
- [ ] Home button works from all screens
- [ ] Mode switching works (Framing ↔ Overlay)
- [ ] Gallery opens from all screens
- [ ] Loading a game goes to Annotate
- [ ] Loading a project goes to correct mode (framing/overlay based on state)
- [ ] Back button in browser works as expected

---

## Appendix: Current Navigation Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              APPLICATION FLOW                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   START                                                                     │
│     │                                                                       │
│     ▼                                                                       │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                         ProjectsScreen                               │   │
│   │                     (editorMode != 'annotate'                        │   │
│   │                      && !selectedProject)                            │   │
│   │  ┌─────────────────────────────────────────────────────────────┐    │   │
│   │  │                     ProjectManager                           │    │   │
│   │  │   ┌─────────────┐              ┌─────────────┐              │    │   │
│   │  │   │   [Games]   │              │  [Projects] │              │    │   │
│   │  │   │             │              │             │              │    │   │
│   │  │   │  Game List  │              │Project List │              │    │   │
│   │  │   │  - Load btn │              │ - Clickable │              │    │   │
│   │  │   └──────┬──────┘              └──────┬──────┘              │    │   │
│   │  │          │                            │                      │    │   │
│   │  └──────────┼────────────────────────────┼──────────────────────┘    │   │
│   └─────────────┼────────────────────────────┼───────────────────────────┘   │
│                 │                            │                               │
│                 ▼                            ▼                               │
│   ┌─────────────────────────┐   ┌─────────────────────────────────────────┐ │
│   │     AnnotateScreen      │   │            App.jsx (main)               │ │
│   │  (editorMode='annotate')│   │  (selectedProject && mode=framing/      │ │
│   │                         │   │   overlay)                              │ │
│   │  ┌───────────────────┐  │   │  ┌─────────────────────────────────┐   │ │
│   │  │ [Projects] btn    │  │   │  │ [Projects] btn                  │   │ │
│   │  │ "Annotate Game"   │  │   │  │ "Reel Ballers"                  │   │ │
│   │  │ [Gallery]         │  │   │  │ [Gallery] [Framing] [Overlay]   │   │ │
│   │  │                   │  │   │  │                                 │   │ │
│   │  │ AnnotateModeView  │  │   │  │ FramingScreen / OverlayScreen   │   │ │
│   │  └───────────────────┘  │   │  └─────────────────────────────────┘   │ │
│   └─────────────────────────┘   └─────────────────────────────────────────┘ │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

LEGEND:
  [Button]  = Interactive element
  ───────── = Container boundary
  ──────▶   = Navigation flow
```

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2025-01-18 | Initial recommendations |
| 1.1 | 2025-01-18 | Added file references, task status, handoff notes |
| 1.2 | 2025-01-18 | Completed fullscreen unification task |
| 1.3 | 2025-01-18 | Completed: Home icon, Breadcrumb navigation, Annotate mode indicator |

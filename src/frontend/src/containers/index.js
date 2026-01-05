/**
 * Containers - Mode-specific container components
 *
 * These containers encapsulate mode-specific logic, handlers, and UI
 * to reduce App.jsx complexity and improve AI context efficiency.
 *
 * Each container:
 * - Takes shared dependencies as props (videoRef, video controls, etc.)
 * - Manages all mode-specific state and handlers internally
 * - Returns state/handlers for App.jsx to use
 * - Includes helper components for mode-specific UI
 *
 * @see APP_REFACTOR_PLAN.md for refactoring context
 */

// Annotate mode container
export {
  AnnotateContainer,
  AnnotateSidebar,
  AnnotateVideoOverlays,
  AnnotateVideoControls,
  AnnotateTimeline,
  AnnotateExportPanel,
} from './AnnotateContainer';

// Overlay mode container
export {
  OverlayContainer,
  OverlayVideoOverlays,
  OverlayTimeline,
} from './OverlayContainer';

// Framing mode container
export {
  FramingContainer,
  FramingVideoOverlay,
  FramingTimeline,
} from './FramingContainer';

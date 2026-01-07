/**
 * Screen Components
 *
 * Self-contained screen components that own their hooks and state.
 * Each screen is a complete view that can be rendered by App.jsx.
 *
 * Benefits:
 * - Hooks only run when screen is active (performance)
 * - Each screen is self-contained (easier debugging)
 * - Smaller files to load for context (AI efficiency)
 *
 * @see tasks/PHASE2-ARCHITECTURE-PLAN.md for architecture context
 */

export { FramingScreen } from './FramingScreen';
export { OverlayScreen } from './OverlayScreen';
export { AnnotateScreen } from './AnnotateScreen';
export { ProjectsScreen } from './ProjectsScreen';

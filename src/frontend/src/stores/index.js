/**
 * Zustand Stores
 *
 * Centralized state management using Zustand.
 * These stores replace useState hooks in App.jsx for cross-cutting concerns.
 *
 * @see CODE_SMELLS.md #15 for refactoring context
 * @see APP_REFACTOR_PLAN.md for App.jsx refactoring plan
 */

export { useEditorStore, SCREENS, getScreenByType } from './editorStore';
export { useExportStore } from './exportStore';
export { useVideoStore } from './videoStore';
export { useClipStore } from './clipStore';

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
export { useNavigationStore, useCurrentMode, useProjectId, useNavigate } from './navigationStore';
export { useProjectDataStore, useProjectClipsData, useSelectedClipIndex, useWorkingVideo, useProjectAspectRatio } from './projectDataStore';
export { useFramingStore, useFramingVideoFile, useFramingIncludeAudio, useFramingChangedSinceExport } from './framingStore';
export { useOverlayStore, useOverlayWorkingVideo, useOverlayClipMetadata, useOverlayEffectType, useOverlayIsLoading } from './overlayStore';

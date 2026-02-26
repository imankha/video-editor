/**
 * Zustand Stores
 *
 * Centralized state management using Zustand.
 * These stores replace useState hooks in App.jsx for cross-cutting concerns.
 *
 * @see CODE_SMELLS.md #15 for refactoring context
 * @see APP_REFACTOR_PLAN.md for App.jsx refactoring plan
 */

export { useEditorStore, EDITOR_MODES, SCREENS, getScreenByType } from './editorStore';
export { useExportStore } from './exportStore';
export { useVideoStore } from './videoStore';
// clipStore is deprecated - use useProjectDataStore instead (single source of truth)
export { useClipStore } from './clipStore';
export { useNavigationStore, useCurrentMode, useProjectId, useNavigate } from './navigationStore';
export { useProjectDataStore, useProjectClips, useSelectedClipId, useWorkingVideo, useProjectAspectRatio, useGlobalTransition } from './projectDataStore';
export { useFramingStore, useFramingVideoFile, useFramingIncludeAudio, useFramingChangedSinceExport } from './framingStore';
export { useOverlayStore, useOverlayEffectType, useOverlayIsLoading } from './overlayStore';
export { useGalleryStore, useGalleryIsOpen, useGalleryCount, useGalleryActions } from './galleryStore';
// gamesStore is deprecated — use useGamesDataStore instead (holds data + invalidation)
export { useGamesStore } from './gamesStore';
export { useGamesDataStore, useGames as useGamesList, useSelectedGame, useGamesLoading } from './gamesDataStore';
export { useProjectsStore, useProjects as useProjectsList, useSelectedProject, useSelectedProjectId, useProjectsLoading } from './projectsStore';
export { useSettingsStore, useProjectFilters, useFramingSettings, useOverlaySettings, useSettingsLoading, useSettingsInitialized } from './settingsStore';
export { useSyncStore, checkSyncStatus } from './syncStore';
export { useProfileStore, useCurrentProfile, useHasMultipleProfiles, useProfilesLoading } from './profileStore';

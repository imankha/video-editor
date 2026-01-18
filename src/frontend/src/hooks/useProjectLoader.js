import { useCallback } from 'react';
import { API_BASE } from '../config';
import { useNavigationStore } from '../stores/navigationStore';
import { useProjectDataStore } from '../stores/projectDataStore';
import { useClipStore } from '../stores/clipStore';
import { useFramingStore } from '../stores/framingStore';
import { useOverlayStore } from '../stores/overlayStore';
import { useVideoStore } from '../stores/videoStore';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';

/**
 * Helper to calculate effective duration for a clip (accounting for speed changes)
 */
function calculateEffectiveDuration(clip) {
  const segments = clip.segments_data ? JSON.parse(clip.segments_data) : {};
  const boundaries = segments.boundaries || [0, clip.duration || 0];
  const segmentSpeeds = segments.segmentSpeeds || {};
  const trimRange = segments.trimRange;

  const start = trimRange?.start ?? 0;
  const end = trimRange?.end ?? (clip.duration || 0);

  if (Object.keys(segmentSpeeds).length === 0) {
    return end - start;
  }

  let totalDuration = 0;
  for (let i = 0; i < boundaries.length - 1; i++) {
    const segStart = Math.max(boundaries[i], start);
    const segEnd = Math.min(boundaries[i + 1], end);
    if (segEnd > segStart) {
      const speed = segmentSpeeds[String(i)] || 1.0;
      totalDuration += (segEnd - segStart) / speed;
    }
  }
  return totalDuration;
}

/**
 * Build clip metadata for overlay mode from project clips
 */
function buildClipMetadata(clipsData) {
  if (!clipsData || clipsData.length === 0) return null;

  let currentTime = 0;
  const sourceClips = clipsData.map(clip => {
    const effectiveDuration = calculateEffectiveDuration(clip);
    const clipMeta = {
      name: clip.filename || clip.name || 'Clip',
      start_time: currentTime,
      end_time: currentTime + effectiveDuration,
      duration: effectiveDuration,
    };
    currentTime += effectiveDuration;
    return clipMeta;
  });

  return {
    source_clips: sourceClips,
    total_duration: currentTime,
  };
}

/**
 * Hook for loading projects with all associated data
 * Encapsulates the complex loading logic previously in App.jsx
 *
 * This hook populates the projectDataStore with loaded data that can be
 * consumed by FramingScreen and OverlayScreen.
 */
export function useProjectLoader() {
  const { setProjectId, navigate } = useNavigationStore();
  const {
    setClips,
    setWorkingVideo,
    setAspectRatio,
    setClipMetadata,
    setLoading,
    reset: resetProjectData,
  } = useProjectDataStore();
  const resetClipStore = useClipStore(state => state.reset);
  const resetFramingStore = useFramingStore(state => state.reset);
  const resetOverlayStore = useOverlayStore(state => state.reset);
  const resetVideoStore = useVideoStore(state => state.reset);

  /**
   * Load a project and navigate to appropriate mode
   * @param {Object} project - Project data from API
   * @param {Object} options - Loading options
   * @returns {Object} Loaded project data with clips, working video, etc.
   */
  const loadProject = useCallback(async (project, options = {}) => {
    const {
      mode = null, // Override auto-detected mode
      clipIndex = 0, // Which clip to select initially
      onClipsLoaded = null, // Callback when clips are loaded (for App.jsx integration)
      onWorkingVideoLoaded = null, // Callback when working video is loaded
      onProgress = () => {}, // Progress callback
    } = options;

    const projectId = project.id;

    try {
      // Reset all stores for new project to clear stale data
      resetProjectData();
      resetClipStore();
      resetFramingStore();
      resetOverlayStore();
      resetVideoStore();
      setLoading(true, 'loading');

      onProgress({ stage: 'loading', message: 'Loading project...' });

      // Update navigation state
      setProjectId(projectId);

      // Determine target mode
      const targetMode = mode || (project.working_video_id ? 'overlay' : 'framing');
      console.log(`[useProjectLoader] Mode determination: working_video_id=${project.working_video_id}, mode override=${mode}, targetMode=${targetMode}`);

      // Update last_opened_at (non-blocking)
      fetch(`${API_BASE}/api/projects/${projectId}/state?update_last_opened=true`, {
        method: 'PATCH'
      }).catch(e => console.error('[useProjectLoader] Failed to update last_opened_at:', e));

      // Set aspect ratio from project
      const projectAspectRatio = project.aspect_ratio || '9:16';
      setAspectRatio(projectAspectRatio);

      onProgress({ stage: 'clips', message: 'Loading clips...' });
      setLoading(true, 'clips');

      // Fetch project clips
      const clipsResponse = await fetch(`${API_BASE}/api/clips/projects/${projectId}/clips`);
      const clipsData = clipsResponse.ok ? await clipsResponse.json() : [];

      console.log('[useProjectLoader] Fetched clips:', clipsData.length);

      // Load clip metadata (URLs and video metadata)
      const clipsWithMetadata = await Promise.all(
        clipsData.map(async (clip) => {
          const clipUrl = `${API_BASE}/api/clips/projects/${projectId}/clips/${clip.id}/file`;
          try {
            const metadata = await extractVideoMetadataFromUrl(clipUrl);
            return {
              ...clip,
              url: clipUrl,
              metadata,
            };
          } catch (err) {
            console.warn(`[useProjectLoader] Failed to load metadata for clip ${clip.id}:`, err);
            return { ...clip, url: clipUrl, metadata: null };
          }
        })
      );

      // Store clips in project data store
      setClips(clipsWithMetadata);

      // Calculate clip metadata for overlay mode
      const overlayClipMetadata = buildClipMetadata(clipsData);
      if (overlayClipMetadata) {
        setClipMetadata(overlayClipMetadata);
      }

      // Notify App.jsx about loaded clips (for legacy integration)
      if (onClipsLoaded && clipsWithMetadata.length > 0) {
        const targetClip = clipsWithMetadata[Math.min(clipIndex, clipsWithMetadata.length - 1)];
        await onClipsLoaded({
          clips: clipsWithMetadata,
          clipsData,
          projectId,
          projectAspectRatio,
          targetClipIndex: clipIndex,
          targetClip,
        });
      }

      // Load working video in background if it exists
      let workingVideo = null;
      if (project.working_video_id) {
        onProgress({ stage: 'working-video', message: 'Loading working video...' });
        setLoading(true, 'working-video');

        try {
          const response = await fetch(`${API_BASE}/api/projects/${projectId}/working-video`);
          if (response.ok) {
            const blob = await response.blob();
            const file = new File([blob], 'working_video.mp4', { type: 'video/mp4' });
            const url = URL.createObjectURL(file);
            const metadata = await extractVideoMetadata(file);

            workingVideo = { file, url, metadata };
            setWorkingVideo(workingVideo);

            // Notify App.jsx about working video (for legacy integration)
            if (onWorkingVideoLoaded) {
              await onWorkingVideoLoaded({
                file,
                url,
                metadata,
                clipMetadata: overlayClipMetadata,
              });
            }

            console.log('[useProjectLoader] Loaded working video for overlay mode');
          } else {
            console.warn('[useProjectLoader] Failed to load working video:', response.status);
          }
        } catch (err) {
          console.error('[useProjectLoader] Error loading working video:', err);
        }
      }

      setLoading(false, 'complete');
      onProgress({ stage: 'complete', message: 'Project loaded' });

      // Navigate to target mode
      navigate(targetMode);

      return {
        project,
        clips: clipsWithMetadata,
        selectedClipIndex: Math.min(clipIndex, clipsWithMetadata.length - 1),
        workingVideo,
        mode: targetMode,
        aspectRatio: projectAspectRatio,
        clipMetadata: overlayClipMetadata,
      };
    } catch (err) {
      console.error('[useProjectLoader] Failed to load project:', err);
      setLoading(false);
      throw err;
    }
  }, [setProjectId, navigate, resetProjectData, resetClipStore, resetFramingStore, resetOverlayStore, resetVideoStore, setClips, setWorkingVideo, setAspectRatio, setClipMetadata, setLoading]);

  return { loadProject };
}

export default useProjectLoader;

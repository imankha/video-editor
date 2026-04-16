import { useCallback } from 'react';
import { API_BASE, resolveApiUrl } from '../config';
import { useProjectDataStore } from '../stores/projectDataStore';
import { useFramingStore } from '../stores/framingStore';
import { useOverlayStore } from '../stores/overlayStore';
import { useVideoStore } from '../stores/videoStore';
// T1500: metadata probe removed from project load — dims live on working_clips.
import { getClipDisplayName } from '../utils/clipDisplayName';
import { extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { setWarmupPriority, WARMUP_PRIORITY } from '../utils/cacheWarming';

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
      name: clip.filename || getClipDisplayName(clip, 'Clip'),
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
 *
 * T250: Stores raw backend WorkingClipResponse data directly in projectDataStore.
 * No transformClipToUIFormat. Video metadata loaded into clipMetadataCache.
 * Backend clip IDs used directly.
 */
export function useProjectLoader() {
  const {
    setProjectClips,
    setWorkingVideo,
    setAspectRatio,
    setClipMetadata,
    setLoading,
    updateClipMetadata,
    setClipMetadataCache,
    reset: resetProjectData,
  } = useProjectDataStore();
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
      mode = null,
      clipIndex = 0,
      onClipsLoaded = null,
      onWorkingVideoLoaded = null,
      onProgress = () => {},
    } = options;

    const projectId = project.id;

    try {
      // Kill cache warmer permanently — user is loading real content now
      setWarmupPriority(WARMUP_PRIORITY.FOREGROUND_ACTIVE);

      // Reset all stores for new project to clear stale data
      resetProjectData();
      resetFramingStore();
      resetOverlayStore();
      resetVideoStore();
      setLoading(true, 'loading');

      onProgress({ stage: 'loading', message: 'Loading project...' });

      // Determine target mode
      const targetMode = mode || (project.working_video_id ? 'overlay' : 'framing');

      // Update last_opened_at (non-blocking)
      fetch(`${API_BASE}/api/projects/${projectId}/state?update_last_opened=true`, {
        method: 'PATCH'
      }).catch(e => console.error('[useProjectLoader] Failed to update last_opened_at:', e));

      // Set aspect ratio from project
      const projectAspectRatio = project.aspect_ratio || '9:16';
      setAspectRatio(projectAspectRatio);

      onProgress({ stage: 'clips', message: 'Loading clips...' });
      setLoading(true, 'clips');

      // Fetch project clips — raw backend data
      const clipsResponse = await fetch(`${API_BASE}/api/clips/projects/${projectId}/clips`);
      const clipsData = clipsResponse.ok ? await clipsResponse.json() : [];

      console.log('[useProjectLoader] Fetched clips:', clipsData.length);

      // T1500: dims (width/height/fps) live on working_clips. Probe fallback
      // only when dims are missing — a backfill gap should not brick the UI.
      const metadataCache = {};
      for (const clip of clipsData) {
        const hasUrl = (clip.game_video_url && clip.start_time != null && clip.end_time != null)
          || Boolean(clip.filename);
        if (!hasUrl) continue;

        let width = clip.width;
        let height = clip.height;
        let framerate = clip.fps;

        if (!width || !height || !framerate) {
          console.warn(
            `[useProjectLoader] T1500 gap: clip id=${clip.id} missing dims ` +
            `(width=${clip.width} height=${clip.height} fps=${clip.fps}). ` +
            `Probing URL as fallback. Run scripts/backfill_clip_dimensions.py to fix permanently.`
          );
          try {
            const probed = await extractVideoMetadataFromUrl(clip.game_video_url, `clip_${clip.id}.mp4`);
            width = width || probed.width;
            height = height || probed.height;
            framerate = framerate || probed.framerate;
          } catch (err) {
            console.error(`[useProjectLoader] Probe fallback failed for clip id=${clip.id}:`, err);
          }
        }

        const duration = (clip.start_time != null && clip.end_time != null)
          ? clip.end_time - clip.start_time
          : (clip.video_duration ?? 0);

        metadataCache[clip.id] = {
          duration,
          width,
          height,
          framerate,
          metadata: { duration, width, height, framerate },
        };
      }

      // Store raw clips and metadata cache in projectDataStore
      setClipMetadataCache(metadataCache);
      setProjectClips({ clips: clipsData, aspectRatio: projectAspectRatio });

      // Calculate clip metadata for overlay mode
      // Use duration from metadata cache for accurate calculations
      const clipsWithDuration = clipsData.map(clip => ({
        ...clip,
        duration: metadataCache[clip.id]?.duration || 0,
      }));
      const overlayClipMetadata = buildClipMetadata(clipsWithDuration);
      if (overlayClipMetadata) {
        setClipMetadata(overlayClipMetadata);
      }

      // Notify App.jsx about loaded clips (for legacy integration)
      if (onClipsLoaded && clipsData.length > 0) {
        const targetClipData = clipsData[Math.min(clipIndex, clipsData.length - 1)];
        await onClipsLoaded({
          clips: clipsData,
          clipsData,
          projectId,
          projectAspectRatio,
          targetClipIndex: clipIndex,
          targetClip: targetClipData,
        });
      }

      // Load working video in background if it exists
      let workingVideo = null;
      if (project.working_video_id && project.working_video_url) {
        onProgress({ stage: 'working-video', message: 'Loading working video...' });
        setLoading(true, 'working-video');

        try {
          const workingVideoUrl = resolveApiUrl(project.working_video_url);
          const metadata = await extractVideoMetadataFromUrl(workingVideoUrl, 'working_video.mp4');

          workingVideo = { file: null, url: workingVideoUrl, metadata };
          setWorkingVideo(workingVideo);

          if (onWorkingVideoLoaded) {
            await onWorkingVideoLoaded({
              file: null,
              url: workingVideoUrl,
              metadata,
              clipMetadata: overlayClipMetadata,
            });
          }

          console.log('[useProjectLoader] Loaded working video via streaming URL');
        } catch (err) {
          console.error('[useProjectLoader] Error loading working video:', err);
        }
      }

      setLoading(false, 'complete');
      onProgress({ stage: 'complete', message: 'Reel loaded' });

      return {
        project,
        clips: clipsData,
        selectedClipIndex: Math.min(clipIndex, clipsData.length - 1),
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
  }, [resetProjectData, resetFramingStore, resetOverlayStore, resetVideoStore, setProjectClips, setWorkingVideo, setAspectRatio, setClipMetadata, setLoading, setClipMetadataCache, updateClipMetadata]);

  return { loadProject };
}

export default useProjectLoader;

import { useCallback } from 'react';
import { API_BASE } from '../config';
import { useProjectDataStore } from '../stores/projectDataStore';
import { useFramingStore } from '../stores/framingStore';
import { useOverlayStore } from '../stores/overlayStore';
import { useVideoStore } from '../stores/videoStore';
import { extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { getClipDisplayName } from '../utils/clipDisplayName';
import { clipFileUrl as getClipFileUrlSelector } from '../utils/clipSelectors';

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

      // Load video metadata — deduplicate by URL so each game video is probed once
      const metadataCache = {};
      const urlMetadataMap = new Map(); // url -> Promise<metadata>

      // Build per-clip config and deduplicate URL probes
      const clipConfigs = clipsData.map(clip => {
        if (clip.game_video_url && clip.start_time != null && clip.end_time != null) {
          return { clip, url: clip.game_video_url, durationOverride: clip.end_time - clip.start_time };
        } else if (clip.filename) {
          return { clip, url: getClipFileUrlSelector(clip, projectId), durationOverride: null };
        }
        return { clip, url: null, durationOverride: null };
      });

      // Probe each unique URL once
      for (const { url } of clipConfigs) {
        if (url && !urlMetadataMap.has(url)) {
          urlMetadataMap.set(url, extractVideoMetadataFromUrl(url).catch(err => {
            console.warn(`[useProjectLoader] Failed to load metadata from ${url?.substring(0, 60)}:`, err);
            return null;
          }));
        }
      }

      // Wait for all unique probes, then build cache
      await Promise.all(urlMetadataMap.values());

      for (const { clip, url, durationOverride } of clipConfigs) {
        if (!url) continue;
        const metadata = await urlMetadataMap.get(url);
        const duration = durationOverride ?? metadata?.duration ?? 0;
        metadataCache[clip.id] = {
          duration,
          width: metadata?.width || 0,
          height: metadata?.height || 0,
          framerate: metadata?.framerate || 30,
          metadata: { ...metadata, duration },
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
          const metadata = await extractVideoMetadataFromUrl(project.working_video_url, 'working_video.mp4');

          workingVideo = { file: null, url: project.working_video_url, metadata };
          setWorkingVideo(workingVideo);

          if (onWorkingVideoLoaded) {
            await onWorkingVideoLoaded({
              file: null,
              url: project.working_video_url,
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
      onProgress({ stage: 'complete', message: 'Project loaded' });

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

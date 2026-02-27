import { useCallback } from 'react';
import { API_BASE } from '../config';
import { useNavigationStore } from '../stores/navigationStore';
import { useProjectDataStore } from '../stores/projectDataStore';
import { useFramingStore } from '../stores/framingStore';
import { useOverlayStore } from '../stores/overlayStore';
import { useVideoStore } from '../stores/videoStore';
import { extractVideoMetadata, extractVideoMetadataFromUrl } from '../utils/videoMetadata';
import { getClipDisplayName } from '../utils/clipDisplayName';

/**
 * Generate a unique client-side clip ID
 */
function generateClipId() {
  return 'clip_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Transform a backend clip to UI format
 * Parses JSON fields and adds client-side fields
 */
function transformClipToUIFormat(backendClip, metadata, clipUrl, presignedUrl) {
  const id = generateClipId();
  const fileName = backendClip.filename || 'clip.mp4';
  const fileNameDisplay = fileName.replace(/\.[^/.]+$/, '');

  // Parse saved framing edits if they exist
  let cropKeyframes = [];
  let segments = null;
  let trimRange = null;

  if (backendClip.crop_data) {
    try {
      cropKeyframes = JSON.parse(backendClip.crop_data);
    } catch (e) {
      console.warn('[useProjectLoader] Failed to parse crop_data:', e);
    }
  }

  if (backendClip.segments_data) {
    try {
      segments = JSON.parse(backendClip.segments_data);
    } catch (e) {
      console.warn('[useProjectLoader] Failed to parse segments_data:', e);
    }
  }

  if (backendClip.timing_data) {
    try {
      const timingData = JSON.parse(backendClip.timing_data);
      trimRange = timingData.trimRange || null;
    } catch (e) {
      console.warn('[useProjectLoader] Failed to parse timing_data:', e);
    }
  }

  return {
    // Client-side ID
    id,
    // Backend ID for API calls
    workingClipId: backendClip.id,
    // File references
    file: null, // No File object for project clips
    fileUrl: presignedUrl || clipUrl,
    url: clipUrl,
    // Display names
    fileName,
    fileNameDisplay,
    // Video metadata
    duration: metadata?.duration || 0,
    sourceWidth: metadata?.width || 0,
    sourceHeight: metadata?.height || 0,
    framerate: metadata?.framerate || 30,
    metadata,
    // Clip annotations from backend
    annotateName: backendClip.name || null,
    annotateNotes: backendClip.notes || null,
    annotateStartTime: backendClip.start_time || null,
    annotateEndTime: backendClip.end_time || null,
    gameId: backendClip.game_id || null,
    tags: backendClip.tags || [],
    rating: backendClip.rating || null,
    // Extraction status - derive isExtracted from filename presence
    // (file_url may be null in local dev without R2, but filename is always set for extracted clips)
    // T249: Fix status mapping — backend sends 'running', not 'processing'
    isExtracted: !!backendClip.filename,
    isExtracting: backendClip.extraction_status === 'running' || backendClip.extraction_status === 'pending',
    isFailed: backendClip.extraction_status === 'failed',
    extractionStatus: backendClip.extraction_status || null,
    // Parsed framing data (UI-ready)
    segments: segments || {
      boundaries: [0, metadata?.duration || 0],
      userSplits: [],
      trimRange: null,
      segmentSpeeds: {}
    },
    cropKeyframes,
    trimRange,
  };
}

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
 * Encapsulates the complex loading logic previously in App.jsx
 *
 * This hook populates the projectDataStore with loaded data that can be
 * consumed by FramingScreen and OverlayScreen.
 */
export function useProjectLoader() {
  const { setProjectId, navigate } = useNavigationStore();
  const {
    setProjectClips,
    setWorkingVideo,
    setAspectRatio,
    setClipMetadata,
    setLoading,
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

      console.log('[useProjectLoader] Fetched clips:', clipsData.length, 'first clip file_url:', clipsData[0]?.file_url);

      // Load clip metadata and transform to UI format
      // Use presigned R2 URLs (file_url) when available for streaming, otherwise fall back to proxy
      const clipsWithMetadata = await Promise.all(
        clipsData.map(async (clip) => {
          // If clip has no filename, it's not extracted yet - skip metadata loading
          if (!clip.filename) {
            console.log('[useProjectLoader] Clip not extracted yet:', clip.id, 'status:', clip.extraction_status);
            return transformClipToUIFormat(clip, null, null, null);
          }

          // Prefer presigned R2 URL for streaming, fall back to proxy URL
          const clipUrl = clip.file_url || `${API_BASE}/api/clips/projects/${projectId}/clips/${clip.id}/file`;
          try {
            const metadata = await extractVideoMetadataFromUrl(clipUrl);
            // Transform to UI format with parsed JSON fields and client-side IDs
            return transformClipToUIFormat(clip, metadata, clipUrl, clip.file_url);
          } catch (err) {
            console.warn(`[useProjectLoader] Failed to load metadata for clip ${clip.id}:`, err);
            // Return transformed clip with null metadata
            return transformClipToUIFormat(clip, null, clipUrl, clip.file_url);
          }
        })
      );

      // Store clips in project data store with first clip selected
      setProjectClips({ clips: clipsWithMetadata, aspectRatio: projectAspectRatio });

      // Calculate clip metadata for overlay mode (used to auto-generate highlight regions)
      // Note: Only store in projectDataStore here. The overlayStore.clipMetadata should
      // only be set by FramingScreen when a fresh framing export completes - this triggers
      // auto-generation of highlight regions. For existing projects, we load saved regions
      // from the backend instead.
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
      if (project.working_video_id && project.working_video_url) {
        onProgress({ stage: 'working-video', message: 'Loading working video...' });
        setLoading(true, 'working-video');

        try {
          // Use streaming URL directly - no blob download!
          const metadata = await extractVideoMetadataFromUrl(project.working_video_url, 'working_video.mp4');

          workingVideo = { file: null, url: project.working_video_url, metadata };
          // Set in projectDataStore (canonical owner)
          setWorkingVideo(workingVideo);

          // Notify App.jsx about working video (for legacy integration)
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
  }, [setProjectId, navigate, resetProjectData, resetFramingStore, resetOverlayStore, resetVideoStore, setProjectClips, setWorkingVideo, setAspectRatio, setClipMetadata, setLoading]);

  return { loadProject };
}

export default useProjectLoader;

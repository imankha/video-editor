import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Download, Loader, AlertCircle } from 'lucide-react';
import axios from 'axios';
import ThreePositionToggle from './ThreePositionToggle';
import { Button, Toggle, ExportProgress, toast } from './shared';
import { useAppState } from '../contexts';
import { useExportStore } from '../stores';
import { useExportManager } from '../hooks/useExportManager';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { API_BASE } from '../config';
import { ExportStatus } from '../constants/exportStatus';

/**
 * Generate a unique ID for tracking export progress
 */
function generateExportId() {
  return 'export_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

// Export configuration - centralized for easy A/B testing
const EXPORT_CONFIG = {
  targetFps: 30,           // Fixed at 30fps
  exportMode: 'fast',      // Single-pass encoding (H.264, medium preset, CRF 15)
  // Future A/B test settings can be added here
};

/**
 * Calculate effective clip duration after trim and speed adjustments
 * @param {Object} clip - Clip object with duration, segments, trimRange
 * @returns {number} Effective duration in seconds
 *
 * Handles multiple data formats:
 * 1. Frontend format: {segments: {segmentSpeeds, boundaries, trimRange}, trimRange}
 * 2. DB saved format: {segments: {trim_start, trim_end, segments: [{start, end, speed}]}}
 */
function calculateEffectiveDuration(clip) {
  const segments = clip.segments || {};

  // Handle trimRange - can be in segments.trimRange, clip.trimRange, or as segments.trim_start/trim_end
  let trimRange = segments.trimRange || clip.trimRange;
  if (!trimRange && (segments.trim_start !== undefined || segments.trim_end !== undefined)) {
    // DB saved format uses trim_start/trim_end
    trimRange = {
      start: segments.trim_start ?? 0,
      end: segments.trim_end ?? clip.duration
    };
  }

  // Start with full duration or trimmed range
  const start = trimRange?.start ?? 0;
  const end = trimRange?.end ?? clip.duration;

  // Handle speed data - can be segmentSpeeds object or segments array
  const segmentSpeeds = segments.segmentSpeeds || {};
  const boundaries = segments.boundaries || [0, clip.duration];
  const speedSegmentsArray = segments.segments; // DB format: [{start, end, speed}]

  // Check if we have speed changes
  const hasSpeedChanges = Object.keys(segmentSpeeds).length > 0 ||
    (Array.isArray(speedSegmentsArray) && speedSegmentsArray.some(s => s.speed !== 1.0));

  // If no speed changes, simple calculation
  if (!hasSpeedChanges) {
    return end - start;
  }

  // Calculate duration accounting for speed changes
  let totalDuration = 0;

  if (Array.isArray(speedSegmentsArray) && speedSegmentsArray.length > 0) {
    // DB format: use segments array directly
    for (const seg of speedSegmentsArray) {
      const segStart = Math.max(seg.start, start);
      const segEnd = Math.min(seg.end, end);
      if (segEnd > segStart) {
        const speed = seg.speed || 1.0;
        totalDuration += (segEnd - segStart) / speed;
      }
    }
  } else {
    // Frontend format: use boundaries and segmentSpeeds
    for (let i = 0; i < boundaries.length - 1; i++) {
      const segStart = Math.max(boundaries[i], start);
      const segEnd = Math.min(boundaries[i + 1], end);

      if (segEnd > segStart) {
        const speed = segmentSpeeds[String(i)] || 1.0;
        totalDuration += (segEnd - segStart) / speed;
      }
    }
  }

  return totalDuration;
}

/**
 * Build clip metadata for overlay mode auto-highlight region creation
 * @param {Array} clips - Array of clip objects
 * @returns {Object} Metadata object with source_clips array
 */
function buildClipMetadata(clips) {
  if (!clips || clips.length === 0) return null;

  let currentTime = 0;
  const sourceClips = clips.map(clip => {
    const effectiveDuration = calculateEffectiveDuration(clip);

    const clipMeta = {
      name: clip.fileName,
      start_time: currentTime,
      end_time: currentTime + effectiveDuration
    };

    currentTime += effectiveDuration;
    return clipMeta;
  });

  return {
    version: 1,
    source_clips: sourceClips
  };
}

// Highlight effect styles mapped to toggle positions
const HIGHLIGHT_EFFECT_STYLES = ['brightness_boost', 'original', 'dark_overlay'];
const HIGHLIGHT_EFFECT_LABELS = ['Bright Inside', 'Yellow Inside', 'Dim Outside'];
const HIGHLIGHT_EFFECT_COLORS = ['bg-blue-600', 'bg-yellow-600', 'bg-purple-600'];

/**
 * ExportButton component - handles video export with AI upscaling
 *
 * Behavior varies by mode:
 * - Framing mode: Shows audio toggle, exports and transitions to Overlay mode
 * - Overlay mode: Shows highlight effect toggle, exports final video with download
 *
 * Multi-clip support:
 * - When clips array is provided, exports all clips with transitions
 * - Each clip has its own segments and crop keyframes
 * - Global aspect ratio and transition settings apply to all clips
 */
const ExportButton = forwardRef(function ExportButton({
  videoFile,
  cropKeyframes,
  highlightRegions = [],  // Array of { start_time, end_time, keyframes: [...] }
  isHighlightEnabled = false,
  segmentData,
  disabled,
  includeAudio,
  onIncludeAudioChange,
  highlightEffectType = 'original',       // 'brightness_boost' | 'original' | 'dark_overlay'
  onHighlightEffectTypeChange,            // Callback to change effect type (updates preview too)
  editorMode: editorModeProp,             // 'framing' | 'overlay' - now optional, from context
  onProceedToOverlay,          // Callback when framing export completes (receives blob)
  // Multi-clip props
  clips = null,                // Array of clip objects for multi-clip export
  globalAspectRatio = '9:16',  // Shared aspect ratio for all clips
  globalTransition = null,     // Transition settings { type, duration }
  // Project props (for saving final video to DB) - now optional, from context
  projectId: projectIdProp,    // Current project ID (for overlay mode DB save)
  projectName: projectNameProp, // Project name for download filename
  onExportComplete = null,     // Callback when export completes (to refresh project list)
  onExportStart: onExportStartProp,  // Callback when export starts (optional, context used)
  onExportEnd: onExportEndProp,      // Callback when export ends (optional, context used)
  isExternallyExporting: isExternallyExportingProp, // Optional, derived from context
  externalProgress: externalProgressProp, // Optional, from context
  saveCurrentClipState = null,  // Function to save current clip state before backend-authoritative export
}, ref) {
  // Get app state from context (provides defaults for props above)
  const {
    editorMode: contextEditorMode,
    selectedProjectId,
    selectedProject,
    exportingProject,
    setExportingProject,
    globalExportProgress,
    setGlobalExportProgress,
  } = useAppState();

  // Get export store for persistent toast tracking and active exports
  const setExportCompleteToastId = useExportStore(state => state.setExportCompleteToastId);
  const activeExports = useExportStore(state => state.activeExports);
  // Note: We don't use startExportInStore - the store is only populated via WebSocket
  // messages from the backend. This ensures the DB is the single source of truth.
  const completeExportInStore = useExportStore(state => state.completeExport);
  const failExportInStore = useExportStore(state => state.failExport);

  // Use props if provided, otherwise fall back to context values
  const editorMode = editorModeProp ?? contextEditorMode ?? 'framing';
  const projectId = projectIdProp ?? selectedProjectId;
  const projectName = projectNameProp ?? selectedProject?.name;

  // Derive external exporting state from context if not provided as prop
  const isExternallyExporting = isExternallyExportingProp ?? (
    exportingProject?.projectId === selectedProjectId &&
    exportingProject?.stage === (editorMode === 'framing' ? 'framing' : 'overlay')
  );

  // Use context progress if not provided as prop
  const externalProgress = externalProgressProp ?? (
    exportingProject?.projectId === selectedProjectId ? globalExportProgress : null
  );

  // Export callbacks - use props if provided, otherwise use context setters
  const handleExportStart = (exportId) => {
    if (onExportStartProp) {
      onExportStartProp(exportId);
    } else if (setExportingProject) {
      setExportingProject({
        projectId: selectedProjectId,
        stage: editorMode === 'framing' ? 'framing' : 'overlay',
        exportId: exportId
      });
    }
  };

  const handleExportEnd = () => {
    if (onExportEndProp) {
      onExportEndProp();
    } else {
      if (setExportingProject) setExportingProject(null);
      if (setGlobalExportProgress) setGlobalExportProgress(null);
    }
  };
  const [isExporting, setIsExporting] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);  // Upload progress (0-10%)
  const [progressMessage, setProgressMessage] = useState('');

  // Get progress from the global export store for this project
  // Find the most recent active export for this project
  const currentExportFromStore = Object.values(activeExports)
    .filter(exp => exp.projectId === projectId && (exp.status === ExportStatus.PENDING || exp.status === ExportStatus.PROCESSING))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];

  // Combine internal, external, AND store-based exporting state
  // This ensures we show busy state even after page refresh
  const isCurrentlyExporting = isExporting || isExternallyExporting || !!currentExportFromStore;

  // Refs for tracking export state
  const [error, setError] = useState(null);
  const [audioExplicitlySet, setAudioExplicitlySet] = useState(false);
  const exportIdRef = useRef(null);
  const uploadCompleteRef = useRef(false);
  const handleExportRef = useRef(null);

  // SINGLE SOURCE OF TRUTH for progress:
  // - During upload phase (localProgress > 0 and upload not complete): use local state
  // - After upload / from recovery: use store progress from WebSocket
  // This prevents wild swings from mixing multiple progress sources
  const storeProgress = currentExportFromStore?.progress?.percent ?? 0;
  const storeMessage = currentExportFromStore?.progress?.message ?? '';

  const isInUploadPhase = isExporting && !uploadCompleteRef.current && localProgress > 0;
  const displayProgress = isInUploadPhase ? localProgress : storeProgress;
  const displayMessage = isInUploadPhase ? progressMessage : (storeMessage || progressMessage);

  // === PROGRESS TRACKING LOGGING ===
  // Log all progress state changes to understand the data flow
  const exportStartTimeRef = useRef(null);
  useEffect(() => {
    if (isExporting && !exportStartTimeRef.current) {
      exportStartTimeRef.current = Date.now();
      console.log(`[Progress] Export started at ${new Date().toISOString()}`);
    }
    if (!isExporting && exportStartTimeRef.current) {
      const duration = Date.now() - exportStartTimeRef.current;
      console.log(`[Progress] Export ended. Total duration: ${(duration/1000).toFixed(1)}s`);
      exportStartTimeRef.current = null;
    }
  }, [isExporting]);

  useEffect(() => {
    const elapsed = exportStartTimeRef.current ? ((Date.now() - exportStartTimeRef.current)/1000).toFixed(1) : '0';
    console.log(`[Progress] t=${elapsed}s | local=${localProgress}% store=${storeProgress}% display=${displayProgress}% | uploadComplete=${uploadCompleteRef.current} isInUploadPhase=${isInUploadPhase} | msg="${displayMessage}"`);
  }, [localProgress, storeProgress, displayProgress, isInUploadPhase, displayMessage]);

  // Map effect type to toggle position
  const effectTypeToPosition = { 'brightness_boost': 0, 'original': 1, 'dark_overlay': 2 };
  const positionToEffectType = ['brightness_boost', 'original', 'dark_overlay'];
  const highlightEffectPosition = effectTypeToPosition[highlightEffectType] ?? 1;

  // Note: WebSocket connections are now managed globally by ExportWebSocketManager
  // so they persist across component unmount/remount (e.g., navigation)

  // Auto-disable audio when slow motion is detected (unless user has explicitly set audio)
  useEffect(() => {
    if (!audioExplicitlySet && segmentData && segmentData.segments && onIncludeAudioChange) {
      // Check if any segment has slow motion (speed < 1)
      const hasSlowMotion = segmentData.segments.some(segment => segment.speed < 1);
      if (hasSlowMotion && includeAudio) {
        console.log('[ExportButton] Auto-disabling audio due to slow motion');
        onIncludeAudioChange(false);
      }
    }
  }, [segmentData, audioExplicitlySet, includeAudio, onIncludeAudioChange]);

  /**
   * Connect to WebSocket for real-time progress updates using the global manager.
   * The global manager handles reconnection, keepalive, and persists across navigation.
   *
   * NOTE: We do NOT call startExportInStore here. The store should only be populated
   * from WebSocket messages (which come from the backend DB state).
   * This ensures the frontend only reflects state, never creates it.
   */
  const connectWebSocket = useCallback(async (exportId) => {
    console.log('[ExportButton] Connecting to WebSocket via global manager for:', exportId);

    // Connect via global manager - it handles all WebSocket lifecycle
    // The WebSocket progress messages will populate the store via updateExportProgress
    const connected = await exportWebSocketManager.connect(exportId, {
      onProgress: (progress, message) => {
        // Also update local progress message for display
        setProgressMessage(message || '');
      },
      onComplete: (data) => {
        console.log('[ExportButton] Export completed via WebSocket:', data);
      },
      onError: (error) => {
        console.error('[ExportButton] Export error via WebSocket:', error);
      }
    });

    return { connected };
  }, []);

  /**
   * Wait for export job to complete by polling status
   * Used when WebSocket disconnects or as fallback
   */
  const pollJobStatus = async (jobId) => {
    const maxAttempts = 600; // 10 minutes with 1 second interval
    const pollInterval = 1000;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await axios.get(`${API_BASE}/api/exports/${jobId}`);
        const job = response.data;

        if (job.status === ExportStatus.COMPLETE) {
          return { success: true, job };
        } else if (job.status === ExportStatus.ERROR) {
          return { success: false, error: job.error };
        }

        // Still processing, wait and continue
        await new Promise(r => setTimeout(r, pollInterval));
      } catch (err) {
        console.warn('[ExportButton] Poll failed, retrying:', err.message);
        await new Promise(r => setTimeout(r, pollInterval));
      }
    }

    return { success: false, error: 'Export timed out' };
  };

  const handleExport = async () => {
    // Backend can handle video when:
    // 1. Overlay mode with projectId (video from working_video in R2)
    // 2. Framing mode with project clips (videos from working_clips in R2)
    const hasProjectClips = clips && clips.length > 0 && clips.some(c => c.workingClipId);
    const isBackendAuthoritative = (editorMode === 'overlay' && projectId) ||
                                   (editorMode === 'framing' && hasProjectClips);
    if (!videoFile && !isBackendAuthoritative) {
      setError('No video file loaded');
      return;
    }

    // Debug: Log current store state before starting
    console.log('[ExportButton] Current activeExports before starting:',
      Object.keys(activeExports).length,
      Object.values(activeExports).map(e => `${e.exportId}(${e.status})`).join(', '));

    // Mode-specific validation
    if (editorMode === 'framing') {
      // Framing mode requires crop keyframes
      if (!cropKeyframes || cropKeyframes.length === 0) {
        setError('No crop keyframes defined. Please add at least one crop keyframe.');
        return;
      }
    }
    // Overlay mode: No crop validation needed (crop already baked in)
    // Highlights are optional - export works with or without them

    setIsExporting(true);
    setLocalProgress(0);
    setProgressMessage('Checking server...');
    setError(null);
    uploadCompleteRef.current = false;

    // Quick health check before starting export
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout for E2E tests
      const healthResponse = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!healthResponse.ok) {
        throw new Error(`Server returned ${healthResponse.status}: ${healthResponse.statusText}`);
      }
    } catch (healthErr) {
      console.error('[ExportButton] Server health check failed:', healthErr);
      // Provide more specific error messages based on error type
      let errorMsg;
      if (healthErr.name === 'AbortError') {
        errorMsg = 'Server connection timed out. The backend may be slow or unresponsive.';
      } else if (healthErr.message.includes('Failed to fetch') || healthErr.message.includes('NetworkError')) {
        errorMsg = 'Cannot connect to server. Please ensure the backend server is running on port 8000.';
      } else {
        errorMsg = `Server error: ${healthErr.message}`;
      }
      setError(errorMsg);
      setProgressMessage('Server unreachable');
      setIsExporting(false);
      handleExportEnd();
      return;
    }

    setProgressMessage('Uploading...');

    // Generate unique export ID
    const exportId = generateExportId();
    exportIdRef.current = exportId;

    // Notify parent with exportId for global WebSocket tracking
    handleExportStart(exportId);

    try {
      // Prepare form data based on mode
      const formData = new FormData();
      // Only append videoFile if we have it (not for streaming/project clips)
      if (videoFile) {
        formData.append('video', videoFile);
      }
      formData.append('export_id', exportId);
      // Send project_id so backend can create export_jobs record for tracking
      if (projectId) {
        formData.append('project_id', String(projectId));
      }

      let endpoint;

      if (editorMode === 'framing') {
        // Check if this is a multi-clip export
        const isMultiClip = clips && clips.length > 1;

        if (isMultiClip) {
          // Multi-clip export: Use multi-clip endpoint
          endpoint = `${API_BASE}/api/export/multi-clip`;

          // Append all clip files - handle both local files and project clips (URL-based)
          for (let index = 0; index < clips.length; index++) {
            const clip = clips[index];
            if (clip.file) {
              // Local file - append directly
              formData.append(`video_${index}`, clip.file);
            } else if (clip.workingClipId && projectId) {
              // Project clip - use backend streaming proxy to avoid CORS issues
              // This routes through the backend which fetches from R2 and streams to us
              const streamUrl = `${API_BASE}/api/clips/projects/${projectId}/clips/${clip.workingClipId}/file?stream=true`;
              console.log(`[ExportButton] Fetching clip ${index} via backend proxy:`, streamUrl);
              setProgressMessage(`Downloading clip ${index + 1}/${clips.length}...`);

              try {
                const response = await fetch(streamUrl);
                if (!response.ok) {
                  // Get more details from the response
                  let responseBody = '';
                  try {
                    responseBody = await response.text();
                  } catch {
                    responseBody = '(could not read response body)';
                  }

                  const statusText = response.status === 403 ? 'Access denied' :
                                    response.status === 404 ? 'Clip not found' :
                                    response.status === 502 ? 'Storage gateway error' :
                                    response.status === 503 ? 'Storage unavailable' :
                                    `HTTP ${response.status} ${response.statusText}`;

                  console.error(`[ExportButton] Clip fetch failed:`, {
                    clipIndex: index,
                    clipId: clip.workingClipId,
                    status: response.status,
                    statusText: response.statusText,
                    responseBody: responseBody.substring(0, 500)
                  });

                  throw new Error(`CLIP_FETCH_ERROR: Failed to download clip ${index + 1}: ${statusText}`);
                }
                const blob = await response.blob();
                console.log(`[ExportButton] Successfully downloaded clip ${index}: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
                const file = new File([blob], clip.fileName || `clip_${index}.mp4`, { type: 'video/mp4' });
                formData.append(`video_${index}`, file);
              } catch (fetchErr) {
                // Re-throw if it's our custom error
                if (fetchErr.message.startsWith('CLIP_FETCH_ERROR:')) {
                  throw fetchErr;
                }

                console.error(`[ExportButton] Clip ${index} fetch error:`, {
                  errorName: fetchErr.name,
                  errorMessage: fetchErr.message,
                  clipId: clip.workingClipId,
                  stack: fetchErr.stack
                });

                throw new Error(`CLIP_FETCH_ERROR: Failed to download clip ${index + 1}: ${fetchErr.message || 'Network error'}. Server may be unavailable.`);
              }
            } else if (clip.fileUrl) {
              // Fallback: Direct URL fetch (may have CORS issues with R2)
              console.warn(`[ExportButton] Clip ${index} missing workingClipId, falling back to direct URL fetch`);
              const urlForLog = clip.fileUrl.includes('?') ? clip.fileUrl.split('?')[0] + '?...' : clip.fileUrl;
              console.log(`[ExportButton] Fetching clip ${index} from URL:`, urlForLog);
              setProgressMessage(`Downloading clip ${index + 1}/${clips.length}...`);

              const response = await fetch(clip.fileUrl);
              if (!response.ok) {
                throw new Error(`CLIP_FETCH_ERROR: Failed to download clip ${index + 1}: HTTP ${response.status}`);
              }
              const blob = await response.blob();
              const file = new File([blob], clip.fileName || `clip_${index}.mp4`, { type: 'video/mp4' });
              formData.append(`video_${index}`, file);
            } else {
              throw new Error(`CLIP_FETCH_ERROR: Clip ${index + 1} has no file or storage URL - please reload the project`);
            }
          }

          // Build multi-clip export data
          const multiClipData = {
            clips: clips.map((clip, index) => ({
              clipIndex: index,
              fileName: clip.fileName,
              duration: clip.duration,
              sourceWidth: clip.sourceWidth,
              sourceHeight: clip.sourceHeight,
              segments: clip.segments,
              cropKeyframes: clip.cropKeyframes,
              trimRange: clip.trimRange
            })),
            globalAspectRatio: globalAspectRatio,
            transition: globalTransition || { type: 'cut', duration: 0.5 }
          };

          console.log('=== MULTI-CLIP EXPORT: Sending clip data to backend ===');
          // Log each clip's segments and trimRange to verify data flow
          multiClipData.clips.forEach((c, i) => {
            console.log(`Clip ${i}: segments=${JSON.stringify(c.segments)}, trimRange=${JSON.stringify(c.trimRange)}, duration=${c.duration}`);
          });
          console.log('Full data:', JSON.stringify(multiClipData, null, 2));
          console.log('=======================================================');

          formData.append('multi_clip_data_json', JSON.stringify(multiClipData));
          formData.append('include_audio', includeAudio ? 'true' : 'false');
          formData.append('target_fps', String(EXPORT_CONFIG.targetFps));
          formData.append('export_mode', EXPORT_CONFIG.exportMode);
          // Add project info for saving working video to DB
          if (projectId) {
            formData.append('project_id', String(projectId));
          }
          if (projectName) {
            formData.append('project_name', projectName);
          }

        } else {
          // Single clip export: Backend-authoritative render
          // Backend reads crop_data, segments_data, timing_data from working_clips table
          // No need to send video or keyframes - backend fetches from storage

          if (projectId && saveCurrentClipState) {
            // Backend-authoritative mode: Save edits first, then request render
            console.log('[ExportButton] Using backend-authoritative render');
            setProgressMessage('Saving edits...');

            try {
              await saveCurrentClipState();
              console.log('[ExportButton] Clip state saved, requesting render');
            } catch (saveErr) {
              console.error('[ExportButton] Failed to save clip state:', saveErr);
              throw new Error('Failed to save clip edits before export. Please try again.');
            }

            // Use the new backend-authoritative endpoint
            endpoint = `${API_BASE}/api/export/render`;

            // Connect WebSocket for real-time progress updates
            setProgressMessage('Connecting...');
            await connectWebSocket(exportId);

            // Send render request (JSON body, no file upload)
            setProgressMessage('Starting render...');
            const renderResponse = await axios.post(endpoint, {
              project_id: projectId,
              export_id: exportId,
              export_mode: EXPORT_CONFIG.exportMode,
              target_fps: EXPORT_CONFIG.targetFps,
              include_audio: includeAudio
            });

            // Backend returns JSON with working_video info
            console.log('[ExportButton] Backend render complete:', renderResponse.data);

            // Trigger export complete flow
            handleExportEnd();
            setLocalProgress(100);
            setProgressMessage('Export complete!');
            completeExportInStore(exportId, {
              status: 'complete',
              workingVideoId: renderResponse.data.working_video_id,
              filename: renderResponse.data.filename
            });

            // Trigger proceed to overlay if callback provided
            // Pass projectId so the handler can verify this export matches the current project
            if (onProceedToOverlay) {
              onProceedToOverlay(null, buildClipMetadata(clips), projectId);
            }
            if (onExportComplete) {
              onExportComplete();
            }

            setIsExporting(false);
            return;  // Exit early - backend-authoritative path complete

          } else {
            // Fallback: Legacy client-sends-everything mode
            // Used when saveCurrentClipState not available or no projectId
            console.log('[ExportButton] Using legacy client-driven export');
            endpoint = `${API_BASE}/api/export/upscale`;

            formData.append('keyframes_json', JSON.stringify(cropKeyframes));
            // Audio setting only applies to framing export (overlay preserves whatever audio is in input)
            formData.append('include_audio', includeAudio ? 'true' : 'false');
            formData.append('target_fps', String(EXPORT_CONFIG.targetFps));
            formData.append('export_mode', EXPORT_CONFIG.exportMode);

            // Add segment data if available (speed/trim)
            if (segmentData) {
              console.log('=== EXPORT: Sending segment data to backend ===');
              console.log(JSON.stringify(segmentData, null, 2));
              console.log('==============================================');
              formData.append('segment_data_json', JSON.stringify(segmentData));
            } else {
              console.log('=== EXPORT: No segment data to send ===');
            }
          }
        }
        // Note: Highlight keyframes are NOT sent during framing export.
        // They are handled separately in Overlay mode after the video is cropped/upscaled.
      } else {
        // Overlay mode: Backend-authoritative render when projectId available
        // This uses Modal GPU when enabled, with R2 storage
        if (projectId) {
          console.log('[ExportButton] Using backend-authoritative overlay render');

          // Connect WebSocket for real-time progress updates
          setProgressMessage('Connecting...');
          await connectWebSocket(exportId);

          // Send render request (JSON body, no file upload needed - video is in R2)
          setProgressMessage('Starting render...');
          const renderResponse = await axios.post(`${API_BASE}/api/export/render-overlay`, {
            project_id: projectId,
            export_id: exportId,
            effect_type: highlightEffectType
          });

          console.log('[ExportButton] Overlay render complete:', renderResponse.data);

          // Download the final video from R2
          setProgressMessage('Preparing download...');
          const finalVideoUrl = `${API_BASE}/api/export/projects/${projectId}/final-video`;
          const downloadResponse = await axios.get(finalVideoUrl, { responseType: 'blob' });

          const blob = new Blob([downloadResponse.data], { type: 'video/mp4' });
          const safeName = projectName
            ? projectName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'video'
            : 'video';
          const downloadFilename = `${safeName}_final.mp4`;

          const url = window.URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = downloadFilename;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);

          // Refresh projects list if callback provided
          if (onExportComplete) {
            onExportComplete();
          }

          // Mark export as complete
          handleExportEnd();
          setLocalProgress(100);
          setProgressMessage('Export complete!');
          if (exportIdRef.current) {
            completeExportInStore(exportIdRef.current, {
              status: 'complete',
              finalVideoId: renderResponse.data.final_video_id,
              filename: renderResponse.data.filename,
              modalUsed: renderResponse.data.modal_used
            });
          }
          setIsExporting(false);
          return;  // Exit early - backend-authoritative path complete
        }

        // Fallback: Legacy client-upload mode (no projectId)
        console.log('[ExportButton] Using legacy overlay export (no projectId)');
        endpoint = `${API_BASE}/api/export/overlay`;

        // Add highlight regions (new multi-region format)
        if (highlightRegions && highlightRegions.length > 0) {
          formData.append('highlight_regions_json', JSON.stringify(highlightRegions));
        }
        formData.append('highlight_effect_type', highlightEffectType);
      }

      // Connect WebSocket for real-time progress updates
      // Wait for connection to be established before starting export
      await connectWebSocket(exportId);

      // Send export request
      // Framing mode returns JSON (backend saves video directly - MVC pattern)
      // Overlay mode returns blob (for download)
      const response = await axios.post(
        endpoint,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          responseType: editorMode === 'framing' ? 'json' : 'blob',
          onUploadProgress: (progressEvent) => {
            // Only update during upload phase, don't override WebSocket updates
            if (!uploadCompleteRef.current) {
              // Scale upload to 0-10% (leaving 10-100% for AI processing)
              const uploadPercent = Math.round(
                (progressEvent.loaded * 10) / progressEvent.total
              );
              setLocalProgress(uploadPercent);
              setProgressMessage('Uploading video...');

              // Mark upload as complete when done
              if (progressEvent.loaded === progressEvent.total) {
                uploadCompleteRef.current = true;
              }
            }
          }
        }
      );

      // WebSocket lifecycle is now managed by the global ExportWebSocketManager
      // It will automatically close when it receives status: 'complete'
      // and update the export store accordingly

      // In Framing mode, backend now saves working video directly (MVC pattern)
      // We just need to navigate to Overlay mode - it will fetch video from server
      if (editorMode === 'framing') {
        try {
          // Backend returns JSON with working_video_id (not a blob anymore)
          const result = response.data;
          console.log('[ExportButton] Framing export complete:', result);

          // Refresh projects list to show updated progress
          if (onExportComplete) {
            onExportComplete();
          }

          setLocalProgress(100);
          setProgressMessage('Loading into Overlay mode...');

          // Mark export as complete in the global store
          if (exportIdRef.current) {
            completeExportInStore(exportIdRef.current);
          }

          // Build clip metadata for auto-generating highlight regions
          const clipMetadata = clips && clips.length > 0 ? buildClipMetadata(clips) : null;

          if (clipMetadata) {
            console.log('[ExportButton] Built clip metadata for overlay:', clipMetadata);
          }

          // MVC: No blob needed - overlay mode will fetch working video from server
          // Pass null for blob, just the metadata for highlight generation
          // Include projectId so handler can verify this export matches current project
          if (onProceedToOverlay) {
            await onProceedToOverlay(null, clipMetadata, projectId);
          }

          setIsExporting(false);
          handleExportEnd();
          setLocalProgress(0);
          setProgressMessage('');
        } catch (err) {
          console.error('Failed to transition to overlay mode:', err);
          setError(err.message || 'Failed to transition to overlay mode');
          setIsExporting(false);
          handleExportEnd();
          setProgressMessage('Export complete, but overlay transition failed');
        }
      } else {
        // Overlay mode - backend returns blob for download
        const blob = new Blob([response.data], { type: 'video/mp4' });
        // Overlay mode - download the video AND save to database
        // Generate download filename from project name
        const safeName = projectName
          ? projectName.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') || 'video'
          : 'video';
        const downloadFilename = `${safeName}_final.mp4`;

        // Download the video
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = downloadFilename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        // Clean up download URL
        window.URL.revokeObjectURL(url);

        setLocalProgress(95);
        setProgressMessage('Saving to downloads...');

        // Save to database if we have a project ID
        if (projectId) {
          try {
            const saveFormData = new FormData();
            saveFormData.append('project_id', String(projectId));
            saveFormData.append('video', blob, 'final_video.mp4');
            saveFormData.append('overlay_data', JSON.stringify({
              highlightRegions: highlightRegions || [],
              effectType: highlightEffectType
            }));

            const saveResponse = await axios.post(
              `${API_BASE}/api/export/final`,
              saveFormData,
              { headers: { 'Content-Type': 'multipart/form-data' } }
            );

            console.log('[ExportButton] Saved final video to DB:', saveResponse.data);

            // Refresh projects list if callback provided
            if (onExportComplete) {
              onExportComplete();
            }
          } catch (saveErr) {
            console.error('[ExportButton] Failed to save final video to DB:', saveErr);
            // Don't block - download already succeeded
          }
        }

        setLocalProgress(100);
        setProgressMessage('Export complete!');

        // Mark export as complete in the global store
        if (exportIdRef.current) {
          completeExportInStore(exportIdRef.current);
        }

        // Show persistent toast notification for overlay export completion
        // Toast stays until user makes changes to the video
        const toastId = toast.success('Video exported!', {
          message: projectName ? `"${projectName}" has been downloaded and saved to your gallery.` : 'Your video has been downloaded.',
          duration: 0  // Persistent - dismissed when user makes changes
        });
        setExportCompleteToastId(toastId);

        setTimeout(() => {
          setIsExporting(false);
          handleExportEnd();
          setLocalProgress(0);
          setProgressMessage('');
        }, 2000);
      }

    } catch (err) {
      console.error('[ExportButton] Export failed:', err);

      // Mark export as failed in store (WebSocket manager will clean up connection)
      if (exportIdRef.current) {
        failExportInStore(exportIdRef.current, err.message || 'Export failed');
        exportWebSocketManager.disconnect(exportIdRef.current);
      }

      // Check for clip fetch errors (cloud storage issues)
      const isClipFetchError = err.message?.startsWith('CLIP_FETCH_ERROR:');
      if (isClipFetchError) {
        // Extract the user-friendly message (remove the prefix)
        const userMessage = err.message.replace('CLIP_FETCH_ERROR: ', '');
        setError(userMessage);
        setProgressMessage('Storage error');
        console.error('[ExportButton] Clip fetch failed - this is a cloud storage issue, not a server issue');
      } else {
        // Detect network errors (server unreachable) - but only for actual server calls
        const isNetworkError = !err.response && (
          err.code === 'ERR_NETWORK' ||
          err.code === 'ECONNREFUSED' ||
          err.message?.includes('Network Error') ||
          (err.message?.includes('Failed to fetch') && !err.message?.includes('clip'))
        );

        if (isNetworkError) {
          setError('Cannot connect to backend server. Please ensure the server is running on port 8000.');
          setProgressMessage('Server unreachable');
        } else if (err.response) {
          // Server responded with an error status
          const status = err.response.status;
          const statusText = err.response.statusText;
          let errorMessage = '';

          console.error(`[ExportButton] Server error ${status}:`, {
            status,
            statusText,
            data: err.response.data,
            headers: err.response.headers
          });

          // Try to extract error details from response
          if (err.response.data instanceof Blob) {
            try {
              const errorText = await err.response.data.text();
              const errorData = JSON.parse(errorText);
              console.error('[ExportButton] Server error details:', errorData);
              if (errorData.traceback) {
                console.error('[ExportButton] Traceback:', errorData.traceback.join('\n'));
                errorMessage = `${errorData.error || 'Error'}: ${errorData.message || errorData.detail || 'Unknown error'}\n\nCheck console for stack trace.`;
              } else {
                errorMessage = errorData.message || errorData.detail || errorData.error || `Server error (${status})`;
              }
            } catch (parseError) {
              errorMessage = `Server error (${status}). Check backend console for details.`;
            }
          } else if (typeof err.response.data === 'object') {
            // JSON response
            const data = err.response.data;
            console.error('[ExportButton] Server error details:', data);
            if (data.traceback) {
              console.error('[ExportButton] Traceback:', Array.isArray(data.traceback) ? data.traceback.join('\n') : data.traceback);
            }
            errorMessage = data.message || data.detail || data.error || `Server error (${status})`;
          } else if (typeof err.response.data === 'string') {
            errorMessage = err.response.data || `Server error (${status})`;
          } else {
            errorMessage = `Server error (${status}): ${statusText || 'Unknown error'}`;
          }

          setError(errorMessage);
          setProgressMessage('');
        } else {
          // Unknown error
          console.error('[ExportButton] Unknown error:', err);
          setError(err.message || 'Export failed. Please try again.');
          setProgressMessage('');
        }
      }

      setIsExporting(false);
      handleExportEnd();
      setLocalProgress(0);
    }
  };

  // Keep ref updated with latest handleExport (avoids stale closure in useImperativeHandle)
  handleExportRef.current = handleExport;

  // Expose triggerExport method to parent via ref
  // Uses ref to always call latest handleExport, avoiding stale closure issues
  useImperativeHandle(ref, () => ({
    triggerExport: () => handleExportRef.current?.(),
    isExporting,
    isCurrentlyExporting
  }), [isExporting, isCurrentlyExporting]);

  // Determine button text based on mode
  const isFramingMode = editorMode === 'framing';

  // Check if any clips are still being extracted
  const clipsNotExtracted = clips?.filter(c => c.isExtracted === false) || [];
  const hasUnextractedClips = clipsNotExtracted.length > 0;
  const extractingCount = clipsNotExtracted.filter(c => c.isExtracting || c.extractionStatus === 'running').length;
  const pendingCount = clipsNotExtracted.length - extractingCount;

  // Check if any clips are missing framing data (crop keyframes)
  // For multi-clip mode: check clips array
  // For single-clip mode: check cropKeyframes prop
  const isMultiClipMode = clips && clips.length > 0;
  const extractedClips = clips?.filter(c => c.isExtracted !== false) || [];
  const clipsNotFramed = extractedClips.filter(c => !c.cropKeyframes || c.cropKeyframes.length === 0);

  // Determine if there are unframed clips based on mode
  const hasUnframedClips = isMultiClipMode
    ? clipsNotFramed.length > 0
    : (!cropKeyframes || cropKeyframes.length === 0);
  const unframedCount = isMultiClipMode ? clipsNotFramed.length : (hasUnframedClips ? 1 : 0);
  const totalExtractedClips = isMultiClipMode ? extractedClips.length : 1;

  return (
    <div className="space-y-3">
      {/* Export Settings */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
        <div className="text-sm font-medium text-gray-300 mb-3">
          {isFramingMode ? 'Framing Settings' : 'Overlay Settings'}
        </div>

        {/* Audio Toggle - Framing mode only */}
        {isFramingMode && (
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Audio</span>
              <span className="text-xs text-gray-400">
                {includeAudio ? 'Include audio in export' : 'Export video only'}
              </span>
            </div>
            <Toggle
              checked={includeAudio}
              onChange={(value) => {
                onIncludeAudioChange(value);
                setAudioExplicitlySet(true);
              }}
              disabled={isCurrentlyExporting}
            />
          </div>
        )}

        {/* Highlight Effect Style - Overlay mode only */}
        {!isFramingMode && (
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-sm font-medium text-gray-200">Highlight Effect</span>
              <span className="text-xs text-gray-400">
                {!isHighlightEnabled
                  ? 'Enable highlight layer'
                  : HIGHLIGHT_EFFECT_LABELS[highlightEffectPosition]}
              </span>
            </div>

            <ThreePositionToggle
              value={highlightEffectPosition}
              onChange={(pos) => onHighlightEffectTypeChange?.(positionToEffectType[pos])}
              colors={HIGHLIGHT_EFFECT_COLORS}
              labels={HIGHLIGHT_EFFECT_LABELS}
              disabled={isCurrentlyExporting || !isHighlightEnabled}
            />
          </div>
        )}

        {/* Export Info */}
        <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
          {isFramingMode
            ? `Renders crop/trim/speed with AI upscaling at ${EXPORT_CONFIG.targetFps}fps`
            : `Applies highlight overlay (H.264)`
          }
        </div>
      </div>

      {/* Extraction status message - Framing mode only */}
      {isFramingMode && hasUnextractedClips && (
        <div className="text-orange-400 text-sm bg-orange-900/20 border border-orange-800 rounded p-2 flex items-center gap-2">
          <Loader size={14} className="animate-spin" />
          <span>
            {extractingCount > 0
              ? `Extracting ${extractingCount} clip${extractingCount > 1 ? 's' : ''}...`
              : `${pendingCount} clip${pendingCount > 1 ? 's' : ''} waiting for extraction`
            }
          </span>
        </div>
      )}

      {/* Unframed clips warning - Framing mode only */}
      {isFramingMode && !hasUnextractedClips && hasUnframedClips && (
        <div className="text-amber-400 text-sm bg-amber-900/20 border border-amber-700 rounded p-2 flex items-center gap-2">
          <AlertCircle size={14} />
          <span>
            {isMultiClipMode
              ? (unframedCount === totalExtractedClips
                  ? 'No clips have been framed yet. Add crop keyframes to each clip.'
                  : `${unframedCount} of ${totalExtractedClips} clip${unframedCount > 1 ? 's' : ''} need${unframedCount === 1 ? 's' : ''} framing. Select and add crop keyframes.`)
              : 'Add crop keyframes to frame this clip.'
            }
          </span>
        </div>
      )}

      {/* Single Export button for both modes */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        icon={isCurrentlyExporting ? Loader : Download}
        onClick={handleExport}
        disabled={disabled || isCurrentlyExporting || (!videoFile && !projectId) || (isFramingMode && (hasUnextractedClips || hasUnframedClips))}
        className={isCurrentlyExporting ? '[&>svg]:animate-spin' : ''}
        title={
          isFramingMode && hasUnextractedClips
            ? 'Wait for all clips to be extracted before framing'
            : isFramingMode && hasUnframedClips
              ? 'All clips must be framed before exporting'
              : undefined
        }
      >
        {isCurrentlyExporting
          ? (isExternallyExporting && !isExporting ? 'Export in progress...' : 'Exporting...')
          : (isFramingMode ? 'Frame Video' : 'Add Overlay')
        }
      </Button>

      {/* Progress display when exporting (show for both internal and external exports) */}
      <ExportProgress
        isExporting={isCurrentlyExporting}
        progress={displayProgress}
        progressMessage={displayMessage}
        label={isFramingMode ? "AI Upscaling" : "Overlay Export"}
      />

      {/* Error message */}
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded p-2">
          {error}
        </div>
      )}

      {/* Success message */}
      {displayProgress === 100 && !isCurrentlyExporting && (
        <div className="text-green-400 text-sm bg-green-900/20 border border-green-800 rounded p-2">
          Export complete! Video downloaded.
        </div>
      )}
    </div>
  );
}
);

export default ExportButton;

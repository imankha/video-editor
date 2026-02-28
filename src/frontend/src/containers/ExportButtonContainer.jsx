import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from '../components/shared';
import { useAppState } from '../contexts';
import { useExportStore, EDITOR_MODES } from '../stores';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { API_BASE } from '../config';
import { ExportStatus } from '../constants/exportStatus';
import { HighlightEffect } from '../constants/highlightEffects';
import { isExtracted as isExtractedSel, isExtracting as isExtractingSel, clipCropKeyframes } from '../utils/clipSelectors';

// Export configuration - centralized for easy A/B testing
export const EXPORT_CONFIG = {
  targetFps: 30,           // Fixed at 30fps
  exportMode: 'fast',      // Single-pass encoding (H.264, medium preset, CRF 15)
};

/**
 * Generate a unique ID for tracking export progress
 */
export function generateExportId() {
  return 'export_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Calculate effective clip duration after trim and speed adjustments
 * @param {Object} clip - Clip object with duration, segments, trimRange
 * @returns {number} Effective duration in seconds
 *
 * Handles multiple data formats:
 * 1. Frontend format: {segments: {segmentSpeeds, boundaries, trimRange}, trimRange}
 * 2. DB saved format: {segments: {trim_start, trim_end, segments: [{start, end, speed}]}}
 */
export function calculateEffectiveDuration(clip) {
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
export function buildClipMetadata(clips) {
  if (!clips || clips.length === 0) return null;

  let currentTime = 0;
  const sourceClips = clips.map(clip => {
    const effectiveDuration = calculateEffectiveDuration(clip);

    const clipMeta = {
      name: clip.fileName || clip.filename,
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

// Highlight effect labels for toggle display
export const HIGHLIGHT_EFFECT_LABELS = {
  [HighlightEffect.BRIGHTNESS_BOOST]: 'Bright Inside',
  [HighlightEffect.DARK_OVERLAY]: 'Dim Outside',
};

/**
 * ExportButtonContainer - Encapsulates all export business logic
 *
 * This container follows the MVC pattern:
 * - Screen: owns hooks and data fetching
 * - Container: handles state logic, event handlers, business logic
 * - View: presentational only, receives props
 *
 * @param {Object} props - Dependencies from parent screen/view
 * @returns {Object} State and handlers for ExportButtonView
 */
export function ExportButtonContainer({
  videoFile,
  cropKeyframes,
  highlightRegions = [],
  isHighlightEnabled = false,
  segmentData,
  disabled,
  includeAudio,
  onIncludeAudioChange,
  highlightEffectType = HighlightEffect.DARK_OVERLAY,
  onHighlightEffectTypeChange,
  editorMode: editorModeProp,
  onProceedToOverlay,
  clips = null,
  globalAspectRatio = '9:16',
  globalTransition = null,
  projectId: projectIdProp,
  projectName: projectNameProp,
  onExportComplete = null,
  onExportStart: onExportStartProp,
  onExportEnd: onExportEndProp,
  isExternallyExporting: isExternallyExportingProp,
  externalProgress: externalProgressProp,
  saveCurrentClipState = null,
}) {
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
  const completeExportInStore = useExportStore(state => state.completeExport);
  const failExportInStore = useExportStore(state => state.failExport);

  // Use props if provided, otherwise fall back to context values
  const editorMode = editorModeProp ?? contextEditorMode ?? EDITOR_MODES.FRAMING;
  const projectId = projectIdProp ?? selectedProjectId;
  const projectName = projectNameProp ?? selectedProject?.name;

  // Derive external exporting state from context if not provided as prop
  const isExternallyExporting = isExternallyExportingProp ?? (
    exportingProject?.projectId === selectedProjectId &&
    exportingProject?.stage === (editorMode === EDITOR_MODES.FRAMING ? EDITOR_MODES.FRAMING : EDITOR_MODES.OVERLAY)
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
        stage: editorMode === EDITOR_MODES.FRAMING ? EDITOR_MODES.FRAMING : EDITOR_MODES.OVERLAY,
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

  // Internal state
  const [isExporting, setIsExporting] = useState(false);
  const [localProgress, setLocalProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState(null);
  const [audioExplicitlySet, setAudioExplicitlySet] = useState(false);

  // Refs for tracking export state
  const exportIdRef = useRef(null);
  const uploadCompleteRef = useRef(false);
  const handleExportRef = useRef(null);
  const exportTimingRef = useRef(null);

  // Get progress from the global export store for this project
  const currentExportFromStore = Object.values(activeExports)
    .filter(exp => exp.projectId === projectId && (exp.status === ExportStatus.PENDING || exp.status === ExportStatus.PROCESSING))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];

  // Combine internal, external, AND store-based exporting state
  const isCurrentlyExporting = isExporting || isExternallyExporting || !!currentExportFromStore;

  // SINGLE SOURCE OF TRUTH for progress
  const storeProgress = currentExportFromStore?.progress?.percent ?? 0;
  const storeMessage = currentExportFromStore?.progress?.message ?? '';

  const isInUploadPhase = isExporting && !uploadCompleteRef.current && localProgress > 0;
  const displayProgress = isInUploadPhase ? localProgress : storeProgress;
  const displayMessage = isInUploadPhase ? progressMessage : (storeMessage || progressMessage);

  // Export timing tracker - logs single summary at end
  useEffect(() => {
    if (isExporting && !exportTimingRef.current) {
      exportTimingRef.current = { start: Date.now(), phases: {}, lastPhase: null };
    }
    if (!isExporting && exportTimingRef.current) {
      const timing = exportTimingRef.current;
      const total = ((Date.now() - timing.start) / 1000).toFixed(1);
      const phases = Object.entries(timing.phases)
        .map(([phase, duration]) => `${phase}:${duration.toFixed(1)}s`)
        .join(' ');
      console.log(`[Export] ${total}s total | ${phases || 'no phases'}`);
      exportTimingRef.current = null;
    }
  }, [isExporting]);

  // Track phase transitions
  useEffect(() => {
    if (!exportTimingRef.current) return;
    const timing = exportTimingRef.current;
    const currentPhase = isInUploadPhase ? 'upload' : (currentExportFromStore?.progress?.phase || 'process');

    if (currentPhase !== timing.lastPhase) {
      const now = Date.now();
      if (timing.lastPhase && timing.phaseStart) {
        timing.phases[timing.lastPhase] = (now - timing.phaseStart) / 1000;
      }
      timing.lastPhase = currentPhase;
      timing.phaseStart = now;
    }
  }, [isInUploadPhase, currentExportFromStore?.progress?.phase]);

  // Map effect type to toggle state
  const isDarkOverlay = highlightEffectType === HighlightEffect.DARK_OVERLAY;

  // Auto-disable audio when slow motion is detected
  useEffect(() => {
    if (!audioExplicitlySet && segmentData && segmentData.segments && onIncludeAudioChange) {
      const hasSlowMotion = segmentData.segments.some(segment => segment.speed < 1);
      if (hasSlowMotion && includeAudio) {
        console.log('[ExportButtonContainer] Auto-disabling audio due to slow motion');
        onIncludeAudioChange(false);
      }
    }
  }, [segmentData, audioExplicitlySet, includeAudio, onIncludeAudioChange]);

  /**
   * Connect to WebSocket for real-time progress updates using the global manager.
   */
  const connectWebSocket = useCallback(async (exportId) => {
    console.log('[ExportButtonContainer] Connecting to WebSocket via global manager for:', exportId);

    const connected = await exportWebSocketManager.connect(exportId, {
      onProgress: (progress, message) => {
        setProgressMessage(message || '');
      },
      onComplete: (data) => {
        console.log('[ExportButtonContainer] Export completed via WebSocket:', data);
      },
      onError: (error) => {
        console.error('[ExportButtonContainer] Export error via WebSocket:', error);
      }
    });

    return { connected };
  }, []);

  /**
   * Wait for export job to complete by polling status
   */
  const pollJobStatus = async (jobId) => {
    const maxAttempts = 600;
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

        await new Promise(r => setTimeout(r, pollInterval));
      } catch (err) {
        console.warn('[ExportButtonContainer] Poll failed, retrying:', err.message);
        await new Promise(r => setTimeout(r, pollInterval));
      }
    }

    return { success: false, error: 'Export timed out' };
  };

  /**
   * Main export handler
   */
  const handleExport = async () => {
    const hasProjectClips = clips && clips.length > 0 && clips.some(c => c.id);
    const isBackendAuthoritative = (editorMode === EDITOR_MODES.OVERLAY && projectId) ||
                                   (editorMode === EDITOR_MODES.FRAMING && hasProjectClips);
    if (!videoFile && !isBackendAuthoritative) {
      setError('No video file loaded');
      return;
    }

    console.log('[ExportButtonContainer] Current activeExports before starting:',
      Object.keys(activeExports).length,
      Object.values(activeExports).map(e => `${e.exportId}(${e.status})`).join(', '));

    // Mode-specific validation
    if (editorMode === EDITOR_MODES.FRAMING) {
      if (!cropKeyframes || cropKeyframes.length === 0) {
        setError('No crop keyframes defined. Please add at least one crop keyframe.');
        return;
      }
    }

    setIsExporting(true);
    setLocalProgress(0);
    setProgressMessage('Checking server...');
    setError(null);
    uploadCompleteRef.current = false;

    // Health check
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      const healthResponse = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!healthResponse.ok) {
        throw new Error(`Server returned ${healthResponse.status}: ${healthResponse.statusText}`);
      }
    } catch (healthErr) {
      console.error('[ExportButtonContainer] Server health check failed:', healthErr);
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

    const exportId = generateExportId();
    exportIdRef.current = exportId;
    handleExportStart(exportId);

    try {
      const formData = new FormData();
      if (videoFile) {
        formData.append('video', videoFile);
      }
      formData.append('export_id', exportId);
      if (projectId) {
        formData.append('project_id', String(projectId));
      }

      let endpoint;

      if (editorMode === EDITOR_MODES.FRAMING) {
        const isMultiClip = clips && clips.length > 1;

        if (isMultiClip) {
          endpoint = `${API_BASE}/api/export/multi-clip`;

          for (let index = 0; index < clips.length; index++) {
            const clip = clips[index];
            if (clip.file) {
              formData.append(`video_${index}`, clip.file);
            } else if (clip.id && projectId) {
              const streamUrl = `${API_BASE}/api/clips/projects/${projectId}/clips/${clip.id}/file?stream=true`;
              console.log(`[ExportButtonContainer] Fetching clip ${index} via backend proxy:`, streamUrl);
              setProgressMessage(`Downloading clip ${index + 1}/${clips.length}...`);

              try {
                const response = await fetch(streamUrl);
                if (!response.ok) {
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

                  console.error(`[ExportButtonContainer] Clip fetch failed:`, {
                    clipIndex: index,
                    clipId: clip.id,
                    status: response.status,
                    statusText: response.statusText,
                    responseBody: responseBody.substring(0, 500)
                  });

                  throw new Error(`CLIP_FETCH_ERROR: Failed to download clip ${index + 1}: ${statusText}`);
                }
                const blob = await response.blob();
                console.log(`[ExportButtonContainer] Successfully downloaded clip ${index}: ${(blob.size / 1024 / 1024).toFixed(2)}MB`);
                const file = new File([blob], clip.fileName || `clip_${index}.mp4`, { type: 'video/mp4' });
                formData.append(`video_${index}`, file);
              } catch (fetchErr) {
                if (fetchErr.message.startsWith('CLIP_FETCH_ERROR:')) {
                  throw fetchErr;
                }

                console.error(`[ExportButtonContainer] Clip ${index} fetch error:`, {
                  errorName: fetchErr.name,
                  errorMessage: fetchErr.message,
                  clipId: clip.workingClipId,
                  stack: fetchErr.stack
                });

                throw new Error(`CLIP_FETCH_ERROR: Failed to download clip ${index + 1}: ${fetchErr.message || 'Network error'}. Server may be unavailable.`);
              }
            } else if (clip.fileUrl) {
              console.warn(`[ExportButtonContainer] Clip ${index} has no backend id, falling back to direct URL fetch`);
              const urlForLog = clip.fileUrl.includes('?') ? clip.fileUrl.split('?')[0] + '?...' : clip.fileUrl;
              console.log(`[ExportButtonContainer] Fetching clip ${index} from URL:`, urlForLog);
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
          multiClipData.clips.forEach((c, i) => {
            console.log(`Clip ${i}: segments=${JSON.stringify(c.segments)}, trimRange=${JSON.stringify(c.trimRange)}, duration=${c.duration}`);
          });
          console.log('Full data:', JSON.stringify(multiClipData, null, 2));
          console.log('=======================================================');

          formData.append('multi_clip_data_json', JSON.stringify(multiClipData));
          formData.append('include_audio', includeAudio ? 'true' : 'false');
          formData.append('target_fps', String(EXPORT_CONFIG.targetFps));
          formData.append('export_mode', EXPORT_CONFIG.exportMode);
          if (projectId) {
            formData.append('project_id', String(projectId));
          }
          if (projectName) {
            formData.append('project_name', projectName);
          }

        } else {
          // Single clip export: Backend-authoritative render
          if (!projectId) {
            throw new Error('Cannot export: No project selected. Please save your project first.');
          }
          if (!saveCurrentClipState) {
            throw new Error('Cannot export: Clip state manager not available. Please reload the page and try again.');
          }

          console.log('[ExportButtonContainer] Using backend-authoritative render');
          setProgressMessage('Saving edits...');

          try {
            await saveCurrentClipState();
            console.log('[ExportButtonContainer] Clip state saved, requesting render');
          } catch (saveErr) {
            console.error('[ExportButtonContainer] Failed to save clip state:', saveErr);
            throw new Error('Failed to save clip edits before export. Please try again.');
          }

          endpoint = `${API_BASE}/api/export/render`;

          setProgressMessage('Connecting...');
          await connectWebSocket(exportId);

          setProgressMessage('Starting render...');
          const renderResponse = await axios.post(endpoint, {
            project_id: projectId,
            export_id: exportId,
            export_mode: EXPORT_CONFIG.exportMode,
            target_fps: EXPORT_CONFIG.targetFps,
            include_audio: includeAudio
          });

          console.log('[ExportButtonContainer] Backend render complete:', renderResponse.data);

          handleExportEnd();
          setLocalProgress(100);
          setProgressMessage('Export complete!');
          completeExportInStore(exportId, {
            status: 'complete',
            workingVideoId: renderResponse.data.working_video_id,
            filename: renderResponse.data.filename
          });

          if (onProceedToOverlay) {
            onProceedToOverlay(null, buildClipMetadata(clips), projectId);
          }
          if (onExportComplete) {
            onExportComplete();
          }

          setIsExporting(false);
          return;
        }
      } else {
        // Overlay mode
        if (projectId) {
          console.log('[ExportButtonContainer] Using backend-authoritative overlay render');

          setProgressMessage('Connecting...');
          await connectWebSocket(exportId);

          setProgressMessage('Starting render...');
          const renderResponse = await axios.post(`${API_BASE}/api/export/render-overlay`, {
            project_id: projectId,
            export_id: exportId,
            effect_type: highlightEffectType
          });

          console.log('[ExportButtonContainer] Overlay render complete:', renderResponse.data);

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

          if (onExportComplete) {
            onExportComplete();
          }

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

          const toastId = toast.success('Video exported!', {
            message: projectName ? `"${projectName}" has been downloaded and saved to your gallery.` : 'Your video has been downloaded.',
            duration: 0
          });
          setExportCompleteToastId(toastId);

          setIsExporting(false);
          return;
        }

        // Fallback: Legacy client-upload mode (no projectId)
        console.log('[ExportButtonContainer] Using legacy overlay export (no projectId)');
        endpoint = `${API_BASE}/api/export/overlay`;

        if (highlightRegions && highlightRegions.length > 0) {
          formData.append('highlight_regions_json', JSON.stringify(highlightRegions));
        }
        formData.append('highlight_effect_type', highlightEffectType);
      }

      // Connect WebSocket for real-time progress updates
      await connectWebSocket(exportId);

      // Send export request
      const response = await axios.post(
        endpoint,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          responseType: editorMode === EDITOR_MODES.FRAMING ? 'json' : 'blob',
          onUploadProgress: (progressEvent) => {
            if (!uploadCompleteRef.current) {
              const uploadPercent = Math.round(
                (progressEvent.loaded * 10) / progressEvent.total
              );
              setLocalProgress(uploadPercent);
              setProgressMessage('Uploading video...');

              if (progressEvent.loaded === progressEvent.total) {
                uploadCompleteRef.current = true;
              }
            }
          }
        }
      );

      if (editorMode === EDITOR_MODES.FRAMING) {
        try {
          const result = response.data;
          console.log('[ExportButtonContainer] Framing export complete:', result);

          if (onExportComplete) {
            onExportComplete();
          }

          setLocalProgress(100);
          setProgressMessage('Loading into Overlay mode...');

          if (exportIdRef.current) {
            completeExportInStore(exportIdRef.current);
          }

          const clipMetadata = clips && clips.length > 0 ? buildClipMetadata(clips) : null;

          if (clipMetadata) {
            console.log('[ExportButtonContainer] Built clip metadata for overlay:', clipMetadata);
          }

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

        setLocalProgress(95);
        setProgressMessage('Saving to downloads...');

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

            console.log('[ExportButtonContainer] Saved final video to DB:', saveResponse.data);

            if (onExportComplete) {
              onExportComplete();
            }
          } catch (saveErr) {
            console.error('[ExportButtonContainer] Failed to save final video to DB:', saveErr);
          }
        }

        setLocalProgress(100);
        setProgressMessage('Export complete!');

        if (exportIdRef.current) {
          completeExportInStore(exportIdRef.current);
        }

        const toastId = toast.success('Video exported!', {
          message: projectName ? `"${projectName}" has been downloaded and saved to your gallery.` : 'Your video has been downloaded.',
          duration: 0
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
      console.error('[ExportButtonContainer] Export failed:', err);

      if (exportIdRef.current) {
        failExportInStore(exportIdRef.current, err.message || 'Export failed');
        exportWebSocketManager.disconnect(exportIdRef.current);
      }

      const isClipFetchError = err.message?.startsWith('CLIP_FETCH_ERROR:');
      if (isClipFetchError) {
        const userMessage = err.message.replace('CLIP_FETCH_ERROR: ', '');
        setError(userMessage);
        setProgressMessage('Storage error');
        console.error('[ExportButtonContainer] Clip fetch failed - this is a cloud storage issue, not a server issue');
      } else {
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
          const status = err.response.status;
          const statusText = err.response.statusText;
          let errorMessage = '';

          console.error(`[ExportButtonContainer] Server error ${status}:`, {
            status,
            statusText,
            data: err.response.data,
            headers: err.response.headers
          });

          if (err.response.data instanceof Blob) {
            try {
              const errorText = await err.response.data.text();
              const errorData = JSON.parse(errorText);
              console.error('[ExportButtonContainer] Server error details:', errorData);
              if (errorData.traceback) {
                console.error('[ExportButtonContainer] Traceback:', errorData.traceback.join('\n'));
                errorMessage = `${errorData.error || 'Error'}: ${errorData.message || errorData.detail || 'Unknown error'}\n\nCheck console for stack trace.`;
              } else {
                errorMessage = errorData.message || errorData.detail || errorData.error || `Server error (${status})`;
              }
            } catch (parseError) {
              errorMessage = `Server error (${status}). Check backend console for details.`;
            }
          } else if (typeof err.response.data === 'object') {
            const data = err.response.data;
            console.error('[ExportButtonContainer] Server error details:', data);
            if (data.traceback) {
              console.error('[ExportButtonContainer] Traceback:', Array.isArray(data.traceback) ? data.traceback.join('\n') : data.traceback);
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
          console.error('[ExportButtonContainer] Unknown error:', err);
          setError(err.message || 'Export failed. Please try again.');
          setProgressMessage('');
        }
      }

      setIsExporting(false);
      handleExportEnd();
      setLocalProgress(0);
    }
  };

  // Keep ref updated with latest handleExport
  handleExportRef.current = handleExport;

  // Handle audio toggle with explicit set tracking
  const handleAudioToggle = useCallback((value) => {
    onIncludeAudioChange(value);
    setAudioExplicitlySet(true);
  }, [onIncludeAudioChange]);

  // Determine button text based on mode
  const isFramingMode = editorMode === EDITOR_MODES.FRAMING;

  // Check if any clips are still being extracted
  const clipsNotExtracted = clips?.filter(c => !isExtractedSel(c)) || [];
  const hasUnextractedClips = clipsNotExtracted.length > 0;
  const extractingCount = clipsNotExtracted.filter(c => isExtractingSel(c)).length;
  const pendingCount = clipsNotExtracted.length - extractingCount;

  // Check if any clips are missing framing data
  const isMultiClipMode = clips && clips.length > 0;
  const extractedClips = clips?.filter(c => isExtractedSel(c)) || [];
  const clipsNotFramed = extractedClips.filter(c => {
    // clipsWithCurrentState merges live keyframes as cropKeyframes (array),
    // while raw backend clips store crop_data (JSON string). Check both.
    const kfs = c.cropKeyframes || clipCropKeyframes(c);
    return !kfs || kfs.length === 0;
  });

  const hasUnframedClips = isMultiClipMode
    ? clipsNotFramed.length > 0
    : (!cropKeyframes || cropKeyframes.length === 0);
  const unframedCount = isMultiClipMode ? clipsNotFramed.length : (hasUnframedClips ? 1 : 0);
  const totalExtractedClips = isMultiClipMode ? extractedClips.length : 1;

  // Button disabled state
  const isButtonDisabled = disabled ||
    isCurrentlyExporting ||
    (!videoFile && !projectId) ||
    (isFramingMode && (hasUnextractedClips || hasUnframedClips));

  // Button title/tooltip
  const buttonTitle = isFramingMode && hasUnextractedClips
    ? 'Wait for all clips to be extracted before framing'
    : isFramingMode && hasUnframedClips
      ? 'All clips must be framed before exporting'
      : undefined;

  return {
    // State
    isExporting,
    isCurrentlyExporting,
    displayProgress,
    displayMessage,
    error,
    isFramingMode,
    isDarkOverlay,

    // Clip status
    hasUnextractedClips,
    extractingCount,
    pendingCount,
    hasUnframedClips,
    unframedCount,
    totalExtractedClips,
    isMultiClipMode,

    // Button state
    isButtonDisabled,
    buttonTitle,

    // Handlers
    handleExport,
    handleAudioToggle,

    // Effect labels
    HIGHLIGHT_EFFECT_LABELS,
    EXPORT_CONFIG,

    // Refs (for external triggering)
    handleExportRef,
    exportIdRef,
  };
}

export default ExportButtonContainer;

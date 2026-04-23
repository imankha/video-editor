import { useState, useRef, useEffect, useCallback } from 'react';
import axios from 'axios';
import { toast } from '../components/shared';
import { useAppState } from '../contexts';
import { useExportStore, useAuthStore, EDITOR_MODES } from '../stores';
import { useCreditStore } from '../stores/creditStore';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { API_BASE } from '../config';
import { ExportStatus } from '../constants/exportStatus';
import { HighlightEffect } from '../constants/highlightEffects';
import { clipCropKeyframes } from '../utils/clipSelectors';
import { useQuestStore } from '../stores/questStore';

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
  if (!clip.duration && clip.duration !== 0) {
    console.warn(`[calculateEffectiveDuration] clip ${clip.id} missing duration — caller must set it from metadata cache`);
  }

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

  // Get export store for active exports
  const activeExports = useExportStore(state => state.activeExports);
  const completeExportInStore = useExportStore(state => state.completeExport);
  const failExportInStore = useExportStore(state => state.failExport);
  const removeExportFromStore = useExportStore(state => state.removeExport);
  const requireAuth = useAuthStore((s) => s.requireAuth);
  const creditBalance = useCreditStore((s) => s.balance);

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
  const [disconnected, setDisconnected] = useState(false);
  const [reconnectionFailed, setReconnectionFailed] = useState(false);
  const [showInsufficientCredits, setShowInsufficientCredits] = useState(null);
  const [showBuyCredits, setShowBuyCredits] = useState(false);

  // Refs for tracking export state
  const exportIdRef = useRef(null);
  const uploadCompleteRef = useRef(false);
  const handleExportRef = useRef(null);
  const exportTimingRef = useRef(null);
  const backgroundExportRef = useRef(false); // T760: tracks if export was dispatched as 202 background
  const disconnectedRef = useRef(false); // Sync mirror of `disconnected` state for catch-block reads

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
    const connected = await exportWebSocketManager.connect(exportId, {
      onProgress: (progress, message) => {
        setProgressMessage(message || '');
      },
      onComplete: async (data) => {
        // If we were in disconnected state, the try/catch already exited.
        // Complete the export from here.
        setDisconnected(false);
        setLocalProgress(100);
        setProgressMessage('Export complete!');
        setIsExporting(false);
        handleExportEnd();

        // T760: Background overlay complete — download available in Gallery
        if (backgroundExportRef.current) {
          backgroundExportRef.current = false;
        }

        if (onProceedToOverlay && editorMode === EDITOR_MODES.FRAMING) {
          await onProceedToOverlay(null, clips ? buildClipMetadata(clips) : null, projectId);
        }
        if (onExportComplete) {
          await onExportComplete();
        }
      },
      onError: (serverError) => {
        // Server reported a real error — show it
        setDisconnected(false);
        setError(serverError || 'Export failed on server');
        if (exportIdRef.current) {
          failExportInStore(exportIdRef.current, serverError || 'Export failed on server');
        }
        setIsExporting(false);
        handleExportEnd();
      },
      onDisconnect: () => {
        disconnectedRef.current = true;
        setDisconnected(true);
        setProgressMessage('Connection lost — export continues on server...');
      },
      onReconnect: () => {
        disconnectedRef.current = false;
        setDisconnected(false);
        setReconnectionFailed(false);
        setProgressMessage('Reconnected — resuming progress...');
      },
      onReconnectExhausted: () => {
        setReconnectionFailed(true);
      },
    });

    return { connected };
  }, [editorMode, projectId, projectName, clips, onProceedToOverlay, onExportComplete]);

  /**
   * Retry connection: manually check Modal status and re-establish WS.
   * Triggered by user clicking "Retry connection" / "Check status" button.
   */
  const handleRetryConnection = useCallback(async () => {
    const exportId = exportIdRef.current;
    if (!exportId) return;

    setProgressMessage('Checking export status...');

    try {
      const response = await axios.get(`${API_BASE}/api/exports/${exportId}/modal-status`);
      const { status, modal_status } = response.data;

      if (status === 'complete' || modal_status === 'complete') {
        disconnectedRef.current = false;
        setDisconnected(false);
        setReconnectionFailed(false);
        setLocalProgress(100);
        setProgressMessage('Export complete!');
        setIsExporting(false);
        handleExportEnd();
        completeExportInStore(exportId,
          response.data.working_video_id || response.data.output_video_id,
          response.data.output_filename
        );
        // T1670: Transition to overlay on retry path (same as WS onComplete)
        if (onProceedToOverlay && editorMode === EDITOR_MODES.FRAMING) {
          await onProceedToOverlay(null, clips ? buildClipMetadata(clips) : null, projectId);
        }
        if (onExportComplete) await onExportComplete();
      } else if (status === 'error' || modal_status === 'error') {
        disconnectedRef.current = false;
        setDisconnected(false);
        setReconnectionFailed(false);
        const errorMsg = response.data.error || 'Export failed on server';
        setError(errorMsg);
        if (exportId) {
          failExportInStore(exportId, errorMsg);
        }
        setIsExporting(false);
        handleExportEnd();
      } else {
        // Still running — reset WS backoff and reconnect
        setProgressMessage('Export still running — reconnecting...');
        setReconnectionFailed(false);
        exportWebSocketManager.resetReconnect(exportId);
        await connectWebSocket(exportId);
      }
    } catch (retryErr) {
      console.warn('[ExportButtonContainer] Retry connection failed:', retryErr.message);
      setProgressMessage('Could not reach server — will keep trying...');
    }
  }, [connectWebSocket, completeExportInStore, onExportComplete, onProceedToOverlay, editorMode, clips, projectId]);

  /**
   * Dismiss export UI when reconnection has failed and user gives up.
   */
  const handleDismissExport = useCallback(() => {
    const exportId = exportIdRef.current;
    if (exportId) {
      exportWebSocketManager.disconnect(exportId);
    }
    disconnectedRef.current = false;
    setDisconnected(false);
    setReconnectionFailed(false);
    setIsExporting(false);
    setProgressMessage('');
    handleExportEnd();
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

      // T530: Optimistic credit check (backend is authoritative)
      // Refresh balance first to avoid stale-balance false positives
      await useCreditStore.getState().fetchCredits();
      const { canAffordExport, getRequiredCredits, balance } = useCreditStore.getState();
      const isMultiClip = clips && clips.length > 1;
      let totalVideoSeconds = 0;
      if (isMultiClip) {
        totalVideoSeconds = clips.reduce((sum, c) => sum + (calculateEffectiveDuration(c) || 0), 0);
      } else if (clips && clips.length === 1) {
        totalVideoSeconds = calculateEffectiveDuration(clips[0]);
      }
      // Fail-closed: if duration is NaN/undefined, fall back to clip.duration or metadata
      if (!totalVideoSeconds || isNaN(totalVideoSeconds)) {
        const fallbackDuration = clips?.[0]?.duration || 0;
        totalVideoSeconds = fallbackDuration;
        console.warn(`[ExportButtonContainer] Credit check: duration calc returned NaN, using fallback=${fallbackDuration}`);
      }
      console.log(`[ExportButtonContainer] Credit check: balance=${balance}, required=${getRequiredCredits(totalVideoSeconds)}, videoSecs=${totalVideoSeconds.toFixed(1)}`);
      if (totalVideoSeconds > 0 && !canAffordExport(totalVideoSeconds)) {
        setShowInsufficientCredits({
          required: getRequiredCredits(totalVideoSeconds),
          available: balance,
          videoSeconds: totalVideoSeconds,
        });
        setShowBuyCredits(true);
        return;
      }
      // Fail-closed: if we still can't determine duration, block export
      if (!totalVideoSeconds || totalVideoSeconds <= 0) {
        console.error('[ExportButtonContainer] Cannot determine video duration for credit check');
        setError('Cannot determine video duration. Please reload and try again.');
        return;
      }
    }

    setIsExporting(true);
    setLocalProgress(0);
    setProgressMessage('Checking server...');
    setError(null);
    setDisconnected(false);
    setReconnectionFailed(false);
    disconnectedRef.current = false;
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

    let renderRequestAccepted = false;

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

          // T810: Don't download/upload clip files — backend resolves video sources from DB
          // This supports game-video clips that have no standalone files
          const multiClipData = {
            clips: clips.map((clip, index) => ({
              clipIndex: index,
              workingClipId: clip.id,
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
          // Pin export request to the same Fly.io machine as our WebSocket connection
          const machineId = exportWebSocketManager.getMachineId();
          const pinHeaders = machineId ? { 'fly-force-instance-id': machineId } : {};
          const renderResponse = await axios.post(endpoint, {
            project_id: projectId,
            export_id: exportId,
            export_mode: EXPORT_CONFIG.exportMode,
            target_fps: EXPORT_CONFIG.targetFps,
            include_audio: includeAudio
          }, { headers: pinHeaders });
          renderRequestAccepted = true;

          // Refresh quest progress now that export job exists in DB
          useQuestStore.getState().fetchProgress({ force: true });

          // T760: 202 = background processing, completion comes via WebSocket
          if (renderResponse.status === 202) {
            console.log('[ExportButtonContainer] Render accepted (202), waiting for WebSocket completion');
            backgroundExportRef.current = true;
            setProgressMessage('Processing...');
            return;
          }

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
          // Pin overlay request to the same Fly.io machine as our WebSocket connection
          const overlayMachineId = exportWebSocketManager.getMachineId();
          const overlayPinHeaders = overlayMachineId ? { 'fly-force-instance-id': overlayMachineId } : {};
          const renderResponse = await axios.post(`${API_BASE}/api/export/render-overlay`, {
            project_id: projectId,
            export_id: exportId,
            effect_type: highlightEffectType
          }, { headers: overlayPinHeaders });
          renderRequestAccepted = true;

          // T760: 202 = background processing, completion comes via WebSocket
          if (renderResponse.status === 202) {
            console.log('[ExportButtonContainer] Overlay render accepted (202), waiting for WebSocket completion');
            backgroundExportRef.current = true;
            setProgressMessage('Processing...');
            return;
          }

          console.log('[ExportButtonContainer] Overlay render complete:', renderResponse.data);

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

      // Send export request (pin to same Fly.io machine as WebSocket)
      const legacyMachineId = exportWebSocketManager.getMachineId();
      const response = await axios.post(
        endpoint,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
            ...(legacyMachineId ? { 'fly-force-instance-id': legacyMachineId } : {}),
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

      // Refresh quest progress now that export job exists in DB
      useQuestStore.getState().fetchProgress({ force: true });

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

        setLocalProgress(95);
        setProgressMessage('Saving to gallery...');

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

        setTimeout(() => {
          setIsExporting(false);
          handleExportEnd();
          setLocalProgress(0);
          setProgressMessage('');
        }, 2000);
      }

    } catch (err) {
      console.error('[ExportButtonContainer] Export failed:', err);

      // If the render POST already succeeded, the export is running server-side.
      // Don't fail it — show a disconnected state and let WS reconnect handle it.
      if (renderRequestAccepted) {
        setDisconnected(true);
        setProgressMessage('Connection lost — export continues on server...');
        // Don't call setIsExporting(false), failExportInStore, or disconnect WS.
        // The WS manager will reconnect and onComplete/onError callbacks will finish the flow.
        return;
      }

      // T530: Handle 402 Insufficient Credits from backend
      if (err.response?.status === 402) {
        console.log('[ExportButtonContainer] 402 Insufficient Credits — cleaning up export state');
        const detail = err.response.data?.detail;
        if (detail?.error === 'insufficient_credits') {
          setShowInsufficientCredits({
            required: detail.required,
            available: detail.available,
            videoSeconds: detail.video_seconds,
          });
          setShowBuyCredits(true);
          // Refresh credit store with authoritative balance
          useCreditStore.getState().setBalance(detail.available);
        }
        // Full cleanup: disconnect WS, clear export ref, reset all state
        if (exportIdRef.current) {
          exportWebSocketManager.disconnect(exportIdRef.current);
          removeExportFromStore(exportIdRef.current);
          exportIdRef.current = null;
        }
        setIsExporting(false);
        setLocalProgress(0);
        setProgressMessage('');
        handleExportEnd();
        return;
      }

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
          // If the WS onDisconnect already fired, the server connection existed —
          // the export may be running even though the POST response was lost.
          // Don't show a terminal error; show the recoverable disconnected state.
          if (disconnectedRef.current) {
            setDisconnected(true);
            setProgressMessage('Connection lost — export continues on server...');
            return;
          }
          setError('Export failed due to a network error. Please check your connection and try again.');
          setProgressMessage('Network error');
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
            // Detect transient processing failures (R2 download, GPU timeout, etc.)
            const detail = typeof data.detail === 'object' ? data.detail : data;
            if (detail.error === 'processing_failed') {
              errorMessage = 'Export failed due to a temporary issue. Your credit has been refunded. Please try again.';
              useCreditStore.getState().fetchCredits();
            } else {
              const extracted = data.message || data.detail || data.error;
              errorMessage = (typeof extracted === 'string') ? extracted : `Server error (${status})`;
            }
          } else if (typeof err.response.data === 'string') {
            errorMessage = err.response.data || `Server error (${status})`;
          } else {
            errorMessage = `Server error (${status}): ${statusText || 'Unknown error'}`;
          }

          setError(typeof errorMessage === 'string' ? errorMessage : String(errorMessage));
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

  // T740: Extraction check removed — framing reads game video directly

  // Check if any clips haven't been worked on (no crop or meaningful segment edits)
  const isMultiClipMode = clips && clips.length > 0;
  const clipsNotFramed = (clips || []).filter(c => {
    const hasCrop = clipCropKeyframes(c)?.length > 0;
    if (hasCrop) return false;
    // Check for real segment edits (speed, trim, splits) — not just default state
    if (!c.segments_data) return true;
    try {
      const s = JSON.parse(c.segments_data);
      const hasSpeed = Object.keys(s.segmentSpeeds || {}).length > 0;
      const hasTrim = !!s.trimRange;
      const hasSplits = (s.userSplits?.length || 0) > 0;
      return !hasSpeed && !hasTrim && !hasSplits;
    } catch { return true; }
  });

  const hasUnframedClips = isMultiClipMode
    ? clipsNotFramed.length > 0
    : (!cropKeyframes || cropKeyframes.length === 0);
  const unframedCount = isMultiClipMode ? clipsNotFramed.length : (hasUnframedClips ? 1 : 0);
  const totalClips = isMultiClipMode ? (clips?.length || 1) : 1;

  // Button disabled state
  const isButtonDisabled = disabled ||
    isCurrentlyExporting ||
    (!videoFile && !projectId) ||
    (isFramingMode && hasUnframedClips);

  // Button title/tooltip
  const framedCount = totalClips - unframedCount;
  const buttonTitle = isFramingMode && hasUnframedClips
    ? `${framedCount}/${totalClips} clips framed — ${unframedCount} still need${unframedCount === 1 ? 's' : ''} framing`
    : undefined;

  return {
    // State
    isExporting,
    isCurrentlyExporting,
    displayProgress,
    displayMessage,
    error,
    disconnected,
    reconnectionFailed,
    isFramingMode,
    isDarkOverlay,

    // Clip status
    hasUnframedClips,
    unframedCount,
    totalExtractedClips: totalClips,
    isMultiClipMode,

    // Button state
    isButtonDisabled,
    buttonTitle,

    // Handlers
    handleExport: () => requireAuth(() => handleExport()),
    handleRetryConnection,
    handleDismissExport,
    handleAudioToggle,

    // Effect labels
    HIGHLIGHT_EFFECT_LABELS,
    EXPORT_CONFIG,

    // T530: Credit system
    showInsufficientCredits,
    onCloseInsufficientCredits: () => setShowInsufficientCredits(null),
    creditBalance,
    // T525/T526: Stripe purchase
    showBuyCredits,
    onOpenBuyCredits: () => { console.log('[ExportButtonContainer] Opening BuyCreditsModal'); setShowBuyCredits(true); },
    onCloseBuyCredits: () => setShowBuyCredits(false),
    onPaymentSuccess: (credits) => {
      setShowBuyCredits(false);
      setShowInsufficientCredits(null);
      useCreditStore.getState().fetchCredits();
      toast.success(`${credits} credits added to your balance!`);
      // Auto-retry export after credits are granted
      setTimeout(() => handleExportRef.current?.(), 300);
    },

    // Refs (for external triggering)
    handleExportRef,
    exportIdRef,
  };
}

export default ExportButtonContainer;

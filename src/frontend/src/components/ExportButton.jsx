import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from 'react';
import { Download, Loader } from 'lucide-react';
import axios from 'axios';
import ThreePositionToggle from './ThreePositionToggle';
import { Button, Toggle, ExportProgress, toast } from './shared';
import { useAppState } from '../contexts';
import { useExportStore } from '../stores';
import { useExportManager } from '../hooks/useExportManager';
import exportWebSocketManager from '../services/ExportWebSocketManager';
import { API_BASE } from '../config';

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
 */
function calculateEffectiveDuration(clip) {
  const segments = clip.segments || {};
  const trimRange = segments.trimRange || clip.trimRange;
  const segmentSpeeds = segments.segmentSpeeds || {};
  const boundaries = segments.boundaries || [0, clip.duration];

  // Start with full duration or trimmed range
  const start = trimRange?.start ?? 0;
  const end = trimRange?.end ?? clip.duration;

  // If no speed changes, simple calculation
  if (Object.keys(segmentSpeeds).length === 0) {
    return end - start;
  }

  // Calculate duration accounting for speed changes per segment
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
    .filter(exp => exp.projectId === projectId && (exp.status === 'pending' || exp.status === 'processing'))
    .sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];

  // Combine internal, external, AND store-based exporting state
  // This ensures we show busy state even after page refresh
  const isCurrentlyExporting = isExporting || isExternallyExporting || !!currentExportFromStore;

  // Display the highest progress value between local upload and store progress
  // Local tracks upload (0-10%), store tracks processing (10-100%)
  const storeProgress = currentExportFromStore?.progress?.percent ?? 0;
  const displayProgress = Math.max(localProgress, storeProgress, externalProgress?.progress ?? 0);
  const displayMessage = storeProgress > localProgress
    ? (currentExportFromStore?.progress?.message ?? '')
    : (externalProgress?.progress ?? 0) > localProgress
      ? (externalProgress?.message ?? '')
      : progressMessage;
  const [error, setError] = useState(null);
  const [audioExplicitlySet, setAudioExplicitlySet] = useState(false);
  const exportIdRef = useRef(null);
  const uploadCompleteRef = useRef(false);
  const handleExportRef = useRef(null);

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

        if (job.status === 'complete') {
          return { success: true, job };
        } else if (job.status === 'error') {
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
    if (!videoFile) {
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
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      const healthResponse = await fetch(`${API_BASE}/api/health`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!healthResponse.ok) {
        throw new Error('Server health check failed');
      }
    } catch (healthErr) {
      console.error('[ExportButton] Server health check failed:', healthErr);
      setError('Cannot connect to server. Please ensure the backend server is running on port 8000.');
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
      formData.append('video', videoFile);
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
            } else if (clip.fileUrl) {
              // Project clip - fetch from URL first
              console.log(`[ExportButton] Fetching clip ${index} from URL:`, clip.fileUrl);
              setProgressMessage(`Preparing clip ${index + 1}/${clips.length}...`);
              const response = await fetch(clip.fileUrl);
              if (!response.ok) {
                throw new Error(`Failed to fetch clip ${index}: ${response.status}`);
              }
              const blob = await response.blob();
              const file = new File([blob], clip.fileName || `clip_${index}.mp4`, { type: 'video/mp4' });
              formData.append(`video_${index}`, file);
            } else {
              throw new Error(`Clip ${index} has no file or fileUrl`);
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
          console.log(JSON.stringify(multiClipData, null, 2));
          console.log('=======================================================');

          formData.append('multi_clip_data_json', JSON.stringify(multiClipData));
          formData.append('include_audio', includeAudio ? 'true' : 'false');
          formData.append('target_fps', String(EXPORT_CONFIG.targetFps));
          formData.append('export_mode', EXPORT_CONFIG.exportMode);

        } else {
          // Single clip export: Use existing AI upscale endpoint
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
        // Note: Highlight keyframes are NOT sent during framing export.
        // They are handled separately in Overlay mode after the video is cropped/upscaled.
      } else {
        // Overlay mode: Use simple overlay endpoint (no crop, no AI, no trim)
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
          if (onProceedToOverlay) {
            await onProceedToOverlay(null, clipMetadata);
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
      console.error('Export failed:', err);

      // Mark export as failed in store (WebSocket manager will clean up connection)
      if (exportIdRef.current) {
        failExportInStore(exportIdRef.current, err.message || 'Export failed');
        exportWebSocketManager.disconnect(exportIdRef.current);
      }

      // Detect network errors (server unreachable)
      const isNetworkError = !err.response && (
        err.code === 'ERR_NETWORK' ||
        err.code === 'ECONNREFUSED' ||
        err.message?.includes('Network Error') ||
        err.message?.includes('Failed to fetch')
      );

      if (isNetworkError) {
        setError('Cannot connect to server. Please ensure the backend server is running on port 8000.');
        setProgressMessage('Server unreachable');
      } else if (err.response?.data instanceof Blob) {
        // If response is a blob (error response), we need to convert it to text/JSON
        try {
          const errorText = await err.response.data.text();
          const errorData = JSON.parse(errorText);
          console.error('Error details:', errorData);

          // In development, show detailed error
          if (errorData.traceback) {
            console.error('Traceback:', errorData.traceback.join('\n'));
            setError(`${errorData.error}: ${errorData.message}\n\nCheck console for full stack trace.`);
          } else {
            setError(errorData.message || errorData.detail || 'Export failed');
          }
        } catch (parseError) {
          console.error('Could not parse error response:', parseError);
          setError('Export failed. Check console for details.');
        }
      } else {
        setError(err.response?.data?.detail || err.message || 'Export failed. Please try again.');
      }

      setIsExporting(false);
      handleExportEnd();
      setLocalProgress(0);
      // Don't clear progressMessage if we set it to 'Server unreachable'
      if (!isNetworkError) {
        setProgressMessage('');
      }
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

      {/* Single Export button for both modes */}
      <Button
        variant="primary"
        size="lg"
        fullWidth
        icon={isCurrentlyExporting ? Loader : Download}
        onClick={handleExport}
        disabled={disabled || isCurrentlyExporting || !videoFile}
        className={isCurrentlyExporting ? '[&>svg]:animate-spin' : ''}
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

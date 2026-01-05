import { useState, useRef, useEffect, forwardRef, useImperativeHandle } from 'react';
import { Download, Loader } from 'lucide-react';
import axios from 'axios';
import ThreePositionToggle from './ThreePositionToggle';
import { ExportProgress } from './shared';
import { useAppState } from '../contexts';
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

  // Combine internal and external exporting state
  const isCurrentlyExporting = isExporting || isExternallyExporting;
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');

  // Use external progress when available and not actively exporting locally
  const displayProgress = isExporting ? progress : (externalProgress?.progress ?? 0);
  const displayMessage = isExporting ? progressMessage : (externalProgress?.message ?? '');
  const [error, setError] = useState(null);
  const [audioExplicitlySet, setAudioExplicitlySet] = useState(false);
  const wsRef = useRef(null);
  const exportIdRef = useRef(null);
  const uploadCompleteRef = useRef(false);
  const handleExportRef = useRef(null);

  // Map effect type to toggle position
  const effectTypeToPosition = { 'brightness_boost': 0, 'original': 1, 'dark_overlay': 2 };
  const positionToEffectType = ['brightness_boost', 'original', 'dark_overlay'];
  const highlightEffectPosition = effectTypeToPosition[highlightEffectType] ?? 1;

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

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
   * Connect to WebSocket for real-time progress updates
   * Returns a Promise that resolves when the connection is established
   */
  const connectWebSocket = (exportId) => {
    return new Promise((resolve, reject) => {
      // Close any existing connection
      if (wsRef.current) {
        wsRef.current.close();
      }

      // Use same host as the page to go through Vite proxy
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${wsProtocol}//${window.location.host}/ws/export/${exportId}`;
      console.log('[ExportButton] Attempting WebSocket connection to:', wsUrl);

      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // Set a timeout in case connection takes too long
      const timeout = setTimeout(() => {
        console.warn('[ExportButton] WebSocket connection timeout after 3s, readyState:', ws.readyState);
        resolve(); // Resolve anyway to not block export
      }, 3000);

      ws.onopen = () => {
        clearTimeout(timeout);
        console.log('[ExportButton] WebSocket CONNECTED successfully, readyState:', ws.readyState);
        resolve();
      };

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        console.log('[ExportButton] Progress update:', data);

        // Update progress from WebSocket
        setProgress(Math.round(data.progress));
        setProgressMessage(data.message || '');

        // Close connection if complete or error
        if (data.status === 'complete' || data.status === 'error') {
          ws.close();
        }
      };

      ws.onerror = (error) => {
        clearTimeout(timeout);
        console.error('[ExportButton] WebSocket ERROR - readyState:', ws.readyState, 'error:', error);
        console.error('[ExportButton] Check browser Network tab for WebSocket connection details');
        resolve(); // Resolve anyway to not block export
      };

      ws.onclose = (event) => {
        console.log('[ExportButton] WebSocket CLOSED - code:', event.code, 'reason:', event.reason, 'wasClean:', event.wasClean);
        wsRef.current = null;
      };
    });
  };

  const handleExport = async () => {
    if (!videoFile) {
      setError('No video file loaded');
      return;
    }

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
    setProgress(0);
    setProgressMessage('Uploading...');
    setError(null);
    uploadCompleteRef.current = false;

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

      let endpoint;

      if (editorMode === 'framing') {
        // Check if this is a multi-clip export
        const isMultiClip = clips && clips.length > 1;

        if (isMultiClip) {
          // Multi-clip export: Use multi-clip endpoint
          endpoint = '${API_BASE}/api/export/multi-clip';

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
          endpoint = '${API_BASE}/api/export/upscale';

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
        endpoint = '${API_BASE}/api/export/overlay';

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
      const response = await axios.post(
        endpoint,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          responseType: 'blob',
          onUploadProgress: (progressEvent) => {
            // Only update during upload phase, don't override WebSocket updates
            if (!uploadCompleteRef.current) {
              // Scale upload to 0-10% (leaving 10-100% for AI processing)
              const uploadPercent = Math.round(
                (progressEvent.loaded * 10) / progressEvent.total
              );
              setProgress(uploadPercent);
              setProgressMessage('Uploading video...');

              // Mark upload as complete when done
              if (progressEvent.loaded === progressEvent.total) {
                uploadCompleteRef.current = true;
              }
            }
          }
        }
      );

      // Create blob from response
      const blob = new Blob([response.data], { type: 'video/mp4' });

      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // In Framing mode, save to database then transition to Overlay mode
      // (No download - user will download from Overlay mode when final video is ready)
      if (editorMode === 'framing' && onProceedToOverlay) {
        try {
          // Save working video to database for persistence
          if (projectId) {
            setProgress(95);
            setProgressMessage('Saving working video...');

            const saveFormData = new FormData();
            saveFormData.append('project_id', String(projectId));
            saveFormData.append('video', blob, 'working_video.mp4');
            saveFormData.append('clips_data', JSON.stringify(clips || []));

            const saveResponse = await axios.post(
              '${API_BASE}/api/export/framing',
              saveFormData,
              { headers: { 'Content-Type': 'multipart/form-data' } }
            );

            console.log('[ExportButton] Saved working video to DB:', saveResponse.data);

            // Refresh projects list to show updated progress
            if (onExportComplete) {
              onExportComplete();
            }
          }

          setProgress(100);
          setProgressMessage('Loading into Overlay mode...');

          // Build clip metadata for auto-generating highlight regions
          const clipMetadata = clips && clips.length > 0 ? buildClipMetadata(clips) : null;

          if (clipMetadata) {
            console.log('[ExportButton] Built clip metadata for overlay:', clipMetadata);
          }

          await onProceedToOverlay(blob, clipMetadata);
          setIsExporting(false);
          handleExportEnd();
          setProgress(0);
          setProgressMessage('');
        } catch (err) {
          console.error('Failed to save working video or transition to overlay:', err);
          setError(err.message || 'Failed to save working video');
          setIsExporting(false);
          handleExportEnd();
          setProgress(0);
          setProgressMessage('');
        }
      } else {
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

        setProgress(95);
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
              '${API_BASE}/api/export/final',
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

        setProgress(100);
        setProgressMessage('Export complete!');
        setTimeout(() => {
          setIsExporting(false);
          handleExportEnd();
          setProgress(0);
          setProgressMessage('');
        }, 2000);
      }

    } catch (err) {
      console.error('Export failed:', err);

      // Close WebSocket on error
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      // If response is a blob (error response), we need to convert it to text/JSON
      if (err.response?.data instanceof Blob) {
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
      setProgress(0);
      setProgressMessage('');
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
            <button
              onClick={() => {
                onIncludeAudioChange(!includeAudio);
                setAudioExplicitlySet(true);
              }}
              disabled={isCurrentlyExporting}
              className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
                includeAudio ? 'bg-blue-600' : 'bg-gray-600'
              } ${isCurrentlyExporting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              role="switch"
              aria-checked={includeAudio}
              aria-label="Toggle audio"
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                  includeAudio ? 'translate-x-8' : 'translate-x-1'
                }`}
              />
            </button>
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
      <button
        onClick={handleExport}
        disabled={disabled || isCurrentlyExporting || !videoFile}
        className={`w-full px-6 py-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
          disabled || isCurrentlyExporting || !videoFile
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {isCurrentlyExporting ? (
          <>
            <Loader className="animate-spin" size={20} />
            <span>{isExternallyExporting && !isExporting ? 'Export in progress...' : 'Exporting...'}</span>
          </>
        ) : (
          <>
            <Download size={20} />
            <span>Export Video</span>
          </>
        )}
      </button>

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
      {progress === 100 && !isCurrentlyExporting && (
        <div className="text-green-400 text-sm bg-green-900/20 border border-green-800 rounded p-2">
          Export complete! Video downloaded.
        </div>
      )}
    </div>
  );
}
);

export default ExportButton;

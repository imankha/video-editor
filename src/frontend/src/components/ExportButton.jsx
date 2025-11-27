import { useState, useRef, useEffect } from 'react';
import { Download, Loader } from 'lucide-react';
import axios from 'axios';
import ThreePositionToggle from './ThreePositionToggle';

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

// Highlight effect styles mapped to toggle positions
const HIGHLIGHT_EFFECT_STYLES = ['brightness_boost', 'original', 'dark_overlay'];
const HIGHLIGHT_EFFECT_LABELS = ['Bright Inside', 'Yellow Inside', 'Dim Outside'];
const HIGHLIGHT_EFFECT_COLORS = ['bg-blue-600', 'bg-yellow-600', 'bg-purple-600'];

/**
 * ExportButton component - handles video export with AI upscaling
 * Always uses AI upscaling with ESRGAN at 30fps for best quality
 * Automatically downloads the exported video
 */
export default function ExportButton({ videoFile, cropKeyframes, highlightKeyframes = [], isHighlightEnabled = false, segmentData, disabled, includeAudio, onIncludeAudioChange }) {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState(null);
  const [audioExplicitlySet, setAudioExplicitlySet] = useState(false);
  const [highlightEffectPosition, setHighlightEffectPosition] = useState(0);
  const wsRef = useRef(null);
  const exportIdRef = useRef(null);
  const uploadCompleteRef = useRef(false);

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
   */
  const connectWebSocket = (exportId) => {
    // Close any existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`ws://localhost:8000/ws/export/${exportId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[ExportButton] WebSocket connected');
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
      console.error('[ExportButton] WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('[ExportButton] WebSocket disconnected');
      wsRef.current = null;
    };
  };

  const handleExport = async () => {
    if (!videoFile) {
      setError('No video file loaded');
      return;
    }

    if (!cropKeyframes || cropKeyframes.length === 0) {
      setError('No crop keyframes defined. Please add at least one crop keyframe.');
      return;
    }

    setIsExporting(true);
    setProgress(0);
    setProgressMessage('Uploading...');
    setError(null);
    uploadCompleteRef.current = false;

    // Generate unique export ID
    const exportId = generateExportId();
    exportIdRef.current = exportId;

    try {
      // Prepare form data with fixed export settings
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('keyframes_json', JSON.stringify(cropKeyframes));
      formData.append('target_fps', String(EXPORT_CONFIG.targetFps));
      formData.append('export_id', exportId);
      formData.append('export_mode', EXPORT_CONFIG.exportMode);
      formData.append('include_audio', includeAudio ? 'true' : 'false');

      // Add segment data if available (only if speed changes or trimming exist)
      if (segmentData) {
        console.log('=== EXPORT: Sending segment data to backend ===');
        console.log(JSON.stringify(segmentData, null, 2));
        console.log('==============================================');
        formData.append('segment_data_json', JSON.stringify(segmentData));
      } else {
        console.log('=== EXPORT: No segment data to send ===');
      }

      // Add highlight keyframes if available
      if (highlightKeyframes && highlightKeyframes.length > 0) {
        console.log('=== EXPORT: Sending highlight keyframes to backend ===');
        console.log(JSON.stringify(highlightKeyframes, null, 2));
        console.log('==============================================');
        formData.append('highlight_keyframes_json', JSON.stringify(highlightKeyframes));
        formData.append('highlight_effect_type', HIGHLIGHT_EFFECT_STYLES[highlightEffectPosition]);
      } else {
        console.log('=== EXPORT: No highlight keyframes to send (layer disabled or empty) ===');
      }

      // Use optimized AI upscale endpoint (raw ESRGAN + H.264 fast CRF 18)
      const endpoint = 'http://localhost:8000/api/export/upscale';

      // Connect WebSocket for real-time progress updates
      connectWebSocket(exportId);

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

      // Create download link and trigger download
      const blob = new Blob([response.data], { type: 'video/mp4' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `upscaled_${videoFile.name || 'video.mp4'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up
      window.URL.revokeObjectURL(url);

      // Close WebSocket
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setProgress(100);
      setProgressMessage('Export complete!');
      setTimeout(() => {
        setIsExporting(false);
        setProgress(0);
        setProgressMessage('');
      }, 2000);

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
      setProgress(0);
      setProgressMessage('');
    }
  };

  return (
    <div className="space-y-3">
      {/* Export Settings */}
      <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700 space-y-4">
        <div className="text-sm font-medium text-gray-300 mb-3">Export Settings</div>

        {/* Audio Toggle */}
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
            disabled={isExporting}
            className={`relative inline-flex h-7 w-14 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-gray-900 ${
              includeAudio ? 'bg-blue-600' : 'bg-gray-600'
            } ${isExporting ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
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

        {/* Highlight Effect Style */}
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
            onChange={setHighlightEffectPosition}
            colors={HIGHLIGHT_EFFECT_COLORS}
            labels={HIGHLIGHT_EFFECT_LABELS}
            disabled={isExporting || !isHighlightEnabled}
          />
        </div>

        {/* Export Info */}
        <div className="text-xs text-gray-500 border-t border-gray-700 pt-3">
          AI upscaling at {EXPORT_CONFIG.targetFps}fps (H.264)
        </div>
      </div>

      {/* Export Button */}
      <button
        onClick={handleExport}
        disabled={disabled || isExporting || !videoFile}
        className={`w-full px-6 py-4 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
          disabled || isExporting || !videoFile
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-blue-600 hover:bg-blue-700 text-white'
        }`}
      >
        {isExporting ? (
          <>
            <Loader className="animate-spin" size={20} />
            <span>Exporting...</span>
          </>
        ) : (
          <>
            <Download size={20} />
            <span>Export Video</span>
          </>
        )}
      </button>

      {/* Progress display when exporting */}
      {isExporting && (
        <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
          <div className="flex items-center gap-2 mb-2">
            <Loader className="animate-spin" size={18} />
            <span className="font-medium">AI Upscaling... {progress}%</span>
          </div>
          {progressMessage && (
            <div className="text-xs opacity-80 mb-2">
              {progressMessage}
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      {isExporting && (
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="bg-green-600 h-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded p-2">
          {error}
        </div>
      )}

      {/* Success message */}
      {progress === 100 && !isExporting && (
        <div className="text-green-400 text-sm bg-green-900/20 border border-green-800 rounded p-2">
          Export complete! Video downloaded.
        </div>
      )}
    </div>
  );
}

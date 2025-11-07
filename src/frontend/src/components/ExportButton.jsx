import { useState, useRef, useEffect } from 'react';
import { Download, Loader } from 'lucide-react';
import axios from 'axios';

/**
 * Generate a unique ID for tracking export progress
 */
function generateExportId() {
  return 'export_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

/**
 * ExportButton component - handles video export with AI upscaling
 * Always uses AI upscaling with de-zoom for best quality
 * Automatically downloads the exported video
 */
export default function ExportButton({ videoFile, cropKeyframes, disabled }) {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState(null);
  const pollIntervalRef = useRef(null);
  const exportIdRef = useRef(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, []);

  /**
   * Poll the backend for export progress
   */
  const startProgressPolling = (exportId) => {
    // Clear any existing polling
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
    }

    // Poll every 500ms
    pollIntervalRef.current = setInterval(async () => {
      try {
        const response = await axios.get(`http://localhost:8000/api/export/progress/${exportId}`);
        const data = response.data;

        setProgress(Math.round(data.progress));
        setProgressMessage(data.message || '');

        // Stop polling if complete or error
        if (data.status === 'complete' || data.status === 'error') {
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
        }
      } catch (err) {
        // If polling fails (e.g., 404), silently continue - the export might still be processing
        console.warn('Progress polling error:', err.message);
      }
    }, 500);
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

    // Generate unique export ID
    const exportId = generateExportId();
    exportIdRef.current = exportId;

    try {
      // Prepare form data
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('keyframes_json', JSON.stringify(cropKeyframes));
      formData.append('target_fps', '30');
      formData.append('export_id', exportId);

      // Always use AI upscale endpoint
      const endpoint = 'http://localhost:8000/api/export/upscale';

      // Start polling for progress updates
      startProgressPolling(exportId);

      // Send export request (no progress callbacks needed, polling handles it)
      const response = await axios.post(
        endpoint,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          responseType: 'blob',
          onUploadProgress: (progressEvent) => {
            // Only update progress if still in upload phase (not being polled yet)
            const uploadPercent = Math.round(
              (progressEvent.loaded * 5) / progressEvent.total
            );
            setProgress(uploadPercent);
            setProgressMessage('Uploading video...');
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

      // Stop polling
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
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

      // Stop polling on error
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
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
    <div className="space-y-2">
      {/* Info about AI upscaling */}
      <div className="bg-blue-900/20 rounded-lg p-3 border border-blue-800/50">
        <div className="text-xs text-blue-300">
          ✨ AI upscaling to 4K (16:9) or 1080x1920 (9:16) with de-zoom
        </div>
      </div>

      <button
        onClick={handleExport}
        disabled={disabled || isExporting || !videoFile}
        className={`w-full px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
          disabled || isExporting || !videoFile
            ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
            : 'bg-green-600 hover:bg-green-700 text-white'
        }`}
      >
        {isExporting ? (
          <div className="flex flex-col items-center gap-1 w-full">
            <div className="flex items-center gap-2">
              <Loader className="animate-spin" size={18} />
              <span>AI Upscaling... {progress}%</span>
            </div>
            {progressMessage && (
              <div className="text-xs opacity-80">
                {progressMessage}
              </div>
            )}
          </div>
        ) : (
          <>
            <Download size={18} />
            Export Video (AI Enhanced)
          </>
        )}
      </button>

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

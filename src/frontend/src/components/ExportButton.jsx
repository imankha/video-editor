import { useState } from 'react';
import { Download, Loader } from 'lucide-react';
import axios from 'axios';

/**
 * ExportButton component - handles video export with crop applied
 * Automatically downloads the exported video
 */
export default function ExportButton({ videoFile, cropKeyframes, disabled }) {
  const [isExporting, setIsExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

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
    setError(null);

    try {
      // Prepare form data
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('keyframes_json', JSON.stringify(cropKeyframes));

      // Send export request
      const response = await axios.post(
        'http://localhost:8000/api/export/crop',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          responseType: 'blob',
          onUploadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              (progressEvent.loaded * 50) / progressEvent.total
            );
            setProgress(percentCompleted);
          },
          onDownloadProgress: (progressEvent) => {
            const percentCompleted = Math.round(
              50 + (progressEvent.loaded * 50) / (progressEvent.total || progressEvent.loaded)
            );
            setProgress(percentCompleted);
          }
        }
      );

      // Create download link and trigger download
      const blob = new Blob([response.data], { type: 'video/mp4' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `cropped_${videoFile.name || 'video.mp4'}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // Clean up
      window.URL.revokeObjectURL(url);

      setProgress(100);
      setTimeout(() => {
        setIsExporting(false);
        setProgress(0);
      }, 2000);

    } catch (err) {
      console.error('Export failed:', err);
      setError(err.response?.data?.detail || 'Export failed. Please try again.');
      setIsExporting(false);
      setProgress(0);
    }
  };

  return (
    <div className="space-y-2">
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
          <>
            <Loader className="animate-spin" size={18} />
            Exporting... {progress}%
          </>
        ) : (
          <>
            <Download size={18} />
            {cropKeyframes?.length > 0 ? 'Export with Crop' : 'Export Video'}
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

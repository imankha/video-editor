import { useState, useRef, useEffect } from 'react';
import { FlaskConical, Loader, FolderOpen } from 'lucide-react';
import axios from 'axios';

/**
 * Generate a unique ID for tracking export progress
 */
function generateExportId() {
  return 'compare_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

/**
 * CompareModelsButton - Test different AI super-resolution models
 * Runs the same video through multiple models to compare quality
 */
export default function CompareModelsButton({ videoFile, cropKeyframes, highlightKeyframes = [], segmentData, disabled }) {
  const [isComparing, setIsComparing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressMessage, setProgressMessage] = useState('');
  const [currentModel, setCurrentModel] = useState('');
  const [modelIndex, setModelIndex] = useState(0);
  const [totalModels, setTotalModels] = useState(0);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null);
  const [outputDir, setOutputDir] = useState('');
  const [includeAudio, setIncludeAudio] = useState(false); // Default off for faster testing
  const wsRef = useRef(null);
  const exportIdRef = useRef(null);

  // Cleanup WebSocket on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  /**
   * Connect to WebSocket for real-time progress updates
   */
  const connectWebSocket = (exportId) => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`ws://localhost:8000/ws/export/${exportId}`);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[CompareModels] WebSocket connected');
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log('[CompareModels] Progress update:', data);

      setProgress(Math.round(data.progress));
      setProgressMessage(data.message || '');

      // Track which model is being processed
      if (data.current_permutation) {
        setCurrentModel(data.current_permutation);
      }
      if (data.permutation_index) {
        setModelIndex(data.permutation_index);
      }
      if (data.total_permutations) {
        setTotalModels(data.total_permutations);
      }

      if (data.status === 'complete') {
        setResults(data.results);
        setOutputDir(data.output_directory);
        ws.close();
      } else if (data.status === 'error') {
        ws.close();
      }
    };

    ws.onerror = (error) => {
      console.error('[CompareModels] WebSocket error:', error);
    };

    ws.onclose = () => {
      console.log('[CompareModels] WebSocket disconnected');
      wsRef.current = null;
    };
  };

  const handleCompare = async () => {
    if (!videoFile) {
      setError('No video file loaded');
      return;
    }

    if (!cropKeyframes || cropKeyframes.length === 0) {
      setError('No crop keyframes defined. Please add at least one crop keyframe.');
      return;
    }

    setIsComparing(true);
    setProgress(0);
    setProgressMessage('Starting model comparison...');
    setError(null);
    setResults(null);
    setOutputDir('');
    setCurrentModel('');
    setModelIndex(0);
    setTotalModels(0);

    const exportId = generateExportId();
    exportIdRef.current = exportId;

    try {
      const formData = new FormData();
      formData.append('video', videoFile);
      formData.append('keyframes_json', JSON.stringify(cropKeyframes));
      formData.append('target_fps', '30');
      formData.append('export_id', exportId);
      formData.append('export_mode', 'quality');
      formData.append('include_audio', includeAudio ? 'true' : 'false');

      if (segmentData) {
        formData.append('segment_data_json', JSON.stringify(segmentData));
      }

      if (highlightKeyframes && highlightKeyframes.length > 0) {
        formData.append('highlight_keyframes_json', JSON.stringify(highlightKeyframes));
      }

      // Connect WebSocket for progress updates
      connectWebSocket(exportId);

      // Send to comparison endpoint (returns JSON, not file)
      const response = await axios.post(
        'http://localhost:8000/api/export/upscale-comparison',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data'
          },
          timeout: 3600000, // 1 hour timeout for long comparisons
          onUploadProgress: (progressEvent) => {
            const uploadPercent = Math.round(
              (progressEvent.loaded * 5) / progressEvent.total
            );
            setProgress(uploadPercent);
            setProgressMessage('Uploading video...');
          }
        }
      );

      console.log('Comparison complete:', response.data);

      // Update state with results
      setResults(response.data.results);
      setOutputDir(response.data.output_directory);
      setProgress(100);
      setProgressMessage('Comparison complete!');

      // Keep results visible
      setTimeout(() => {
        setIsComparing(false);
      }, 1000);

    } catch (err) {
      console.error('Comparison failed:', err);

      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }

      setError(err.response?.data?.detail || err.message || 'Comparison failed. Please try again.');
      setIsComparing(false);
      setProgress(0);
      setProgressMessage('');
    }
  };

  const openOutputFolder = () => {
    if (outputDir) {
      // Copy path to clipboard since we can't open folders directly from browser
      navigator.clipboard.writeText(outputDir).then(() => {
        alert(`Output directory path copied to clipboard:\n\n${outputDir}\n\nOpen this folder to view comparison videos and report.`);
      }).catch(() => {
        alert(`Output directory:\n\n${outputDir}\n\nOpen this folder to view comparison videos and report.`);
      });
    }
  };

  return (
    <div className="space-y-3">
      {/* Compare Models Section */}
      <div className="bg-purple-900/30 rounded-lg p-4 border border-purple-700 space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-purple-300">
          <FlaskConical size={18} />
          <span>AI Model Comparison (Experimental)</span>
        </div>

        <div className="text-xs text-gray-400">
          Test your video with different AI upscaling models to find the best quality.
          Generates multiple videos for side-by-side comparison.
        </div>

        {/* Audio Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-gray-300">Include Audio</span>
            <span className="text-xs text-gray-500">
              {includeAudio ? 'Slower processing' : 'Faster testing'}
            </span>
          </div>
          <button
            onClick={() => setIncludeAudio(!includeAudio)}
            disabled={isComparing}
            className={`relative inline-flex h-5 w-10 items-center rounded-full transition-colors ${
              includeAudio ? 'bg-purple-600' : 'bg-gray-600'
            } ${isComparing ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span
              className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                includeAudio ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>

        {/* Models to Test */}
        <div className="text-xs text-gray-400 border-t border-purple-700/50 pt-3">
          <div className="font-medium text-gray-300 mb-1">Models to test:</div>
          <ul className="list-disc list-inside space-y-1">
            <li>RealESRGAN_x4plus (baseline)</li>
            <li>SwinIR_4x_GAN (transformer)</li>
            <li>realesr_general_x4v3 (newer)</li>
            <li>RealESRGAN_x4plus_anime_6B (fast)</li>
          </ul>
        </div>

        {/* Compare Button */}
        <button
          onClick={handleCompare}
          disabled={disabled || isComparing || !videoFile}
          className={`w-full px-4 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
            disabled || isComparing || !videoFile
              ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
              : 'bg-purple-600 hover:bg-purple-700 text-white'
          }`}
        >
          {isComparing ? (
            <>
              <Loader className="animate-spin" size={18} />
              <span>Comparing Models...</span>
            </>
          ) : (
            <>
              <FlaskConical size={18} />
              <span>Run Model Comparison</span>
            </>
          )}
        </button>
      </div>

      {/* Progress display */}
      {isComparing && (
        <div className="bg-purple-900/30 rounded-lg p-3 border border-purple-700">
          <div className="flex items-center gap-2 mb-2">
            <Loader className="animate-spin" size={18} />
            <span className="font-medium">
              {currentModel ? `Testing: ${currentModel}` : 'Processing...'} {progress}%
            </span>
          </div>
          {modelIndex > 0 && totalModels > 0 && (
            <div className="text-xs text-purple-300 mb-1">
              Model {modelIndex} of {totalModels}
            </div>
          )}
          {progressMessage && (
            <div className="text-xs opacity-80 mb-2">
              {progressMessage}
            </div>
          )}
        </div>
      )}

      {/* Progress bar */}
      {isComparing && (
        <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
          <div
            className="bg-purple-600 h-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}

      {/* Results */}
      {results && results.length > 0 && (
        <div className="bg-green-900/20 border border-green-700 rounded-lg p-3">
          <div className="text-green-400 font-medium mb-2">
            Comparison Complete!
          </div>

          <div className="space-y-2 text-xs">
            {results.map((r, i) => (
              <div key={i} className={`flex justify-between ${r.success ? 'text-gray-300' : 'text-red-400'}`}>
                <span className="font-medium">{r.sr_model_name || r.name}:</span>
                {r.success ? (
                  <span>
                    {r.duration_seconds.toFixed(2)}s | {r.peak_vram_mb.toFixed(1)}MB VRAM | {r.file_size_mb.toFixed(2)}MB
                  </span>
                ) : (
                  <span>FAILED</span>
                )}
              </div>
            ))}
          </div>

          {outputDir && (
            <button
              onClick={openOutputFolder}
              className="mt-3 w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-600 text-white text-xs py-2 px-3 rounded"
            >
              <FolderOpen size={14} />
              <span>Copy Output Path</span>
            </button>
          )}

          <div className="mt-2 text-xs text-gray-400">
            Videos and detailed report saved to:<br/>
            <span className="text-green-300 break-all">{outputDir}</span>
          </div>
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded p-2">
          {error}
        </div>
      )}
    </div>
  );
}

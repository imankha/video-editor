import React, { useRef, useState } from 'react';

/**
 * FileUpload component - File input buttons for uploading videos
 * @param {Object} props
 * @param {Function} props.onFileSelect - Callback when file is selected (for Framing mode)
 * @param {Function} props.onFramedVideoSelect - Callback when a pre-framed video is selected for Overlay mode
 * @param {Function} props.onGameVideoSelect - Callback when a game video is selected for Annotate mode
 * @param {boolean} props.isLoading - Whether a file is currently loading
 */
export function FileUpload({ onFileSelect, onFramedVideoSelect, onGameVideoSelect, isLoading }) {
  const framingInputRef = useRef(null);
  const overlayInputRef = useRef(null);
  const gameInputRef = useRef(null);
  const [loadingTarget, setLoadingTarget] = useState(null); // 'framing' | 'overlay' | 'game' | null

  const handleFramingFileChange = (event) => {
    const files = event.target.files;
    if (files && files.length > 0) {
      // Process each selected file for Framing mode
      Array.from(files).forEach(file => {
        onFileSelect(file);
      });
      // Reset input so same files can be selected again
      event.target.value = '';
    }
  };

  const handleOverlayFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (file && onFramedVideoSelect) {
      setLoadingTarget('overlay');
      try {
        await onFramedVideoSelect(file);
      } finally {
        setLoadingTarget(null);
      }
      // Reset input so same file can be selected again
      event.target.value = '';
    }
  };

  const handleGameFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (file && onGameVideoSelect) {
      setLoadingTarget('game');
      try {
        await onGameVideoSelect(file);
      } finally {
        setLoadingTarget(null);
      }
      // Reset input so same file can be selected again
      event.target.value = '';
    }
  };

  const handleFramingClick = () => {
    framingInputRef.current?.click();
  };

  const handleOverlayClick = () => {
    overlayInputRef.current?.click();
  };

  const handleGameClick = () => {
    gameInputRef.current?.click();
  };

  const isFramingLoading = isLoading || loadingTarget === 'framing';
  const isOverlayLoading = loadingTarget === 'overlay';
  const isGameLoading = loadingTarget === 'game';
  const isAnyLoading = isFramingLoading || isOverlayLoading || isGameLoading;

  return (
    <div className="file-upload-container flex gap-2">
      {/* Hidden file inputs */}
      <input
        ref={framingInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleFramingFileChange}
        className="hidden"
        multiple
      />
      <input
        ref={overlayInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleOverlayFileChange}
        className="hidden"
      />
      <input
        ref={gameInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleGameFileChange}
        className="hidden"
      />

      {/* Add Raw Clips button (Framing workflow) */}
      <button
        onClick={handleFramingClick}
        disabled={isAnyLoading}
        className="px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
        title="Add raw clips for Framing mode (crop, trim, speed adjustments)"
      >
        {isFramingLoading ? (
          <>
            <svg
              className="animate-spin h-5 w-5 text-white"
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              ></circle>
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              ></path>
            </svg>
            <span>Loading...</span>
          </>
        ) : (
          <>
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
              />
            </svg>
            <span>Add Raw Clips</span>
          </>
        )}
      </button>

      {/* Add Overlay To Framed Video button (skip Framing, go directly to Overlay) */}
      {onFramedVideoSelect && (
        <button
          onClick={handleOverlayClick}
          disabled={isAnyLoading}
          className="px-4 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
          title="Add overlay effects to a pre-framed video (skip Framing)"
        >
          {isOverlayLoading ? (
            <>
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>Loading...</span>
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <circle cx="12" cy="12" r="3" strokeWidth={2} />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 5v2m0 10v2m-7-7h2m10 0h2"
                />
              </svg>
              <span>Add Overlay To Framed Video</span>
            </>
          )}
        </button>
      )}

      {/* Add Game button (Annotate workflow - extract clips from full game) */}
      {onGameVideoSelect && (
        <button
          onClick={handleGameClick}
          disabled={isAnyLoading}
          className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
          title="Import full game video to extract clips (Annotate mode)"
        >
          {isGameLoading ? (
            <>
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              <span>Loading...</span>
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                {/* Scissors/cut icon for clipping */}
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M14.121 14.121L19 19m-7-7l7-7m-7 7l-2.879 2.879M12 12L9.121 9.121m0 5.758a3 3 0 10-4.243 4.243 3 3 0 004.243-4.243zm0-5.758a3 3 0 10-4.243-4.243 3 3 0 004.243 4.243z"
                />
              </svg>
              <span>Add Game</span>
            </>
          )}
        </button>
      )}
    </div>
  );
}

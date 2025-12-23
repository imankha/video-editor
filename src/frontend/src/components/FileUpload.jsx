import React, { useRef, useState } from 'react';
import { Film, Loader } from 'lucide-react';

/**
 * FileUpload component - Annotate button only
 *
 * The "Add Raw Clips" functionality has moved to ClipSelectorSidebar.
 * The "Add Overlay To Framed Video" is no longer needed (overlay follows framing in project flow).
 */
export function FileUpload({ onGameVideoSelect, isLoading }) {
  const gameInputRef = useRef(null);
  const [loadingState, setLoadingState] = useState(false);

  const handleGameFileChange = async (event) => {
    const files = event.target.files;
    if (files && files.length > 0 && onGameVideoSelect) {
      setLoadingState(true);
      try {
        // For now, just use the first file
        // TODO: multi-video concatenation support
        await onGameVideoSelect(files[0]);
      } finally {
        setLoadingState(false);
      }
      // Reset input so same files can be selected again
      event.target.value = '';
    }
  };

  const handleClick = () => {
    gameInputRef.current?.click();
  };

  const isButtonLoading = isLoading || loadingState;

  return (
    <div className="file-upload-container">
      {/* Hidden file input - accepts multiple files */}
      <input
        ref={gameInputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm"
        onChange={handleGameFileChange}
        className="hidden"
        multiple
      />

      {/* Annotate button */}
      <button
        onClick={handleClick}
        disabled={isButtonLoading}
        className="px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white rounded-lg font-medium transition-colors flex items-center space-x-2"
        title="Import game video(s) to annotate and extract clips"
      >
        {isButtonLoading ? (
          <>
            <Loader className="animate-spin h-5 w-5" />
            <span>Loading...</span>
          </>
        ) : (
          <>
            <Film className="w-5 h-5" />
            <span>Annotate</span>
          </>
        )}
      </button>
    </div>
  );
}

export default FileUpload;

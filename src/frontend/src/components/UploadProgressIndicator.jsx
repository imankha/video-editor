import { useUploadStore } from '../stores/uploadStore';
import { UPLOAD_PHASE } from '../services/uploadManager';

/**
 * Global upload progress indicator that appears at the bottom of the screen
 * Shows upload status regardless of which screen the user is on
 */
export function UploadProgressIndicator() {
  const activeUpload = useUploadStore(state => state.activeUpload);
  const clearFailedUpload = useUploadStore(state => state.clearFailedUpload);
  const retryUpload = useUploadStore(state => state.retryUpload);

  if (!activeUpload) {
    return null;
  }

  const isError = activeUpload.phase === UPLOAD_PHASE.ERROR;
  const fileSizeMB = (activeUpload.fileSize / (1024 * 1024)).toFixed(0);

  return (
    <div className="fixed bottom-4 right-4 z-50 bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4 w-80">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-200 truncate flex-1 mr-2">
          Uploading {activeUpload.fileName}
        </span>
        <span className="text-xs text-gray-400">
          {fileSizeMB} MB
        </span>
      </div>

      {!isError ? (
        <>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">
              {activeUpload.message || 'Uploading...'}
            </span>
            <span className="text-xs text-gray-400">
              {activeUpload.progress}%
            </span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300"
              style={{ width: `${activeUpload.progress}%` }}
            />
          </div>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-red-400 flex-1">
            {activeUpload.message || 'Upload failed'}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={retryUpload}
              className="text-xs font-medium text-blue-400 hover:text-blue-300 underline"
            >
              Retry
            </button>
            <button
              onClick={clearFailedUpload}
              className="text-xs text-gray-400 hover:text-white underline"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default UploadProgressIndicator;

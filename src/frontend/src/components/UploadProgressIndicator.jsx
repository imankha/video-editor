import {
  useUploadStore,
  useActiveUpload,
  useQueuedUploads,
  useFailedUploads,
} from '../stores/uploadStore';

/**
 * Global upload progress indicator, bottom-right, visible on every screen.
 *
 * T7360: renders the whole upload QUEUE as a stack — the active upload's live
 * progress card on top, then each failed upload (with its own Retry/Dismiss) and each
 * queued upload (with its own Cancel). With a single upload running (and none
 * queued/failed) it renders exactly one card, identical to the pre-queue UI.
 */
export function UploadProgressIndicator() {
  const active = useActiveUpload();
  const queued = useQueuedUploads();
  const failed = useFailedUploads();
  const retryUpload = useUploadStore(state => state.retryUpload);
  const clearFailedUpload = useUploadStore(state => state.clearFailedUpload);
  const cancelUpload = useUploadStore(state => state.cancelUpload);

  if (!active && queued.length === 0 && failed.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-80">
      {active && <ActiveUploadRow upload={active} />}
      {failed.map(upload => (
        <FailedUploadRow
          key={upload.id}
          upload={upload}
          onRetry={() => retryUpload(upload.id)}
          onDismiss={() => clearFailedUpload(upload.id)}
        />
      ))}
      {queued.map(upload => (
        <QueuedUploadRow
          key={upload.id}
          upload={upload}
          onCancel={() => cancelUpload(upload.id)}
        />
      ))}
    </div>
  );
}

const CARD_CLASS = 'bg-gray-800 border border-gray-700 rounded-lg shadow-xl p-4';

function ActiveUploadRow({ upload }) {
  const fileSizeMB = (upload.fileSize / (1024 * 1024)).toFixed(0);
  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-200 truncate flex-1 mr-2">
          Uploading {upload.fileName}
        </span>
        <span className="text-xs text-gray-400">{fileSizeMB} MB</span>
      </div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs text-gray-400">{upload.message || 'Uploading...'}</span>
        <span className="text-xs text-gray-400">{upload.progress}%</span>
      </div>
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 transition-all duration-300"
          style={{ width: `${upload.progress}%` }}
        />
      </div>
    </div>
  );
}

function FailedUploadRow({ upload, onRetry, onDismiss }) {
  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-200 truncate flex-1 mr-2">
          Uploading {upload.fileName}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-red-400 flex-1">
          {upload.message || 'Upload failed'}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onRetry}
            className="text-xs font-medium text-blue-400 hover:text-blue-300 underline"
          >
            Retry
          </button>
          <button
            onClick={onDismiss}
            className="text-xs text-gray-400 hover:text-white underline"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}

function QueuedUploadRow({ upload, onCancel }) {
  return (
    <div className={CARD_CLASS}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-gray-200 truncate flex-1 mr-2">
          {upload.fileName}
        </span>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-gray-400">Queued</span>
          <button
            onClick={onCancel}
            className="text-xs text-gray-400 hover:text-white underline"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default UploadProgressIndicator;

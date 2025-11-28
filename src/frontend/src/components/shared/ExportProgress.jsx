import { Loader } from 'lucide-react';

/**
 * Shared export progress display.
 * Shows spinner, percentage, message, and progress bar.
 *
 * Used by both FramingExport and OverlayExport components.
 */
export function ExportProgress({
  isExporting,
  progress,
  progressMessage,
  label = 'AI Upscaling',
}) {
  if (!isExporting) return null;

  return (
    <>
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <Loader className="animate-spin" size={18} />
          <span className="font-medium">{label}... {progress}%</span>
        </div>
        {progressMessage && (
          <div className="text-xs opacity-80 mb-2">
            {progressMessage}
          </div>
        )}
      </div>

      <div className="w-full bg-gray-700 rounded-full h-2 overflow-hidden">
        <div
          className="bg-green-600 h-full transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>
    </>
  );
}

export default ExportProgress;

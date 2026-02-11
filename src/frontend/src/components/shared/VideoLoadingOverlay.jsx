import React from 'react';

/**
 * VideoLoadingOverlay - Shared loading indicator for video players
 *
 * Two modes:
 * - Simple: Just a spinner (for Gallery)
 * - Detailed: Spinner + progress bar + status messages (for main editor)
 *
 * @param {Object} props
 * @param {boolean} props.simple - Use simple mode (spinner only)
 * @param {string} props.message - Loading message to display
 * @param {number|null} props.progress - Buffering progress 0-100
 * @param {number} props.elapsedSeconds - Seconds since loading started
 */
export function VideoLoadingOverlay({
  simple = false,
  message = 'Loading video...',
  progress = null,
  elapsedSeconds = 0,
}) {
  // Simple mode - just a centered spinner
  if (simple) {
    return (
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-gray-600 border-t-purple-500" />
      </div>
    );
  }

  // Detailed mode - spinner + progress bar + messages
  const hasProgress = progress !== null && progress > 0 && progress < 100;
  const isSlowLoad = elapsedSeconds >= 5;

  let statusMessage;
  if (hasProgress) {
    statusMessage = `Buffering ${progress}%`;
  } else if (isSlowLoad) {
    statusMessage = `Downloading video... ${elapsedSeconds}s`;
  } else if (elapsedSeconds > 0) {
    statusMessage = `Connecting... ${elapsedSeconds}s`;
  } else {
    statusMessage = 'Connecting to server...';
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-gray-900/80 z-40">
      <div className="text-center w-64">
        <div className="mx-auto h-12 w-12 animate-spin rounded-full border-4 border-gray-600 border-t-purple-500" />
        <p className="mt-4 text-sm text-gray-300">{message}</p>
        <div className="mt-3">
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            {hasProgress ? (
              <div
                className="h-full bg-purple-500 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            ) : (
              // Indeterminate progress - sliding bar animation
              <div
                className="h-full w-1/3 bg-gradient-to-r from-purple-600 via-purple-400 to-purple-600 rounded-full"
                style={{
                  animation: 'slide 1.2s ease-in-out infinite',
                  transformOrigin: 'left center'
                }}
              />
            )}
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {statusMessage}
          </p>
          {isSlowLoad && (
            <p className="mt-2 text-xs text-gray-600">
              First load may be slow. Subsequent loads will be faster.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

export default VideoLoadingOverlay;

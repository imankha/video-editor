import React, { useState } from 'react';

/**
 * VideoPlayer component - Displays the video element
 * @param {Object} props
 * @param {React.RefObject} props.videoRef - Ref to video element
 * @param {string} props.videoUrl - Video source URL
 * @param {Object} props.handlers - Video element event handlers
 * @param {Function} props.onFileSelect - Callback for file upload via drag-and-drop
 */
export function VideoPlayer({ videoRef, videoUrl, handlers, onFileSelect }) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      // Validate file type
      if (file.type.startsWith('video/')) {
        onFileSelect?.(file);
      }
    }
  };

  return (
    <div
      className="video-player-container bg-black rounded-lg overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {videoUrl ? (
        <video
          ref={videoRef}
          src={videoUrl}
          className="w-full h-full max-h-[60vh] object-contain"
          onTimeUpdate={handlers.onTimeUpdate}
          onPlay={handlers.onPlay}
          onPause={handlers.onPause}
          onSeeking={handlers.onSeeking}
          onSeeked={handlers.onSeeked}
          onLoadedMetadata={handlers.onLoadedMetadata}
          preload="metadata"
        />
      ) : (
        <div
          className={`flex items-center justify-center h-[60vh] text-gray-400 transition-colors ${
            isDragging ? 'bg-blue-600/20 border-2 border-blue-500 border-dashed' : ''
          }`}
        >
          <div className="text-center">
            <svg
              className={`mx-auto h-12 w-12 ${isDragging ? 'text-blue-400' : 'text-gray-400'}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
            <p className="mt-2 text-sm">
              {isDragging ? 'Drop video here' : 'No video loaded'}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              {isDragging ? 'Release to upload' : 'Drag and drop a video or upload to get started'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

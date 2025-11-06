import { useState } from 'react';
import { useVideo } from './hooks/useVideo';
import { VideoPlayer } from './components/VideoPlayer';
import { Timeline } from './components/Timeline';
import { Controls } from './components/Controls';
import { FileUpload } from './components/FileUpload';

function App() {
  const {
    videoRef,
    videoUrl,
    metadata,
    isPlaying,
    currentTime,
    duration,
    error,
    isLoading,
    loadVideo,
    togglePlay,
    seek,
    stepForward,
    stepBackward,
    handlers,
  } = useVideo();

  const handleFileSelect = async (file) => {
    await loadVideo(file);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="container mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-4xl font-bold text-white mb-2">
              🎬 Video Editor
            </h1>
            <p className="text-gray-400">
              Upload a video to get started
            </p>
          </div>
          <FileUpload onFileSelect={handleFileSelect} isLoading={isLoading} />
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 bg-red-500/20 border border-red-500 rounded-lg p-4">
            <p className="text-red-200 font-semibold mb-1">❌ Error</p>
            <p className="text-red-300 text-sm">{error}</p>
          </div>
        )}

        {/* Video Metadata */}
        {metadata && (
          <div className="mb-4 bg-white/10 backdrop-blur-lg rounded-lg p-4 border border-white/20">
            <div className="flex items-center justify-between text-sm text-gray-300">
              <span className="font-semibold text-white">{metadata.fileName}</span>
              <div className="flex space-x-6">
                <span>
                  <span className="text-gray-400">Resolution:</span>{' '}
                  {metadata.width}x{metadata.height}
                </span>
                <span>
                  <span className="text-gray-400">Format:</span>{' '}
                  {metadata.format.toUpperCase()}
                </span>
                <span>
                  <span className="text-gray-400">Size:</span>{' '}
                  {(metadata.size / (1024 * 1024)).toFixed(2)} MB
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Main Editor Area */}
        <div className="bg-white/10 backdrop-blur-lg rounded-lg p-6 border border-white/20">
          {/* Video Player */}
          <VideoPlayer
            videoRef={videoRef}
            videoUrl={videoUrl}
            handlers={handlers}
            onFileSelect={handleFileSelect}
          />

          {/* Timeline */}
          {videoUrl && (
            <div className="mt-6">
              <Timeline
                currentTime={currentTime}
                duration={duration}
                onSeek={seek}
              />
            </div>
          )}

          {/* Controls */}
          {videoUrl && (
            <div className="mt-6">
              <Controls
                isPlaying={isPlaying}
                currentTime={currentTime}
                duration={duration}
                onTogglePlay={togglePlay}
                onStepForward={stepForward}
                onStepBackward={stepBackward}
              />
            </div>
          )}
        </div>

        {/* Instructions */}
        {!videoUrl && !isLoading && !error && (
          <div className="mt-8 text-center text-gray-400">
            <div className="max-w-2xl mx-auto space-y-4">
              <h2 className="text-xl font-semibold text-white mb-4">
                Getting Started
              </h2>
              <div className="grid md:grid-cols-3 gap-4 text-sm">
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">📤</div>
                  <h3 className="font-semibold text-white mb-1">1. Upload</h3>
                  <p>Click "Upload Video" to select a video file (MP4, MOV, WebM)</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">▶️</div>
                  <h3 className="font-semibold text-white mb-1">2. Play</h3>
                  <p>Use the play/pause button to control playback</p>
                </div>
                <div className="bg-white/5 rounded-lg p-4">
                  <div className="text-2xl mb-2">⏱️</div>
                  <h3 className="font-semibold text-white mb-1">3. Scrub</h3>
                  <p>Click or drag the timeline to navigate through your video</p>
                </div>
              </div>
              <div className="mt-6 text-xs text-gray-500">
                <p>Supported formats: MP4, MOV, WebM</p>
                <p>Maximum file size: 4GB</p>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="mt-8 text-center text-gray-500 text-sm">
          <p>Phase 1: Foundation - Video Upload & Playback</p>
        </div>
      </div>
    </div>
  );
}

export default App;

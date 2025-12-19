import React from 'react';
import AnnotateTimeline from './AnnotateTimeline';

/**
 * AnnotateMode - Timeline-only component for Annotate mode.
 *
 * The video player and side panel are rendered at the App level.
 * This component only renders the timeline for managing clip regions.
 *
 * Clips are added via:
 * - "Add Clip" button in the controls bar (non-fullscreen)
 * - Pausing in fullscreen mode
 * Both methods use current playhead position as the clip END time.
 */
export default function AnnotateMode({
  currentTime,
  duration,
  isPlaying,
  onSeek,
  regions,
  selectedRegionId,
  onSelectRegion,
  onDeleteRegion,
}) {
  if (!duration) return null;

  return (
    <div className="mt-6">
      <AnnotateTimeline
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
        isPlaying={isPlaying}
        regions={regions}
        selectedRegionId={selectedRegionId}
        onSelectRegion={onSelectRegion}
        onDeleteRegion={onDeleteRegion}
      />
    </div>
  );
}

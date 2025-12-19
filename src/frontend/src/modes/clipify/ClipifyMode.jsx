import React from 'react';
import ClipifyTimeline from './ClipifyTimeline';

/**
 * ClipifyMode - Timeline-only component for Clipify mode.
 *
 * The video player and side panel are rendered at the App level.
 * This component only renders the timeline for creating/managing clip regions.
 *
 * Clips are added by clicking on the timeline (like adding segment boundaries).
 * Stars mark clip positions - click to select, click again to delete.
 */
export default function ClipifyMode({
  currentTime,
  duration,
  isPlaying,
  onSeek,
  regions,
  selectedRegionId,
  onSelectRegion,
  onDeleteRegion,
  onAddClipRegion,
}) {
  // Handle timeline click to add new clip region
  const handleTimelineClick = (clickedTime) => {
    // Add a clip region centered at the clicked time
    if (onAddClipRegion) {
      onAddClipRegion(clickedTime);
    }
  };

  if (!duration) return null;

  return (
    <div className="mt-6">
      <ClipifyTimeline
        currentTime={currentTime}
        duration={duration}
        onSeek={onSeek}
        isPlaying={isPlaying}
        regions={regions}
        selectedRegionId={selectedRegionId}
        onSelectRegion={onSelectRegion}
        onDeleteRegion={onDeleteRegion}
        onTimelineClick={handleTimelineClick}
      />
    </div>
  );
}

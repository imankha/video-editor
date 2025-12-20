import React from 'react';
import { Scissors } from 'lucide-react';
import ClipListItem from './ClipListItem';
import ClipDetailsEditor from './ClipDetailsEditor';

/**
 * ClipsSidePanel - Left sidebar for managing clip regions in Annotate mode
 *
 * Matches ClipSelectorSidebar styling for visual consistency.
 * Clips are added by clicking on the timeline, not via button.
 */
export function ClipsSidePanel({
  clipRegions,
  selectedRegionId,
  onSelectRegion,
  onUpdateRegion,
  onDeleteRegion,
  maxNotesLength,
  clipCount,
  videoDuration,
}) {
  const selectedRegion = clipRegions.find(r => r.id === selectedRegionId);

  return (
    <div className="w-56 bg-gray-900/95 border-r border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <Scissors size={18} className="text-green-400" />
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Clips</h2>
          <span className="ml-auto text-xs text-gray-500">{clipCount}</span>
        </div>
        <p className="text-xs text-gray-500">Click timeline to add clip</p>
      </div>

      {/* Clip List */}
      <div className="flex-1 overflow-y-auto">
        {clipRegions.length === 0 ? (
          <div className="p-4 text-gray-500 text-sm text-center">
            No clips yet
          </div>
        ) : (
          clipRegions.map((region, index) => (
            <ClipListItem
              key={region.id}
              region={region}
              index={index}
              isSelected={region.id === selectedRegionId}
              onClick={() => onSelectRegion(region.id)}
            />
          ))
        )}
      </div>

      {/* Details Editor (when clip selected) */}
      {selectedRegion && (
        <ClipDetailsEditor
          region={selectedRegion}
          onUpdate={(updates) => onUpdateRegion(selectedRegion.id, updates)}
          onDelete={() => onDeleteRegion(selectedRegion.id)}
          maxNotesLength={maxNotesLength}
          videoDuration={videoDuration}
        />
      )}
    </div>
  );
}

export default ClipsSidePanel;

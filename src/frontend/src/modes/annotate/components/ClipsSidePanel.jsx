import React from 'react';
import { Download, Scissors } from 'lucide-react';
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
  regionsWithLayout,
  selectedRegionId,
  onSelectRegion,
  onUpdateRegion,
  onDeleteRegion,
  maxNotesLength,
  hasClips,
  clipCount,
  videoDuration,
  onExport,
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

      {/* Export Button */}
      <div className="p-3 border-t border-gray-700">
        <button
          onClick={onExport}
          disabled={!hasClips}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Download size={16} />
          <span>Export</span>
        </button>
      </div>
    </div>
  );
}

export default ClipsSidePanel;

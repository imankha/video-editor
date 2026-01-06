import { useRef, useState } from 'react';
import { Scissors, Upload, Download, X, AlertCircle, Loader } from 'lucide-react';
import ClipListItem from './ClipListItem';
import ClipDetailsEditor from './ClipDetailsEditor';
import { validateTsvContent, generateTsvContent } from '../hooks/useAnnotate';

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
  onImportAnnotations,
  maxNotesLength,
  clipCount,
  videoDuration,
  isLoading = false,
}) {
  const selectedRegion = clipRegions.find(r => r.id === selectedRegionId);
  const fileInputRef = useRef(null);
  const [importErrors, setImportErrors] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);

  const handleImportClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset state
    setImportErrors(null);
    setImportSuccess(null);

    try {
      const content = await file.text();
      const result = validateTsvContent(content);

      if (!result.success) {
        setImportErrors(result.errors);
      } else {
        const count = onImportAnnotations(result.annotations);
        setImportSuccess(`Imported ${count} clip${count !== 1 ? 's' : ''}`);
        // Clear success message after 3 seconds
        setTimeout(() => setImportSuccess(null), 3000);
      }
    } catch (err) {
      setImportErrors([`Failed to read file: ${err.message}`]);
    }

    // Reset file input so same file can be selected again
    e.target.value = '';
  };

  const dismissErrors = () => {
    setImportErrors(null);
  };

  const handleExportClick = () => {
    if (clipRegions.length === 0) return;

    const tsvContent = generateTsvContent(clipRegions);
    const blob = new Blob([tsvContent], { type: 'text/tab-separated-values' });
    const url = URL.createObjectURL(blob);

    // Create temporary link and trigger download
    const link = document.createElement('a');
    link.href = url;
    link.download = 'annotations.tsv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-[352px] bg-gray-900/95 border-r border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-2">
          <Scissors size={18} className="text-green-400" />
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Clips</h2>
          <span className="ml-auto text-xs text-gray-500">{clipCount}</span>
        </div>
        <p className="text-xs text-gray-500 mb-3">Click timeline to add clip</p>

        {/* Import/Export Buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleImportClick}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded transition-colors"
          >
            <Upload size={16} />
            Import
          </button>
          <button
            onClick={handleExportClick}
            disabled={clipRegions.length === 0}
            className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 text-sm rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download size={16} />
            Export
          </button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".tsv,.txt"
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Success Message */}
        {importSuccess && (
          <div className="mt-2 p-2 bg-green-900/50 border border-green-700 rounded text-green-300 text-xs">
            {importSuccess}
          </div>
        )}
      </div>

      {/* Import Errors Modal */}
      {importErrors && (
        <div className="p-3 border-b border-red-700 bg-red-900/30">
          <div className="flex items-start gap-2">
            <AlertCircle size={16} className="text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <span className="text-red-400 text-xs font-semibold">Import Errors</span>
                <button
                  onClick={dismissErrors}
                  className="text-gray-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
              <div className="max-h-32 overflow-y-auto">
                {importErrors.map((error, i) => (
                  <p key={i} className="text-red-300 text-xs mb-1 break-words">
                    {error}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Clip List - scrollable with custom scrollbar */}
      <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
        {isLoading ? (
          <div className="p-4 text-gray-400 text-sm text-center flex flex-col items-center gap-2">
            <Loader size={20} className="animate-spin text-green-400" />
            <span>Loading clips...</span>
          </div>
        ) : clipRegions.length === 0 ? (
          <div className="p-4 text-gray-500 text-sm text-center">
            No clips yet
          </div>
        ) : (
          // Sort by endTime to match timeline order
          [...clipRegions].sort((a, b) => a.endTime - b.endTime).map((region, index) => (
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

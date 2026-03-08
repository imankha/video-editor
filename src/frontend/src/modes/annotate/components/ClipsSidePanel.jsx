import { useRef, useState } from 'react';
import { Scissors, Upload, Download, X, AlertCircle, Loader, ArrowLeft, MoreVertical } from 'lucide-react';
import { Button } from '../../../components/shared/Button';
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
  onDeselectRegion,
  onUpdateRegion,
  onDeleteRegion,
  onImportAnnotations,
  maxNotesLength,
  clipCount,
  videoDuration,
  isLoading = false,
  isVideoUploading = false,
  isMobile = false,
}) {
  const selectedRegion = clipRegions.find(r => r.id === selectedRegionId);
  const fileInputRef = useRef(null);
  const [importErrors, setImportErrors] = useState(null);
  const [importSuccess, setImportSuccess] = useState(null);
  const [showOverflowMenu, setShowOverflowMenu] = useState(false);

  // On mobile: show detail view when a clip is selected, list view otherwise
  const mobileShowDetail = isMobile && selectedRegion;

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
        const count = await onImportAnnotations(result.annotations, videoDuration);
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
    <div className={`${isMobile ? 'w-full' : 'w-[352px]'} bg-gray-900/95 border-r border-gray-700 flex flex-col h-full`}>
      {/* Mobile Detail View - full panel takeover when clip selected */}
      {mobileShowDetail ? (
        <>
          {/* Back to list header */}
          <div className="p-3 border-b border-gray-700">
            <button
              onClick={() => onDeselectRegion?.()}
              className="flex items-center gap-2 text-gray-300 hover:text-white transition-colors"
            >
              <ArrowLeft size={18} />
              <span className="text-sm font-medium">Back to clips</span>
              <span className="ml-auto text-xs text-gray-500">{clipCount}</span>
            </button>
          </div>
          {/* Full-panel details editor */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            <ClipDetailsEditor
              region={selectedRegion}
              onUpdate={(updates) => onUpdateRegion(selectedRegion.id, updates)}
              onDelete={() => { onDeleteRegion(selectedRegion.id); onDeselectRegion?.(); }}
              maxNotesLength={maxNotesLength}
              videoDuration={videoDuration}
              compact
            />
          </div>
        </>
      ) : (
        <>
          {/* Header */}
          <div className="p-4 border-b border-gray-700">
            <div className="flex items-center gap-2 mb-2">
              <Scissors size={18} className="text-green-400" />
              <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Clips</h2>
              <span className="ml-auto text-xs text-gray-500">{clipCount}</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">Click timeline to add clip</p>

            {/* Import/Export - full buttons on desktop, overflow menu on mobile */}
            {isMobile ? (
              <div className="relative">
                <button
                  onClick={() => setShowOverflowMenu(!showOverflowMenu)}
                  className="flex items-center gap-1.5 px-2.5 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-300 text-xs transition-colors"
                >
                  <MoreVertical size={14} />
                  <span>Import / Export</span>
                </button>
                {showOverflowMenu && (
                  <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl z-10 min-w-[140px]">
                    <button
                      onClick={() => { handleImportClick(); setShowOverflowMenu(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 rounded-t-lg"
                    >
                      <Upload size={14} />
                      Import TSV
                    </button>
                    <button
                      onClick={() => { handleExportClick(); setShowOverflowMenu(false); }}
                      disabled={clipRegions.length === 0}
                      className="flex items-center gap-2 w-full px-3 py-2.5 text-sm text-gray-300 hover:bg-gray-700 rounded-b-lg disabled:opacity-40"
                    >
                      <Download size={14} />
                      Export TSV
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Upload}
                  className="flex-1"
                  onClick={handleImportClick}
                  title="Import clips from TSV file"
                >
                  Import
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Download}
                  className="flex-1"
                  onClick={handleExportClick}
                  disabled={clipRegions.length === 0}
                >
                  Export
                </Button>
              </div>
            )}
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
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={X}
                      iconOnly
                      onClick={dismissErrors}
                    />
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
                  isMobile={isMobile}
                />
              ))
            )}
          </div>

          {/* Details Editor (desktop only - on mobile it takes over the full panel) */}
          {!isMobile && selectedRegion && (
            <ClipDetailsEditor
              region={selectedRegion}
              onUpdate={(updates) => onUpdateRegion(selectedRegion.id, updates)}
              onDelete={() => onDeleteRegion(selectedRegion.id)}
              maxNotesLength={maxNotesLength}
              videoDuration={videoDuration}
            />
          )}
        </>
      )}
    </div>
  );
}

export default ClipsSidePanel;

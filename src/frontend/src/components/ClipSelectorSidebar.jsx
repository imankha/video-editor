import { useState, useRef, useMemo } from 'react';
import { GripVertical, X, Plus, Film, MessageSquare, Upload, Library } from 'lucide-react';
import { ClipLibraryModal } from './ClipLibraryModal';
import { UploadClipModal } from './UploadClipModal';
import { Button } from './shared/Button';
import { getRatingDisplay, formatDuration } from './shared/clipConstants';
import { createGameLookup, formatClipDisplayName } from '../utils/gameNameLookup';

/**
 * ClipSelectorSidebar - Sidebar for managing multiple video clips
 *
 * Features:
 * - Display list of clips with filename and duration
 * - Click to select a clip (loads it into the main timeline)
 * - Drag-and-drop to reorder clips
 * - Delete button per clip
 * - Add clip button (opens file picker)
 * - Rating badges for clips imported from annotate mode
 *
 * @param {Array} clips - Array of clip objects: { id, file, fileName, duration, rating?, ... }
 * @param {string} selectedClipId - Currently selected clip ID
 * @param {Function} onSelectClip - Callback when clip is clicked
 * @param {Function} onAddClip - Callback to add new clip
 * @param {Function} onDeleteClip - Callback to delete a clip
 * @param {Function} onReorderClips - Callback when clips are reordered via drag
 * @param {Object} globalTransition - Current transition settings { type, duration }
 * @param {Function} onTransitionChange - Callback to change transition
 * @param {Function} onAddFromLibrary - Callback for adding clips from library
 * @param {Array} existingRawClipIds - Raw clip IDs already in the project
 */
export function ClipSelectorSidebar({
  clips,
  selectedClipId,
  onSelectClip,
  onAddClip,
  onDeleteClip,
  onReorderClips,
  globalTransition,
  onTransitionChange,
  onAddFromLibrary,
  onUploadWithMetadata,
  existingRawClipIds = [],
  games = []
}) {
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showLibraryModal, setShowLibraryModal] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [pendingUploadFile, setPendingUploadFile] = useState(null);
  const fileInputRef = useRef(null);

  // Create game lookup for display names
  const gameLookup = useMemo(() => createGameLookup(games), [games]);

  /**
   * Handle file selection - shows upload modal for metadata entry
   */
  const handleFileChange = (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      // For now, handle first file with modal (can extend to queue for multiple)
      const file = files[0];
      setPendingUploadFile(file);
      setShowUploadModal(true);
      // Reset the input so the same file can be selected again
      e.target.value = '';
    }
  };

  /**
   * Handle upload with metadata from modal
   */
  const handleUploadWithMetadata = async (uploadData) => {
    if (onUploadWithMetadata) {
      await onUploadWithMetadata(uploadData);
    } else {
      // Fallback to simple upload if handler not provided
      onAddClip(uploadData.file);
    }
    setPendingUploadFile(null);
  };

  /**
   * Open file picker
   */
  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  /**
   * Handle library clip selection
   */
  const handleLibrarySelect = (rawClipId) => {
    if (onAddFromLibrary) {
      onAddFromLibrary(rawClipId);
    }
  };

  /**
   * Drag start handler
   */
  const handleDragStart = (e, index) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', index.toString());
  };

  /**
   * Drag over handler
   */
  const handleDragOver = (e, index) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  /**
   * Drag leave handler
   */
  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  /**
   * Drop handler
   */
  const handleDrop = (e, toIndex) => {
    e.preventDefault();
    const fromIndex = draggedIndex;

    if (fromIndex !== null && fromIndex !== toIndex) {
      onReorderClips(fromIndex, toIndex);
    }

    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  /**
   * Drag end handler
   */
  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  /**
   * Handle transition type change
   */
  const handleTransitionTypeChange = (e) => {
    onTransitionChange({
      ...globalTransition,
      type: e.target.value
    });
  };

  return (
    <div className="w-56 bg-gray-900/95 border-r border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <div className="flex items-center gap-2 mb-3">
          <Film size={18} className="text-purple-400" />
          <h2 className="text-sm font-semibold text-white uppercase tracking-wide">Clips</h2>
          <span className="ml-auto text-xs text-gray-500">{clips.length}</span>
        </div>

        {/* Transition selector - disabled for single clip */}
        <div className="flex items-center gap-2">
          <span className={`text-xs ${clips.length <= 1 ? 'text-gray-600' : 'text-gray-400'}`}>Transition:</span>
          <select
            value={globalTransition.type}
            onChange={handleTransitionTypeChange}
            disabled={clips.length <= 1}
            className={`flex-1 text-xs rounded px-2 py-1 border focus:outline-none ${
              clips.length <= 1
                ? 'bg-gray-800/50 text-gray-500 border-gray-700 cursor-not-allowed'
                : 'bg-gray-800 text-white border-gray-600 focus:border-purple-500'
            }`}
          >
            <option value="cut">Cut</option>
            <option value="fade">Fade</option>
            <option value="dissolve">Dissolve</option>
          </select>
        </div>
      </div>

      {/* Clip list - scrollable with custom scrollbar */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {clips.map((clip, index) => {
          // Get rating display info if clip has a rating
          const hasRating = clip.rating != null;
          const ratingInfo = hasRating ? getRatingDisplay(clip.rating) : null;
          const isSelected = selectedClipId === clip.id;

          return (
            <div
              key={clip.id}
              draggable
              onDragStart={(e) => handleDragStart(e, index)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, index)}
              onDragEnd={handleDragEnd}
              onClick={() => onSelectClip(clip.id)}
              className={`
                group cursor-pointer border-b border-gray-800 transition-all
                ${isSelected
                  ? 'border-l-2'
                  : 'hover:bg-gray-800/50 border-l-2 border-l-transparent'
                }
                ${dragOverIndex === index ? 'border-t-2 border-t-purple-500' : ''}
                ${draggedIndex === index ? 'opacity-50' : ''}
              `}
              style={{
                backgroundColor: isSelected
                  ? (hasRating ? ratingInfo.backgroundColor : 'rgba(147, 51, 234, 0.25)')
                  : undefined,
                borderLeftColor: isSelected
                  ? (hasRating ? ratingInfo.badgeColor : 'rgb(147, 51, 234)')
                  : undefined,
              }}
            >
              <div className="flex items-center px-2 py-3">
                {/* Drag handle */}
                <div className="mr-2 cursor-grab text-gray-500 hover:text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical size={14} />
                </div>

                {/* Rating badge (if clip has rating from annotate) */}
                {hasRating && (
                  <div
                    className="px-1.5 py-0.5 mr-2 rounded font-bold text-xs flex-shrink-0"
                    style={{
                      backgroundColor: ratingInfo.badgeColor,
                      color: '#ffffff',
                      textShadow: '0 1px 2px rgba(0,0,0,0.5)',
                      border: '1px solid rgba(0,0,0,0.3)',
                    }}
                    title={`Rating: ${clip.rating}/5`}
                  >
                    {ratingInfo.notation}
                  </div>
                )}

                {/* Clip info */}
                <div className="flex-1 min-w-0">
                  {/* Clip number and name on same line */}
                  {(() => {
                    const clipName = clip.annotateName || clip.fileNameDisplay || clip.fileName;
                    const displayName = formatClipDisplayName(clipName, clip.game_id, gameLookup);
                    return (
                      <div
                        className="text-sm text-white truncate"
                        title={displayName}
                      >
                        <span className="text-gray-500 mr-1">{index + 1}.</span>
                        {displayName}
                      </div>
                    );
                  })()}
                  {/* Duration and source info */}
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <span>{formatDuration(clip.duration)}</span>
                    {/* Show notes indicator if clip has annotate notes */}
                    {clip.annotateNotes && (
                      <span
                        className="inline-flex items-center text-purple-400"
                        title={clip.annotateNotes}
                      >
                        <MessageSquare size={10} className="mr-0.5" />
                        <span className="truncate max-w-[60px]">
                          {clip.annotateNotes.length > 15
                            ? clip.annotateNotes.slice(0, 15) + '...'
                            : clip.annotateNotes}
                        </span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete button */}
                <Button
                  variant="ghost"
                  size="sm"
                  icon={X}
                  iconOnly
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteClip(clip.id);
                  }}
                  className="ml-2 opacity-0 group-hover:opacity-100 hover:bg-red-600/30 hover:text-red-400"
                  title="Remove clip"
                />
              </div>
            </div>
          );
        })}

        {/* Empty state */}
        {clips.length === 0 && (
          <div className="p-4 text-center text-gray-500 text-sm">
            No clips added yet
          </div>
        )}
      </div>

      {/* Add clip section */}
      <div className="p-3 border-t border-gray-700">
        {showAddMenu ? (
          <div className="space-y-2">
            {/* Upload option */}
            <Button
              variant="secondary"
              size="sm"
              icon={Upload}
              fullWidth
              onClick={() => {
                fileInputRef.current?.click();
                setShowAddMenu(false);
              }}
            >
              Upload Clip
            </Button>

            {/* Library option */}
            <Button
              variant="secondary"
              size="sm"
              icon={Library}
              fullWidth
              onClick={() => {
                setShowLibraryModal(true);
                setShowAddMenu(false);
              }}
            >
              From Library
            </Button>

            {/* Cancel */}
            <Button
              variant="ghost"
              size="sm"
              fullWidth
              onClick={() => setShowAddMenu(false)}
            >
              Cancel
            </Button>
          </div>
        ) : (
          <Button
            variant="primary"
            size="sm"
            icon={Plus}
            fullWidth
            onClick={() => setShowAddMenu(true)}
          >
            Add Clip
          </Button>
        )}

        {/* Hidden file input (supports multiple files) */}
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileChange}
          className="hidden"
          multiple
        />
      </div>

      {/* Library Modal */}
      <ClipLibraryModal
        isOpen={showLibraryModal}
        onClose={() => setShowLibraryModal(false)}
        onSelectClip={handleLibrarySelect}
        existingClipIds={existingRawClipIds}
        games={games}
      />

      {/* Upload Modal */}
      <UploadClipModal
        isOpen={showUploadModal}
        onClose={() => {
          setShowUploadModal(false);
          setPendingUploadFile(null);
        }}
        onUpload={handleUploadWithMetadata}
        selectedFile={pendingUploadFile}
        existingClips={clips}
      />

      {/* Total duration */}
      {clips.length > 1 && (
        <div className="px-4 py-2 border-t border-gray-700 text-xs text-gray-500 text-center">
          Total: {formatDuration(clips.reduce((sum, clip) => sum + (clip.duration || 0), 0))}
        </div>
      )}
    </div>
  );
}

export default ClipSelectorSidebar;

import React, { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { ANNOTATE } from '../../../config/displayNames';

/**
 * DeletePlayButton — T10610 § D.1: the ONE delete-with-confirm control, shared
 * by the sidebar (ClipDetailsEditor) and every play-editor overlay layout.
 * Literal move of ClipDetailsEditor's former inline confirm swap (same
 * strings, same testids) — the sanctioned 2nd-copy extraction (design doc
 * binding constraint 5): both copies were byte-identical.
 *
 * `variant="full"` renders the labeled button (sidebar, formBody/strip/inline
 * footers). `variant="icon"` renders an icon-only button for the
 * space-constrained landscape-inline bar — same confirm/cancel semantics,
 * compact markup.
 */
export function DeletePlayButton({ hasProject, onDelete, variant = 'full' }) {
  const [showConfirm, setShowConfirm] = useState(false);

  const label = hasProject ? ANNOTATE.DELETE_CLIP : ANNOTATE.DELETE_PLAY;

  const handleDeleteClick = () => setShowConfirm(true);
  const handleConfirmDelete = () => {
    setShowConfirm(false);
    onDelete();
  };
  const handleCancelDelete = () => setShowConfirm(false);

  if (showConfirm) {
    if (variant === 'icon') {
      return (
        <div className="flex gap-1" data-testid="delete-play-confirm">
          <button
            onClick={handleConfirmDelete}
            className="px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded text-xs transition-colors"
            title="Confirm Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleCancelDelete}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-xs transition-colors"
            title="Cancel"
          >
            Cancel
          </button>
        </div>
      );
    }
    return (
      <div className="flex gap-2" data-testid="delete-play-confirm">
        <button
          onClick={handleConfirmDelete}
          className="flex-1 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm whitespace-nowrap transition-colors"
        >
          Confirm Delete
        </button>
        <button
          onClick={handleCancelDelete}
          className="flex-1 px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm whitespace-nowrap transition-colors"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (variant === 'icon') {
    return (
      <button
        onClick={handleDeleteClick}
        className="p-1.5 bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white rounded transition-colors coarse-pointer:min-w-[44px] coarse-pointer:min-h-[44px] coarse-pointer:flex coarse-pointer:items-center coarse-pointer:justify-center"
        title={label}
        data-testid="delete-play-button"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    );
  }

  return (
    <button
      onClick={handleDeleteClick}
      className="w-full px-3 py-1.5 bg-gray-700 hover:bg-red-600 text-gray-300 hover:text-white rounded text-sm flex items-center justify-center gap-1.5 transition-colors"
      data-testid="delete-play-button"
    >
      <Trash2 className="w-4 h-4" />
      {/* T9520 N14: a play that produced a clip deletes a "clip"; a bare
          marked play deletes a "play". */}
      <span>{label}</span>
    </button>
  );
}

export default DeletePlayButton;

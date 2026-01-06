import React, { useState, useEffect } from 'react';
import { X, Star, Check } from 'lucide-react';
import { API_BASE } from '../config';

const API_BASE_URL = `${API_BASE}/api`;

/**
 * ClipLibraryModal - Select clips from the raw clips library
 */
export function ClipLibraryModal({
  isOpen,
  onClose,
  onSelectClip,
  existingClipIds = []  // Raw clip IDs already in the project
}) {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState(new Set());

  // Fetch raw clips
  useEffect(() => {
    if (!isOpen) return;

    const fetchClips = async () => {
      setLoading(true);
      try {
        const response = await fetch(`${API_BASE_URL}/clips/raw`);
        if (response.ok) {
          const data = await response.json();
          setClips(data);
        }
      } catch (err) {
        console.error('Failed to fetch clips:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchClips();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleToggleSelect = (clipId) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(clipId)) {
        next.delete(clipId);
      } else {
        next.add(clipId);
      }
      return next;
    });
  };

  const handleAdd = () => {
    selectedIds.forEach(id => {
      onSelectClip(id);
    });
    setSelectedIds(new Set());
    onClose();
  };

  // Filter out clips already in project
  const availableClips = clips.filter(clip => !existingClipIds.includes(clip.id));

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-lg w-full max-w-lg max-h-[80vh] flex flex-col border border-gray-700">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">Add from Library</h2>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded transition-colors"
          >
            <X size={20} className="text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="text-center text-gray-400 py-8">Loading...</div>
          ) : availableClips.length === 0 ? (
            <div className="text-center text-gray-500 py-8">
              {clips.length === 0
                ? 'No clips in library. Export from Annotate mode first.'
                : 'All clips already added to this project.'}
            </div>
          ) : (
            <div className="space-y-2">
              {availableClips.map(clip => {
                const isSelected = selectedIds.has(clip.id);
                return (
                  <div
                    key={clip.id}
                    onClick={() => handleToggleSelect(clip.id)}
                    className={`p-3 rounded-lg cursor-pointer border transition-all ${
                      isSelected
                        ? 'bg-purple-900/40 border-purple-500'
                        : 'bg-gray-700 border-gray-600 hover:border-gray-500'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {/* Checkbox */}
                      <div className={`w-5 h-5 rounded border flex items-center justify-center ${
                        isSelected
                          ? 'bg-purple-600 border-purple-600'
                          : 'border-gray-500'
                      }`}>
                        {isSelected && <Check size={14} className="text-white" />}
                      </div>

                      {/* Clip info */}
                      <div className="flex-1">
                        <div className="text-white font-medium">
                          {clip.filename.replace('.mp4', '')}
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-400">
                          {/* Rating stars */}
                          <span className="flex">
                            {[1, 2, 3, 4, 5].map(n => (
                              <Star
                                key={n}
                                size={12}
                                fill={n <= clip.rating ? '#fbbf24' : 'transparent'}
                                color={n <= clip.rating ? '#fbbf24' : '#6b7280'}
                              />
                            ))}
                          </span>
                          {/* Tags */}
                          {clip.tags?.length > 0 && (
                            <span className="text-xs">
                              {clip.tags.join(', ')}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleAdd}
            disabled={selectedIds.size === 0}
            className="flex-1 px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 text-white rounded-lg transition-colors"
          >
            Add {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}

export default ClipLibraryModal;

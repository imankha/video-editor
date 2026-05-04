import React, { useRef, useEffect } from 'react';
import { ClipListItem } from '../../modes/annotate/components/ClipListItem';

export function RecapClipsSidebar({ clips, activeClipId, onSeekToClip }) {
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeClipId]);

  return (
    <div className="flex flex-col h-full overflow-y-auto scrollbar-thin scrollbar-thumb-gray-600">
      {clips.map((clip, index) => {
        const isActive = clip.id === activeClipId;
        const tags = Array.isArray(clip.tags) ? clip.tags : [];
        const notes = clip.notes || '';
        const region = {
          rating: clip.rating || 3,
          tags,
          notes,
          name: clip.name || '',
          endTime: clip.recap_end,
        };

        const hasDetails = notes || tags.length > 0;

        return (
          <div key={clip.id} ref={isActive ? activeRef : null}>
            <ClipListItem
              region={region}
              index={index}
              isSelected={false}
              isPlaybackActive={isActive}
              onClick={() => onSeekToClip(clip.id)}
            />
            {hasDetails && (
              <div
                className="px-3 pb-1.5 -mt-0.5 cursor-pointer"
                onClick={() => onSeekToClip(clip.id)}
              >
                {tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {tags.map(tag => (
                      <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-700 text-gray-400">
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
                {notes && (
                  <p className="text-xs text-gray-500 truncate mt-0.5" title={notes}>
                    {notes}
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

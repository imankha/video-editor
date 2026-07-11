import React, { useEffect } from 'react';
import { X, ArrowRightLeft, Loader, User } from 'lucide-react';
import { REEL } from '../config/themeColors';

/**
 * MoveToProfileModal - T4850: pick a sibling profile to MOVE the selected published
 * reel(s) into. Same-user profiles only (multi-athlete accounts); the picker lists
 * the user's OTHER profiles. One tap = one explicit move gesture -> one API call.
 *
 * @param {number[]} videoIds       - reel ids being moved
 * @param {Array}    otherProfiles  - [{id,name,color}] profiles other than the current
 * @param {boolean}  moving         - a move is in flight
 * @param {(targetProfileId:string)=>void} onMove
 * @param {()=>void} onClose
 */
export function MoveToProfileModal({ videoIds, otherProfiles, moving, onMove, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !moving) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, moving]);

  const count = videoIds?.length || 0;

  return (
    <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={18} className={REEL.accent} />
            <h2 className="text-base font-bold text-white">
              Move {count > 1 ? `${count} reels` : 'reel'} to…
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={moving}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 disabled:opacity-50"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-3">
          <p className="text-xs text-gray-400 px-1 pb-2">
            The reel moves to the chosen profile and leaves this one. It stays
            playable and shareable, but is no longer editable here.
          </p>
          <div className="flex flex-col gap-1">
            {otherProfiles.map((p) => (
              <button
                key={p.id}
                onClick={() => onMove(p.id)}
                disabled={moving}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left
                           bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                <span
                  className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                  style={{ backgroundColor: p.color || '#4b5563' }}
                >
                  <User size={15} className="text-white" />
                </span>
                <span className="text-sm text-white font-medium truncate flex-1">{p.name}</span>
                {moving && <Loader size={16} className="text-gray-300 animate-spin shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default MoveToProfileModal;

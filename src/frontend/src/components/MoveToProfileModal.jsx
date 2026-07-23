import { useEffect, useState } from 'react';
import { X, ArrowRightLeft, Loader, User, ChevronLeft } from 'lucide-react';
import { REEL } from '../config/themeColors';

/**
 * MoveToProfileModal - T4850/T5678: MOVE a published reel into a sibling profile.
 * Same-user profiles only (multi-athlete accounts); the picker lists the user's
 * OTHER profiles. Moving a reel is hard for a parent to notice/undo, so the flow
 * is two gestures: pick a target profile, then confirm the move (T5678). One
 * confirmed move -> one explicit gesture -> one API call.
 *
 * @param {number[]} videoIds       - reel ids being moved (a single-reel list post-T5678)
 * @param {Array}    otherProfiles  - [{id,name,color}] profiles other than the current
 * @param {boolean}  moving         - a move is in flight
 * @param {(targetProfileId:string)=>void} onMove
 * @param {()=>void} onClose
 */
export function MoveToProfileModal({ videoIds, otherProfiles, moving, onMove, onClose }) {
  // Two-step flow: null = choosing a profile; a profile object = confirming the move.
  const [pendingTarget, setPendingTarget] = useState(null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || moving) return;
      if (pendingTarget) setPendingTarget(null); else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, moving, pendingTarget]);

  const count = videoIds?.length || 0;

  return (
    <div className="fixed inset-0 bg-black/60 z-[80] flex items-center justify-center p-4">
      <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <div className="flex items-center gap-2">
            {pendingTarget ? (
              <button
                onClick={() => setPendingTarget(null)}
                disabled={moving}
                className="p-1 -ml-1 rounded hover:bg-gray-700 text-gray-400 disabled:opacity-50"
                aria-label="Back"
              >
                <ChevronLeft size={18} />
              </button>
            ) : (
              <ArrowRightLeft size={18} className={REEL.accent} />
            )}
            <h2 className="text-base font-bold text-white">
              {pendingTarget
                ? `Move to ${pendingTarget.name}?`
                : `Move ${count > 1 ? `${count} reels` : 'reel'} to…`}
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

        {pendingTarget ? (
          <div className="p-4">
            <p className="text-sm text-gray-300 pb-4">
              This {count > 1 ? `${count} reels move` : 'reel moves'} to{' '}
              <span className="font-semibold text-white">{pendingTarget.name}</span> and
              {count > 1 ? ' leave' : ' leaves'} this profile. {count > 1 ? 'They stay' : 'It stays'}{' '}
              playable and shareable, but {count > 1 ? 'are' : 'is'} no longer editable here.
            </p>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setPendingTarget(null)}
                disabled={moving}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-200
                           bg-gray-700 hover:bg-gray-600 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => onMove(pendingTarget.id)}
                disabled={moving}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white inline-flex items-center gap-2
                           bg-cyan-600 hover:bg-cyan-500 transition-colors disabled:opacity-50"
              >
                {moving && <Loader size={16} className="animate-spin" />}
                Move {count > 1 ? 'reels' : 'reel'}
              </button>
            </div>
          </div>
        ) : (
          <div className="p-3">
            <p className="text-xs text-gray-400 px-1 pb-2">
              Choose which profile to move {count > 1 ? 'these reels' : 'this reel'} to.
            </p>
            <div className="flex flex-col gap-1">
              {otherProfiles.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setPendingTarget(p)}
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
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default MoveToProfileModal;

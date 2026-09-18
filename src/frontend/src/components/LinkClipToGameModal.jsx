import { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Link2, Film } from 'lucide-react';
import { Z } from '../constants/zLayers';
import { CLIP_LINK } from '../config/displayNames';
import { formatMatchDateLabel } from '../utils/matchDate';

/**
 * T10300: game picker for linking a directly-uploaded clip to a game. Opened from
 * the Clips-tab tile's "Link to game" action (upload clips only). Selecting a game
 * fires the link gesture in the parent's click handler (onLink) — this View never
 * fetches or persists. The games list is passed in from the parent (the
 * useGamesDataStore().readyGames single source), so this component holds no API
 * data of its own beyond the local search string.
 *
 * Reuses ClipUploadNoticeModal's backdrop + `bg-gray-800 rounded-xl` card shell and
 * portals to document.body at Z.MODAL like the other tile popovers.
 *
 * Props:
 *  - isOpen: boolean
 *  - games: ready games ({ id, name, game_date, clip_count } — the readyGames shape)
 *  - onClose(): dismiss without linking
 *  - onLink(gameId): user picked a game
 */
export function LinkClipToGameModal({ isOpen, games = [], onClose, onLink }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return games;
    return games.filter((g) => (g.name || '').toLowerCase().includes(q));
  }, [games, query]);

  if (!isOpen) return null;

  // Search box only earns its keep once the list is long enough to scan.
  const showSearch = games.length > 6;

  return createPortal(
    <div className={`fixed inset-0 ${Z.MODAL} flex items-center justify-center`}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-clip-title"
        className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 border border-gray-700 max-h-[85vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-5 border-b border-gray-700">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-cyan-600/20 rounded-lg shrink-0">
              <Link2 size={20} className="text-cyan-400" />
            </div>
            <div>
              <h2 id="link-clip-title" className="text-lg font-semibold text-white">
                {CLIP_LINK.PICKER_TITLE}
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">{CLIP_LINK.PICKER_SUBTITLE}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white rounded-lg hover:bg-gray-700 transition-colors"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>

        {/* Search */}
        {showSearch && (
          <div className="px-5 pt-4">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={CLIP_LINK.PICKER_SEARCH_PLACEHOLDER}
                autoFocus
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-gray-900/60 border border-gray-700 text-sm text-white placeholder-gray-500 outline-none focus:border-cyan-500"
              />
            </div>
          </div>
        )}

        {/* Game list */}
        <div className="p-3 overflow-y-auto">
          {games.length === 0 ? (
            <p className="px-2 py-6 text-sm text-gray-400 text-center">{CLIP_LINK.PICKER_EMPTY}</p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-6 text-sm text-gray-400 text-center">{CLIP_LINK.PICKER_NO_MATCH}</p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((game) => {
                const dateStr = game.date || game.game_date || game.created_at;
                const dateLabel = dateStr ? formatMatchDateLabel(dateStr) : null;
                return (
                  <li key={game.id}>
                    <button
                      type="button"
                      onClick={() => onLink(game.id)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-700/70 transition-colors group"
                    >
                      <div className="p-1.5 bg-green-600/20 rounded-md shrink-0">
                        <Film size={16} className="text-green-400" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-white font-medium truncate">{game.name || 'Untitled game'}</p>
                        <p className="text-xs text-gray-400 truncate">
                          {[dateLabel, game.clip_count != null ? CLIP_LINK.clipCount(game.clip_count) : null]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-gray-700 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
          >
            {CLIP_LINK.CANCEL}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export default LinkClipToGameModal;

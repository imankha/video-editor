import React, { useEffect, useState } from 'react';
import { Play, Share2, Link2, Download, X, Film } from 'lucide-react';
import { REEL } from '../../config/themeColors';
import { RATIO } from '../../constants/aspectRatios';

/**
 * JustPublishedCard (T11580) — the Published tab's "Just published" spotlight:
 * the ONE highlight the user just finished, rendered already expanded/playable
 * above Top Plays and every game group. Trigger is memory-only view state
 * (galleryStore.justPublished, Decision 1) — nothing here persists anything.
 *
 * Resolves the highlight via the SAME lazy/cached member fetch useCollections
 * already exposes for its game (or Mixes), never a dedicated endpoint — so a
 * group that's already been expanded this session resolves instantly from
 * cache, and a cold one fetches once. If the highlight isn't in that list by
 * render time (deleted/unpublished/moved elsewhere), this renders nothing —
 * no placeholder, no error toast (Decision/spec: "Missing highlight").
 *
 * Share/Copy link/Download reuse the EXACT per-reel handlers ReelTile's tile
 * actions call (PublishedReelsPanel's onPlay/onShare/onCopyLink/onDownload),
 * not the collection-level share (which has no single-video scope) — so the
 * result is provably identical to the equivalent action on the highlight's
 * own tile (acceptance criterion).
 *
 * @param {Object}   justPublished - { finalVideoId, gameId, aspectRatio }
 * @param {Object}   collections   - the lifted useCollections() value (members/memberStates/fetchMembers)
 * @param {Function} onDismiss     - () => void, the X gesture (clears justPublished)
 * @param {Function} buildPosterUrl - (finalVideoId) => string
 * @param {Function} onPlay        - (e, download) => void
 * @param {Function} onShare       - (e, download) => void
 * @param {Function} onCopyLink    - (e, download) => void
 * @param {Function} onDownload    - (e, download) => void
 * @param {Function} formatMeta    - (download) => string, "date · duration · game-time"
 */
export function JustPublishedCard({
  justPublished,
  collections,
  onDismiss,
  buildPosterUrl,
  onPlay,
  onShare,
  onCopyLink,
  onDownload,
  formatMeta,
}) {
  const { members, fetchMembers } = collections;
  const key = justPublished.gameId != null ? `game:${justPublished.gameId}` : 'mixes';
  const query = justPublished.gameId != null ? `game_id=${justPublished.gameId}` : 'mixes=true';

  // Mirrors GameCollectionGroup's own mount-only member fetch: cached/no-op if
  // this group was already expanded/loaded this session, otherwise fetches
  // once. Re-keyed only on `key` (a different game/mixes target), not on
  // every members/memberStates identity change.
  useEffect(() => {
    fetchMembers({ key, query });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const [posterState, setPosterState] = useState('loading');

  const highlight = (members[key] || []).find((m) => m.id === justPublished.finalVideoId);
  if (!highlight) return null;

  const isLandscape = justPublished.aspectRatio === RATIO.LANDSCAPE;
  const gameLine = [highlight.game_names?.[0], formatMeta(highlight)].filter(Boolean).join(' · ');

  return (
    <div
      data-testid="just-published-card"
      className={`relative mb-4 rounded-xl border ${REEL.borderSubtle} bg-gray-800 overflow-hidden ${
        isLandscape ? 'flex flex-col sm:flex-row' : 'flex flex-col'
      }`}
    >
      <button
        type="button"
        onClick={onDismiss}
        title="Dismiss"
        aria-label="Dismiss"
        className="absolute top-2 right-2 z-20 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-full bg-black/60 backdrop-blur-sm text-white hover:bg-black/80 transition-colors"
      >
        <X size={16} />
      </button>

      <div
        data-testid="just-published-media"
        className={
          isLandscape
            ? 'relative w-full sm:w-64 shrink-0 aspect-video bg-black'
            // BUG (live-verified 2026-10-02): `w-full max-h-[300px] aspect-[9/16]`
            // let the CONTAINER WIDTH drive the box, computed a ~613px-tall box
            // from that width, then max-h clamped the HEIGHT to 300px without
            // narrowing the width to match -- a squashed ~1.54:1 box, not 9:16.
            // A portrait card must be HEIGHT-driven: fix the height at the 300px
            // cap and let width:auto + aspect-ratio compute the (narrow) width.
            : 'relative h-[300px] w-auto aspect-[9/16] mx-auto bg-black'
        }
      >
        {posterState !== 'error' && (
          <img
            src={buildPosterUrl(highlight.id)}
            alt=""
            onLoad={() => setPosterState('loaded')}
            onError={() => setPosterState('error')}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${
              posterState === 'loaded' ? 'opacity-100' : 'opacity-0'
            }`}
          />
        )}
        {posterState === 'loading' && <div className="absolute inset-0 skeleton-shimmer" />}
        {posterState === 'error' && (
          <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-cyan-900 via-gray-800 to-gray-900">
            <Film size={28} className="text-cyan-300/80" />
          </div>
        )}
        <button
          type="button"
          onClick={(e) => onPlay(e, highlight)}
          title="Play"
          aria-label="Play"
          className="absolute inset-0 flex items-center justify-center group/play"
        >
          <span className="flex items-center justify-center w-14 h-14 rounded-full bg-black/60 backdrop-blur-sm group-hover/play:bg-black/80 transition-colors">
            <Play size={24} className={REEL.accent} />
          </span>
        </button>
      </div>

      <div className="flex-1 min-w-0 p-4 flex flex-col justify-center gap-2">
        <span className={`self-start text-[11px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${REEL.bgSubtle} ${REEL.accentMuted}`}>
          Just published
        </span>
        <h3 className="text-white text-base font-semibold truncate">{highlight.project_name}</h3>
        {gameLine && <div className="text-xs text-gray-400 truncate">{gameLine}</div>}

        <div className="mt-1 flex items-center gap-2 flex-wrap">
          <button
            type="button"
            onClick={(e) => onShare(e, highlight)}
            data-testid="just-published-share"
            className={`inline-flex items-center gap-1.5 px-3 min-h-[40px] rounded-lg font-semibold text-white ${REEL.bgCta} ${REEL.bgCtaHover} transition-colors`}
          >
            <Share2 size={16} /> Share
          </button>
          <button
            type="button"
            onClick={(e) => onCopyLink(e, highlight)}
            title="Copy link"
            aria-label="Copy link"
            className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            <Link2 size={16} />
          </button>
          <button
            type="button"
            onClick={(e) => onDownload(e, highlight)}
            title="Download"
            aria-label="Download"
            className="inline-flex items-center justify-center min-w-[40px] min-h-[40px] rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
          >
            <Download size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

export default JustPublishedCard;

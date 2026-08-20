import { ExternalLink } from 'lucide-react';
import { GAME } from '../config/themeColors';
import { formatMatchDateLabel } from '../utils/matchDate';

/**
 * ReferenceGameCard (T5820) — the Games-tab link-card variant for a CROSS-PROFILE
 * game reference (`game.is_reference === true`, shipped by T5800's list_games).
 *
 * A reference is a metadata-only signpost to a REAL game owned by a sibling
 * profile (EPIC decision 2: "show it but more as a link since there should only
 * be one source of truth"). The owning profile keeps the single real game; this
 * card is NOT editable here — it has NONE of GameTile's action set (no kebab, no
 * annotate / add-clips / delete / recap), NO expiry chip, and NO poster fetch (a
 * reference has no local media; per the task it uses the branded fallback rather
 * than a cross-profile poster call — avoids a per-card network hit on a hot list).
 *
 * It is deliberately a SEPARATE component from GameTile so a real game's tile
 * renders byte-identical to before (T5820 AC4) — real games never touch this path.
 *
 * The whole card is a link: clicking it fires `onOpen(game)`, which sets the
 * cross-profile navigation breadcrumb and switches to the owning profile (see
 * ProjectManager.handleOpenReference / pendingNavigation.setPendingGameReference).
 */
export function ReferenceGameCard({ game, onOpen }) {
  const profileName = game.source_profile_name;

  // Two DIFFERENT cases that must not be conflated:
  //
  //  - null/undefined => the server never resolved a name for a row it flagged
  //    is_reference. That is OUR bug (games.py resolves it in one user_db read),
  //    so surface it loudly rather than papering over it.
  //  - '' (empty)     => resolved fine; the profile is simply UNNAMED. The default
  //    profile legitimately has no name, so this is normal data, not a bug — the
  //    app already labels that profile "Default" (ManageProfilesModal). Treating
  //    it as an error logged a false alarm AND rendered "In another profile" for
  //    the single most common owner (found on real prod data, arshia 2026-08-01).
  const nameUnresolved = profileName == null;
  if (nameUnresolved) {
    console.error(
      `[ReferenceGameCard] reference game ${game.id} has no source_profile_name — ` +
      `this is a backend bug (an is_reference row must carry the resolved owning-profile ` +
      `name). Rendering the card without the owner label.`
    );
  }

  const ownerLabel = profileName || (nameUnresolved ? 'another profile' : 'Default');
  const matchDate = formatMatchDateLabel(game.game_date);

  return (
    <button
      type="button"
      data-reference-card
      data-source-profile-id={game.source_profile_id}
      onClick={() => onOpen(game)}
      title={`Open in ${ownerLabel}${profileName ? "'s" : ''} profile`}
      aria-label={`${game.name} — reference, open in ${ownerLabel} profile`}
      className={`relative group aspect-video w-full text-left rounded-lg overflow-hidden
        border border-dashed ${GAME.borderCard} bg-gray-800/60 opacity-90
        transition-all duration-150 cursor-pointer outline-none
        hover:opacity-100 hover:border-green-500/70 hover:shadow-lg hover:shadow-green-900/30
        focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900`}
    >
      {/* Interior: a subdued "link elsewhere" motif (never a poster) — visually
          distinct from a real tile so it reads as a signpost, not a playable game. */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-800/80 to-gray-900 grayscale flex items-center justify-center">
        <ExternalLink size={26} className={`${GAME.accent} opacity-70`} aria-hidden />
      </div>

      {/* Owner-profile badge (top-left): the cross-profile link affordance. */}
      <div
        className={`absolute top-1.5 left-1.5 z-20 inline-flex items-center gap-1 max-w-[calc(100%-0.75rem)]
          px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-900/85 ${GAME.accent}`}
      >
        <ExternalLink size={10} className="flex-shrink-0" aria-hidden />
        <span className="truncate">In {ownerLabel}</span>
      </div>

      {/* Bottom scrim: frozen game name + MATCH date (no clip count — a reference has no
          local clips; showing "0 clips" would be misleading). T7290 removed the owner's
          UPLOAD date, which contradicted the match-date header this card sits under; T7330
          puts the MATCH date in that slot instead, so reference cards and GameTiles don't
          disagree inside one group. Same scrim shape as GameTile. */}
      <div className="absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/95 via-black/55 to-transparent px-2 pt-6 pb-1.5">
        <h3 className="text-white text-xs sm:text-sm font-medium truncate drop-shadow" title={game.name}>
          {game.name}
        </h3>
        {/* min-h reserves the line even when empty, so a dateless reference card keeps
            the same scrim height as its GameTile neighbors in the group (reviewer, T7330). */}
        <div className="mt-0.5 min-h-4 text-xs text-gray-300 truncate">{matchDate}</div>
      </div>
    </button>
  );
}

// T5215 — the SHARED attachment picker: a horizontal carousel the user browses
// through, showing every card as a real visual object (never just a name),
// newest-first, with a "No intro" choice and the profile default marked "Your
// default". ONE control, used identically by the reel kebab menu
// (DownloadsPanel/ReelTile) and the collection share dialog
// (CollectionShareModal) — per the user's 2026-08-06 direction ("the same
// carousel control inside the collection share dialog").
//
// Presentational only: props in, no store, no fetch (mirrors IntroCardPreview/
// IntroCardTile). The caller supplies `cards` (already loaded, each with a
// resolved `previewUrl`) and owns the actual PATCH/share-create gesture in
// `onSelect`.
//
// Selection model: `selectedId` is the RAW stored attachment (0 | null | id).
// There is no separate "inherit default" tile (scope D lists only cards + "No
// intro"); a NULL selection is shown by highlighting whichever card is
// CURRENTLY the default (honest "what will actually play" feedback), and
// clicking any card tile — including the current default — sends that card's
// EXPLICIT id (never re-emits null; the picker only ever calls onSelect with
// 0 or a card id).

import { useMemo } from 'react';
import { AlertTriangle, Check, Star } from 'lucide-react';
import { IntroCardPreview } from './IntroCardPreview';

const TILE_W = 110;
const TILE_H = Math.round((TILE_W * 16) / 9); // 9:16 portrait, same ratio as the library grid

/**
 * Cards newest-first (reverse chronological by created_at). Pulled out so the
 * ordering rule lives in exactly one place, not duplicated by every caller.
 */
function sortNewestFirst(cards) {
  return [...cards].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    return tb - ta;
  });
}

export function IntroCardCarousel({
  cards,
  profile,
  selectedId,
  hasConsent,
  onSelect,
  onRequestConsent,
  frozenNote,
}) {
  const sorted = useMemo(() => sortNewestFirst(cards || []), [cards]);
  const defaultCard = useMemo(() => sorted.find((c) => c.is_default) || null, [sorted]);

  // What is EFFECTIVELY highlighted right now: an explicit id/0 wins outright;
  // NULL (inherit) highlights the current default card, or "No intro" if there
  // isn't one -- the picker always shows what will actually play.
  const effectiveId = selectedId === null ? (defaultCard ? defaultCard.id : 0) : selectedId;
  const effectiveCard = effectiveId ? sorted.find((c) => c.id === effectiveId) : null;
  const showsExposureNotice = !!effectiveCard?.image_key;

  return (
    <div className="space-y-2">
      <div
        className="flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-thin"
        role="listbox"
        aria-label="Intro card"
      >
        <NoIntroTile selected={effectiveId === 0} onSelect={() => onSelect(0)} />

        {sorted.map((card) => (
          <CardChoiceTile
            key={card.id}
            card={card}
            profile={profile}
            selected={effectiveId === card.id}
            isDefault={!!card.is_default}
            disabled={!hasConsent}
            onSelect={() => onSelect(card.id)}
          />
        ))}
      </div>

      {sorted.length === 0 && (
        <p className="text-xs text-gray-400">No intro cards yet.</p>
      )}

      {!hasConsent && (
        <p className="text-xs text-amber-400/90 leading-snug">
          Attaching a card requires parental consent for this profile.{' '}
          <button
            type="button"
            onClick={onRequestConsent}
            className="underline hover:text-amber-300"
          >
            Go to consent settings
          </button>
          . &ldquo;No intro&rdquo; is always available.
        </p>
      )}

      {showsExposureNotice && (
        <p className="flex items-start gap-1.5 text-xs text-amber-400/90 leading-snug">
          <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
          This card includes a photo — it will be publicly visible to anyone
          with this {frozenNote ? 'link' : "reel's link"}.
        </p>
      )}

      {frozenNote && (
        <p className="text-xs text-gray-400 leading-snug">{frozenNote}</p>
      )}
    </div>
  );
}

function NoIntroTile({ selected, onSelect }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label="No intro"
      onClick={onSelect}
      className={`relative flex-shrink-0 snap-start flex flex-col items-center justify-center gap-1 rounded-lg border-2 coarse-pointer:min-h-[44px] transition-colors ${
        selected
          ? 'border-blue-500 bg-blue-500/10 text-white'
          : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
      }`}
      style={{ width: `${TILE_W}px`, height: `${TILE_H}px` }}
    >
      {selected && (
        <span className="absolute top-1.5 right-1.5 rounded-full bg-blue-500 p-0.5">
          <Check size={10} className="text-white" />
        </span>
      )}
      <span className="text-2xl leading-none">—</span>
      <span className="text-xs font-medium">No intro</span>
    </button>
  );
}

function CardChoiceTile({ card, profile, selected, isDefault, disabled, onSelect }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={`${card.name}${isDefault ? ' (your default)' : ''}`}
      onClick={onSelect}
      disabled={disabled}
      className={`relative flex-shrink-0 snap-start rounded-lg overflow-hidden border-2 coarse-pointer:min-h-[44px] transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        disabled
          ? 'border-gray-800 opacity-40 cursor-not-allowed'
          : selected
            ? 'border-blue-500'
            : 'border-gray-700 hover:border-gray-500'
      }`}
      style={{ width: `${TILE_W}px`, height: `${TILE_H}px` }}
    >
      <IntroCardPreview card={card} profile={profile} boxWidth={TILE_W} boxHeight={TILE_H} />

      {isDefault && (
        <span
          className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] font-semibold text-yellow-300"
          title="Your default"
          aria-hidden="true"
        >
          <Star size={9} fill="currentColor" /> Your default
        </span>
      )}

      {selected && (
        <span className="absolute top-1.5 right-1.5 rounded-full bg-blue-500 p-0.5">
          <Check size={10} className="text-white" />
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 px-1.5 pt-4 pb-1 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-left">
        <h4 className="text-white text-[11px] font-medium line-clamp-1">{card.name}</h4>
      </div>
    </button>
  );
}

export default IntroCardCarousel;

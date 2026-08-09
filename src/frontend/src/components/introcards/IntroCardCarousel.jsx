// T5215 — the SHARED attachment picker: a horizontal carousel the user browses
// through, showing every card as a real visual object (never just a name),
// newest-first, with a "No intro" choice. ONE control, used identically by the
// reel kebab menu (DownloadsPanel/ReelTile), the collection share dialog
// (CollectionShareModal), and a collection's own attached-intro picker
// (CollectionsTab) — per the user's 2026-08-06 direction that this must stay
// the SAME control everywhere, not forked per host.
//
// Presentational only: props in, no store, no fetch (mirrors IntroCardPreview/
// IntroCardTile). The caller supplies `cards` (already loaded, each with a
// resolved `previewUrl`) and owns the actual PATCH/share-create gesture in
// `onSelect`.
//
// Selection model (T6680: the profile-default/inherit concept is retired —
// there is no longer a card a NULL attachment resolves to, so `NULL` and `0`
// are both "no intro" here, same as at the backend resolver):
//   explicit id  -> that card gets the SOLID "Selected" badge (shared
//                    INTRO_BADGE icon/colour, also used on the reel thumbnail)
//                    + a solid purple ring. A deliberate choice.
//   NULL/0       -> the "No intro" tile gets the "Selected" badge. NULL means
//                    "nothing has been explicitly picked yet" and 0 means
//                    "deliberately turned off" — the backend treats them
//                    identically, and the picker shows the same "No intro"
//                    selection for both (no separate inherit affordance).
// Clicking any card tile sends that card's EXPLICIT id (the picker only ever
// calls onSelect with 0 or a card id).
//
// ROUND 3 (user, 2026-08-07): "i need a bit more visual feedback... after i
// select the card it plays its animation and i still need to click 'ok'".
// A click here SELECTS (highlights) and, for a real card, PLAYS its motion
// animation as a preview -- reusing T5205's MotionPreview verbatim, no second
// animator. `onSelect` fires immediately on click as a DRAFT notification
// (unchanged interface: CollectionShareModal already treats it as local
// state, not a network write); the COMMIT-vs-cancel + OK/Escape/Enter
// mechanics live one level up in IntroCardPicker (the modal host BOTH the
// reel and collection-own-intro pickers use), which buffers the draft and
// only calls its own onSelect (the real write) on OK.

import { useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { IntroCardPreview } from './IntroCardPreview';
import { IntroExposureNotice } from './IntroExposureNotice';
import { MotionPreview } from './MotionPreview';
import { CARD_ASPECTS } from '../../utils/introCardGeometry';
import { INTRO_BADGE, INTRO_BADGE_ICON as IntroIcon } from '../../constants/introBadge';

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
  // Which card (if any) is currently PLAYING its motion preview -- a click
  // starts it, MotionPreview's own onDone (or picking something else) clears
  // it. Preview-only; the draft selection itself is `selectedId`, owned by
  // the caller (round 3: IntroCardPicker buffers it until OK).
  const [previewCardId, setPreviewCardId] = useState(null);

  // T6680: NULL ("never explicitly chosen") and 0 ("deliberately off") both
  // resolve to "no intro" -- there is no profile default left to inherit, so
  // both show the "No intro" tile as selected. Only an explicit positive id
  // is a real pick.
  const isExplicit = selectedId !== null && selectedId !== 0;
  const isNone = selectedId === null || selectedId === 0;
  const explicitCard = isExplicit ? sorted.find((c) => c.id === selectedId) : null;
  // What will actually PLAY (for the exposure notice) — the explicit card, or
  // nothing.
  const effectiveCard = isExplicit ? explicitCard : null;
  const showsExposureNotice = !!effectiveCard?.image_key;

  return (
    <div className="space-y-2">
      <div
        className="flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-thin"
        role="listbox"
        aria-label="Athlete Intro Card"
      >
        <NoIntroTile
          selected={isNone}
          onSelect={() => {
            setPreviewCardId(null);
            onSelect(0);
          }}
        />

        {sorted.map((card) => (
          <CardChoiceTile
            key={card.id}
            card={card}
            profile={profile}
            explicitlySelected={isExplicit && selectedId === card.id}
            disabled={!hasConsent}
            playing={previewCardId === card.id}
            onSelect={() => {
              setPreviewCardId(card.id);
              onSelect(card.id);
            }}
            onPreviewDone={() => setPreviewCardId(null)}
          />
        ))}
      </div>

      {sorted.length === 0 && (
        <p className="text-xs text-gray-400">No Athlete Intro Cards yet.</p>
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
        <IntroExposureNotice linkLabel={frozenNote ? 'link' : "reel's link"} />
      )}

      {frozenNote && (
        <p className="text-xs text-gray-400 leading-snug">{frozenNote}</p>
      )}
    </div>
  );
}

// Neutral (deliberately NOT the purple intro colour — nothing is attached)
// but still bold/high-contrast: a solid white pill with an icon + text, not a
// bare 10px dot, so it reads unmistakably even on reopen (round 2 fix).
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
          ? 'border-white bg-white/10 text-white'
          : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-200'
      }`}
      style={{ width: `${TILE_W}px`, height: `${TILE_H}px` }}
    >
      {selected && (
        <span className="absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white text-[10px] font-semibold text-gray-900 shadow">
          <Check size={11} strokeWidth={3} /> Selected
        </span>
      )}
      <span className="text-2xl leading-none">—</span>
      <span className="text-xs font-medium">No intro</span>
    </button>
  );
}

function CardChoiceTile({ card, profile, explicitlySelected, disabled, playing, onSelect, onPreviewDone }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={explicitlySelected}
      aria-label={card.name}
      onClick={onSelect}
      disabled={disabled}
      className={`relative flex-shrink-0 snap-start rounded-lg overflow-hidden border-2 coarse-pointer:min-h-[44px] transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400 ${
        disabled
          ? 'border-gray-800 opacity-40 cursor-not-allowed'
          : explicitlySelected
            ? `${INTRO_BADGE.border} ring-2 ${INTRO_BADGE.ring}`
            : 'border-gray-700 hover:border-gray-500'
      }`}
      style={{ width: `${TILE_W}px`, height: `${TILE_H}px` }}
    >
      <IntroCardPreview card={card} profile={profile} boxWidth={TILE_W} boxHeight={TILE_H} />

      {/* Round 3: a click SELECTS *and* PLAYS the card's own motion preview
          -- T5205's MotionPreview reused verbatim, overlaid on top of the
          static preview and self-clearing via onDone. */}
      {playing && (
        <MotionPreview
          card={card}
          profile={profile}
          aspect={CARD_ASPECTS.portrait}
          boxWidth={TILE_W}
          boxHeight={TILE_H}
          onDone={onPreviewDone}
        />
      )}

      {/* Explicit pick: the SAME solid icon+colour as the reel thumbnail badge
          (INTRO_BADGE) -- an unmistakable, deliberate-choice marker. */}
      {explicitlySelected && (
        <span className={`absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${INTRO_BADGE.bgSolid} text-[10px] font-semibold text-white shadow`}>
          <IntroIcon size={11} fill="currentColor" /> Selected
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 px-1.5 pt-4 pb-1 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-left">
        <h4 className="text-white text-[11px] font-medium line-clamp-1">{card.name}</h4>
      </div>
    </button>
  );
}

export default IntroCardCarousel;

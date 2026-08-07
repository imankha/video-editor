// T5215 — the SHARED attachment picker: a horizontal carousel the user browses
// through, showing every card as a real visual object (never just a name),
// newest-first, with a "No intro" choice and the profile default marked "Your
// default". ONE control, used identically by the reel kebab menu
// (DownloadsPanel/ReelTile), the collection share dialog (CollectionShareModal),
// and a collection's own attached-intro picker (CollectionsTab) — per the
// user's 2026-08-06 direction that this must stay the SAME control everywhere,
// not forked per host.
//
// Presentational only: props in, no store, no fetch (mirrors IntroCardPreview/
// IntroCardTile). The caller supplies `cards` (already loaded, each with a
// resolved `previewUrl`) and owns the actual PATCH/share-create gesture in
// `onSelect`.
//
// Selection model: `selectedId` is the RAW stored attachment (0 | null | id).
// There is no separate "inherit default" TILE (scope D lists only cards + "No
// intro") — but round 2 (user, 2026-08-06) requires the three underlying
// states to be UNMISTAKABLE and visually DISTINCT on reopen, not collapsed
// into one look:
//   explicit id  -> that card gets the SOLID "Selected" badge (shared
//                    INTRO_BADGE icon/colour, also used on the reel thumbnail)
//                    + a solid purple ring. A deliberate choice.
//   NULL/inherit -> the CURRENT default card (if any) gets an OUTLINED/lighter
//                    "Following default" badge — same icon+colour family, but
//                    visually softer than "Selected" (nothing was explicitly
//                    chosen for THIS reel) — plus a caption line under the
//                    strip. No card shows "Selected".
//   0/no intro   -> the "No intro" tile gets its OWN neutral (non-purple)
//                    "Selected" badge — deliberately NOT the intro colour,
//                    since no intro is attached.
// Clicking any card tile — including the current default — sends that card's
// EXPLICIT id (never re-emits null; the picker only ever calls onSelect with
// 0 or a card id).
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
import { AlertTriangle, Check, Star } from 'lucide-react';
import { IntroCardPreview } from './IntroCardPreview';
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
  const defaultCard = useMemo(() => sorted.find((c) => c.is_default) || null, [sorted]);
  // Which card (if any) is currently PLAYING its motion preview -- a click
  // starts it, MotionPreview's own onDone (or picking something else) clears
  // it. Preview-only; the draft selection itself is `selectedId`, owned by
  // the caller (round 3: IntroCardPicker buffers it until OK).
  const [previewCardId, setPreviewCardId] = useState(null);

  // Three DISTINCT states (round 2, user 2026-08-06 — collapsing these into
  // one look is the presentation bug this rewrite fixes):
  const isExplicit = selectedId !== null && selectedId !== 0;
  const isNone = selectedId === 0;
  const isInherit = selectedId === null;
  // Round 5 (user, 2026-08-07): "when I first try to attach an intro card to
  // a card that doesn't have one, ... 'no intro' should [read as] selected."
  // The RAW value stays null (never rewritten here -- that would corrupt the
  // inherit-vs-explicit-none distinction resolve_intro_card_id's pinned
  // matrix relies on); this only changes which tile shows the "Selected"
  // PRESENTATION when inheriting resolves to nothing anyway -- i.e. there is
  // no profile default to inherit, so "follow the default" and "no intro"
  // are behaviourally identical right now. When a default DOES exist, the
  // inherit state keeps its own distinct "Following" look (unchanged).
  const isInheritWithNothingToInherit = isInherit && !defaultCard;
  const explicitCard = isExplicit ? sorted.find((c) => c.id === selectedId) : null;
  // What will actually PLAY (for the exposure notice) — explicit card, or the
  // default when inheriting and one exists.
  const effectiveCard = isExplicit ? explicitCard : (isInherit ? defaultCard : null);
  const showsExposureNotice = !!effectiveCard?.image_key;

  return (
    <div className="space-y-2">
      <div
        className="flex gap-2.5 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-thin"
        role="listbox"
        aria-label="Intro card"
      >
        <NoIntroTile
          selected={isNone || isInheritWithNothingToInherit}
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
            inherited={isInherit && !!card.is_default && card.id === defaultCard?.id}
            isDefault={!!card.is_default}
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
        <p className="text-xs text-gray-400">No intro cards yet.</p>
      )}

      {isInherit && (
        <p className="text-xs text-gray-400 leading-snug">
          {defaultCard
            ? <>Following your default (<span className="text-gray-300">{defaultCard.name}</span>) — nothing was explicitly picked for this reel.</>
            : 'No profile default is set, so no intro plays here yet.'}
        </p>
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

function CardChoiceTile({ card, profile, explicitlySelected, inherited, isDefault, disabled, playing, onSelect, onPreviewDone }) {
  const ariaSuffix = isDefault ? ' (your default)' : '';
  return (
    <button
      type="button"
      role="option"
      aria-selected={explicitlySelected}
      aria-label={`${card.name}${ariaSuffix}`}
      onClick={onSelect}
      disabled={disabled}
      className={`relative flex-shrink-0 snap-start rounded-lg overflow-hidden border-2 coarse-pointer:min-h-[44px] transition-colors focus:outline-none focus:ring-2 focus:ring-purple-400 ${
        disabled
          ? 'border-gray-800 opacity-40 cursor-not-allowed'
          : explicitlySelected
            ? `${INTRO_BADGE.border} ring-2 ${INTRO_BADGE.ring}`
            : inherited
              ? INTRO_BADGE.borderSoft
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

      {isDefault && (
        <span
          className="absolute top-1.5 left-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm text-[10px] font-semibold text-yellow-300"
          title="Your default"
          aria-hidden="true"
        >
          <Star size={9} fill="currentColor" /> Your default
        </span>
      )}

      {/* Explicit pick: the SAME solid icon+colour as the reel thumbnail badge
          (INTRO_BADGE) -- an unmistakable, deliberate-choice marker. */}
      {explicitlySelected && (
        <span className={`absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${INTRO_BADGE.bgSolid} text-[10px] font-semibold text-white shadow`}>
          <IntroIcon size={11} fill="currentColor" /> Selected
        </span>
      )}
      {/* Inherited (this is the default, reel is on NULL/inherit): same family,
          visually SOFTER -- an outline pill, never confused with an explicit pick. */}
      {inherited && !explicitlySelected && (
        <span className={`absolute top-1.5 right-1.5 inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/60 backdrop-blur-sm border ${INTRO_BADGE.borderSofter} text-[10px] font-semibold ${INTRO_BADGE.text}`}>
          <IntroIcon size={10} /> Following
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 px-1.5 pt-4 pb-1 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-left">
        <h4 className="text-white text-[11px] font-medium line-clamp-1">{card.name}</h4>
      </div>
    </button>
  );
}

export default IntroCardCarousel;

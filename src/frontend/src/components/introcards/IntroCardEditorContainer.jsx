// T5205 — the card editor CONTAINER (MVC: logic + gesture handlers). Reads the
// card from the store (single source of truth — never mirrors API data in
// useState) and drives the presentational Stage + Rail views. Every persisted
// edit is a named gesture -> a SURGICAL PATCH of ONLY the changed field via the
// store (no reactive useEffect writes).
//
// Transient interaction state that legitimately lives in React: the aspect
// toggle, the in-progress photo drag / zoom slider (which commit ONCE on
// release), and the title-text draft (commits on blur). None of these hold
// canonical API data.
//
// T6640: per-slot text STYLING is gone (decision 12 — typography is template-
// owned), so the selected-slot state + the debounced text_elements write it
// drove are gone too; there is nothing left to select a slot FOR.

import { useState, useCallback } from 'react';
import { ArrowLeft, Star, Pencil } from 'lucide-react';
import { useIntroCardStore, useProfileStore } from '../../stores';
import { RATIO } from '../../constants/aspectRatios';
import { IntroCardStage } from './IntroCardStage';
import { IntroCardRail } from './IntroCardRail';
import { ConsentGate } from './ConsentGate';
import { FACT_SLOTS } from './introCardEditorConstants';

export function IntroCardEditorContainer({ card, profile, onBack, onEditProfile, onSetDefault }) {
  const updateCard = useIntroCardStore((s) => s.updateCard);
  const patchCardLocal = useIntroCardStore((s) => s.patchCardLocal);
  const fetchCards = useIntroCardStore((s) => s.fetchCards);
  const setIntroConsent = useProfileStore((s) => s.setIntroConsent);

  const [aspectRatio, setAspectRatio] = useState(RATIO.PORTRAIT);
  const [error, setError] = useState(null);

  // Transient drag/zoom overrides (null = show the persisted value). Committed
  // once on release, never per pointer-move.
  const [dragFocal, setDragFocal] = useState(null);
  const [zoomDraft, setZoomDraft] = useState(null);

  const hasConsent = !!profile?.introConsentAt;

  // A gesture: apply the change to the store optimistically (instant preview),
  // then persist ONLY that field. `localFields` lets a caller carry a UI-only
  // extra (e.g. a fresh previewUrl) into the optimistic row without sending it
  // to the API. On a failed persist, reconcile from the server.
  const patch = useCallback(async (fields, localFields = null) => {
    setError(null);
    patchCardLocal(card.id, { ...fields, ...(localFields || {}) });
    try {
      const updated = await updateCard(card.id, fields);
      if (!updated) {
        setError('Could not save the change. Please try again.');
        fetchCards({ force: true });
      }
    } catch (e) {
      setError(e.message || 'Could not save the change.');
      fetchCards({ force: true });
    }
  }, [updateCard, patchCardLocal, fetchCards, card.id]);

  // --- Facts (composition axis) ------------------------------------------
  // shown_fields is ORDINAL: fact{N} geometry is the Nth entry, so the array
  // ORDER decides which line each fact lands on (preview AND export). It must be
  // the canonical FACT_SLOTS order, NOT click order — otherwise ticking the same
  // facts in a different sequence lays them out differently (T6580: "the card
  // looks different depending on the order I click the on-the-card buttons").
  // Rebuild from FACT_SLOTS every toggle so the order is stable regardless of
  // click sequence and any legacy click-ordered array is corrected on the next
  // gesture. Styling is keyed semantically (by field), so reordering never moves
  // a slot's styling.
  const toggleFact = useCallback((slot) => {
    const shown = new Set(card.shown_fields || []);
    if (shown.has(slot)) shown.delete(slot);
    else shown.add(slot);
    const next = FACT_SLOTS.filter((f) => shown.has(f));
    patch({ shown_fields: next });
  }, [card.shown_fields, patch]);

  // --- Treatment (independent look axis) ---------------------------------
  const setTreatment = useCallback((treatment) => {
    patch({ treatment });
  }, [patch]);

  // --- Card name (library label) -----------------------------------------
  const commitName = useCallback((value) => {
    const trimmed = value.trim();
    // Name is required (backend rejects empty); ignore a blank rename.
    if (!trimmed || trimmed === (card.name || '')) return;
    patch({ name: trimmed });
  }, [card.name, patch]);

  // --- Subtitle (the ONE free-text field, a property of THIS card, T6570) -
  const commitSubtitle = useCallback((value) => {
    const trimmed = value.trim();
    if (trimmed === (card.subtitle_text || '')) return;
    patch({ subtitle_text: trimmed });
  }, [card.subtitle_text, patch]);

  // --- Photo framing (focal + zoom) --------------------------------------
  const onPhotoDragMove = useCallback((focal) => setDragFocal(focal), []);
  const onPhotoDragEnd = useCallback((focal) => {
    setDragFocal(null);
    // One gesture (a completed drag) -> one PATCH of the two changed fields.
    patch({ focal_x: focal.x, focal_y: focal.y });
  }, [patch]);

  const onZoomInput = useCallback((z) => setZoomDraft(z), []);
  const onZoomRelease = useCallback((z) => {
    setZoomDraft(null);
    patch({ zoom: z });
  }, [patch]);

  // --- Photo add / replace / remove --------------------------------------
  // key === null removes the photo (-> title-only composition). `previewUrl` is
  // a UI-only optimism (the upload/profile already has it) so the thumbnail
  // updates before the server round-trips a freshly presigned URL.
  const onImageChanged = useCallback((key, previewUrl = null) => {
    patch({ image_key: key }, { previewUrl: key ? previewUrl : null });
  }, [patch]);

  // Consent gate blocks card editing until parental consent is recorded.
  if (!hasConsent) {
    return (
      <ConsentGate
        onBack={onBack}
        onConsent={async () => {
          try {
            await setIntroConsent(profile.id);
          } catch (e) {
            setError(e.message || 'Could not record consent.');
          }
        }}
        error={error}
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div data-testid="card-breadcrumb" className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 text-sm text-gray-300 hover:text-white flex-shrink-0"
        >
          <ArrowLeft size={16} /> Cards
        </button>
        <span className="text-gray-600 flex-shrink-0">/</span>
        <CardNameInput value={card.name || ''} onCommit={commitName} />

        {/* Default status — DERIVED from card.is_default, never a stored name
            (T6640 round 2: a stored "Default" label would drift the moment
            another card is promoted or this one is renamed). A badge when
            this IS the default; a promote action when it isn't — never both,
            so there is always exactly one thing to look at here. */}
        {card.is_default ? (
          <span
            className="flex-shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-full bg-yellow-400/10 text-[11px] font-semibold text-yellow-300"
            title="This is the default intro card"
          >
            <Star size={11} fill="currentColor" /> Default
          </span>
        ) : (
          <button
            type="button"
            onClick={onSetDefault}
            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium text-gray-300 border border-gray-600 hover:border-yellow-400 hover:text-yellow-300 coarse-pointer:min-h-[32px]"
            title="Plays before any reel that hasn't been given a specific card"
          >
            <Star size={11} /> Set as default
          </button>
        )}
      </div>

      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

      {/* Stage grows to fill; the rail is a fixed-width, independently-scrolling
          props column on desktop and stacks below on mobile (single modal scroll
          there — no competing rail scrollbar). */}
      <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 lg:flex-1 lg:min-h-0">
        <IntroCardStage
          card={card}
          profile={profile}
          aspectRatio={aspectRatio}
          onAspectRatioChange={setAspectRatio}
          dragFocal={dragFocal}
          zoomDraft={zoomDraft}
          onPhotoDragMove={onPhotoDragMove}
          onPhotoDragEnd={onPhotoDragEnd}
        />
        <IntroCardRail
          card={card}
          profile={profile}
          onToggleFact={toggleFact}
          onSetTreatment={setTreatment}
          onCommitSubtitle={commitSubtitle}
          onImageChanged={onImageChanged}
          onEditProfile={onEditProfile}
          onError={setError}
          zoomDraft={zoomDraft}
          onZoomInput={onZoomInput}
          onZoomRelease={onZoomRelease}
        />
      </div>
    </div>
  );
}

/**
 * The card's library label (card.name), editable right where it's shown (T6640
 * round 2: "I need a way to rename the card" — the breadcrumb is the one place
 * the name already appears, so it's the thing the user edits, not a field
 * buried in the rail). Draft + commit-on-blur/Enter, same discipline as the
 * title/fact inputs: typing never hits the API. A blank/whitespace-only commit
 * is REJECTED (not saved) and the input snaps back to the last real name —
 * names aren't required to be unique, but an empty one would make the
 * breadcrumb unreadable, so "restore" (not "allow empty") is the choice here.
 *
 * The border is visible AT REST (not hover-only, T6300: an editable field's
 * affordance must be discoverable without hovering it first) plus a small
 * pencil, since inline text next to plain nav breadcrumbs ("Cards /") would
 * otherwise read as another static label.
 */
function CardNameInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [lastValue, setLastValue] = useState(value);

  if (value !== lastValue && !dirty) {
    setLastValue(value);
    setDraft(value);
  }

  const commit = () => {
    if (!dirty) return;
    setDirty(false);
    const trimmed = draft.trim();
    if (!trimmed) {
      // Reject empty/whitespace-only: restore the last real name rather than
      // persist a blank breadcrumb.
      setDraft(lastValue);
      return;
    }
    setLastValue(trimmed);
    setDraft(trimmed);
    onCommit(trimmed);
  };

  return (
    <label className="flex items-center gap-1 min-w-0 flex-1 group">
      <input
        type="text"
        aria-label="Card name"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="min-w-0 flex-1 bg-transparent text-sm font-medium text-white border-b border-gray-600 hover:border-gray-400 focus:border-blue-500 focus:outline-none"
      />
      <Pencil size={12} className="flex-shrink-0 text-gray-500 group-hover:text-gray-300" />
    </label>
  );
}

export default IntroCardEditorContainer;

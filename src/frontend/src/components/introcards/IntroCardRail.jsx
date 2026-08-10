// T5205 / T6540 / T6640 — the editor RIGHT RAIL (presentational + small local
// input drafts). Information design (T6540): the rail is organised into tiers a
// first-time user can scan without reading every label —
//   CONTENT ("On the card"): which facts show (the composition axis), captioned
//     so ticking a fact reads as cause -> effect (WITHOUT naming a layout; T6570
//     — the user does not want the layout named).
//   PHOTO: the photo as ONE object — thumbnail, replace/remove, AND zoom together
//     (drag stays on the stage; the indirect controls live here, not split off).
//   STYLE: the treatment (gold/dark/photo-forward) — the ONE visual choice left.
//
// T6640 (epic decision 12) removed the per-slot text STYLING editor (font,
// custom colour picker, swatches, shadow, stroke) from this rail entirely —
// typography is now TEMPLATE-owned, derived from the treatment in the shared
// contract, so there is nothing left for a per-slot styling control to edit.
// The subtitle keeps its own free-text input (content, not styling). This does
// NOT touch the shared `TextSpecEditor` component (owned by T6630 while in
// flight) — the Overlay text rail still uses it with full font/colour/shadow/
// stroke control; only the IMPORT here is removed.

import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { useProfileStore } from '../../stores';
import { FACT_SLOTS, SLOT_META, TREATMENTS } from './introCardEditorConstants';
import { treatmentAccent, treatmentBackgroundCss, treatmentBand } from './introCardVisual';
import { slotDisplayText, resolveFraming } from './IntroCardPreview';

export function IntroCardRail({
  card,
  profile,
  onToggleFact,
  onSetTreatment,
  onCommitSubtitle,
  onImageChanged,
  onEditProfile,
  onError,
  zoomDraft,
  onZoomInput,
  onZoomRelease,
}) {
  const shown = card.shown_fields || [];

  return (
    <div className="w-full lg:w-[360px] lg:shrink-0 lg:min-h-0 lg:overflow-y-auto space-y-3 lg:pr-1">
      {/* CONTENT tier — the primary decision, and the ONLY signpost that ticking
          a fact re-lays-out the card (the epic has no template picker). */}
      <section>
        <SectionHeading>On the card</SectionHeading>
        <p className="text-xs text-gray-400 leading-snug mb-1.5">
          The layout adapts to the facts you show.
        </p>
        <div className="space-y-0.5">
          {FACT_SLOTS.map((slot) => {
            const meta = SLOT_META[slot];
            const isShown = shown.includes(slot);
            const value = slotDisplayText(slot, card, profile);
            return (
              <div key={slot}>
                <label className="flex items-center gap-2.5 cursor-pointer py-1 coarse-pointer:min-h-[44px] rounded hover:bg-gray-800/60 px-1 -mx-1">
                  <input
                    type="checkbox"
                    checked={isShown}
                    onChange={() => onToggleFact(slot)}
                    className="w-4 h-4 accent-blue-500 cursor-pointer flex-shrink-0"
                  />
                  <span className="text-sm text-gray-200 flex-shrink-0">{meta.label}</span>
                  {value && <span className="text-xs text-gray-400 truncate">— {value}</span>}
                </label>
                {isShown && !value && (
                  <p className="ml-8 mb-1 text-xs text-amber-400/90">
                    No {meta.label.toLowerCase()} on this profile yet.{' '}
                    <button
                      type="button"
                      onClick={onEditProfile}
                      className="underline hover:text-amber-300"
                    >
                      Add it
                    </button>
                    .
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Subtitle — the ONE free-text field (T6570), a property of THIS card
          (e.g. a tournament name), unlike the title (the athlete's Full Name,
          from the profile). CONTENT, not styling — the user always keeps it. */}
      <section>
        <SectionHeading>Subtitle</SectionHeading>
        <SubtitleInput value={card.subtitle_text || ''} onCommit={onCommitSubtitle} />
      </section>

      {/* PHOTO — one object: thumbnail + replace/remove + zoom, all together. */}
      <section>
        <SectionHeading>Photo</SectionHeading>
        <PhotoControls
          card={card}
          profile={profile}
          onImageChanged={onImageChanged}
          onError={onError}
          zoomDraft={zoomDraft}
          onZoomInput={onZoomInput}
          onZoomRelease={onZoomRelease}
        />
      </section>

      {/* STYLE tier — the ONE visual choice left (T6640/decision 12): the
          treatment. Font, colour, size, weight, shadow, stroke and spacing are
          TEMPLATE-owned from here — no control on this rail can produce a
          colour or font clash. */}
      <section>
        <SectionHeading>Style</SectionHeading>
        {/* Treatment — independent of composition (decision 2b). No mini-label:
            each swatch is captioned (Gold / Dark / Photo forward), so a group
            label just added a row of scroll for no information. */}
        <div className="flex gap-2" role="group" aria-label="Treatment">
          {TREATMENTS.map((t) => {
            const active = card.treatment === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => onSetTreatment(t.key)}
                className={`flex-1 flex flex-col items-center gap-1 p-2 rounded border transition-colors coarse-pointer:min-h-[44px] ${
                  active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                {/* A mini card: backdrop + the treatment's lower-third BAND
                    (T6580 item 4 — what actually grounds the text and makes
                    the three visibly differ) with the accent bar on it.
                    Photo-forward has no band, so its accent sits on the plain
                    backdrop. */}
                <span
                  className="relative w-full h-8 rounded flex items-end justify-center overflow-hidden"
                  style={{ background: treatmentBackgroundCss(t.key) }}
                >
                  {treatmentBand(t.key) && (
                    <span
                      className="absolute inset-x-0 bottom-0 h-1/2"
                      style={{ background: treatmentBand(t.key).color, opacity: treatmentBand(t.key).opacity }}
                    />
                  )}
                  <span
                    className="relative block w-3/5 h-1.5 rounded-sm mb-1"
                    style={{ background: treatmentAccent(t.key) }}
                  />
                </span>
                <span className="text-xs text-gray-200">{t.label}</span>
              </button>
            );
          })}
        </div>
      </section>

      <p className="text-xs text-amber-400/90 leading-snug border-t border-gray-700 pt-3">
        Anyone with the share link can see this card.
      </p>
    </div>
  );
}

/** Primary rail heading (white, semibold) — the top of the hierarchy. */
function SectionHeading({ children }) {
  return <h3 className="text-sm font-semibold text-white mb-1.5">{children}</h3>;
}

/**
 * The card's SUBTITLE — the ONE free-text field (T6570). A property of THIS card
 * (a tournament name / sub-heading), unlike the title (the athlete's Full Name,
 * from the profile). Typing never hits the API; commits on blur/Enter and only
 * when changed. An empty value is a real state (the renderer omits the line), so
 * it is committed too. Draft re-syncs when the persisted value moves under an
 * untouched input (mirrors CardNameInput / IntroFactInput).
 */
function SubtitleInput({ value, onCommit }) {
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
    setLastValue(draft);
    onCommit(draft);
  };

  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-gray-400">Subtitle (this card)</span>
      <input
        type="text"
        value={draft}
        placeholder="e.g. State Cup 2027"
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white placeholder-gray-500"
      />
    </label>
  );
}

function PhotoControls({ card, profile, onImageChanged, onError, zoomDraft, onZoomInput, onZoomRelease }) {
  const uploadIntroImage = useProfileStore((s) => s.uploadIntroImage);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const hasPhoto = !!card.image_key;
  const profileKey = profile?.introPhotoKey;

  // A dead key (the R2 object was deleted, or a re-upload minted a new key this
  // card never learned) must surface as a visible "photo missing" state, never a
  // silently-broken <img> (T6650). Tracked per previewUrl so a fresh photo
  // clears the broken flag. The recovery ("Use profile photo") is offered IN
  // PLACE — a broken card should refresh without Remove first.
  const [broken, setBroken] = useState(false);
  const [lastUrl, setLastUrl] = useState(card.previewUrl);
  if (card.previewUrl !== lastUrl) {
    setLastUrl(card.previewUrl);
    setBroken(false);
  }
  const photoMissing = hasPhoto && broken;
  // Live zoom while the slider is dragged; the persisted value otherwise. Commits
  // once on release (the container patches card.zoom), never per input event.
  const zoom = zoomDraft != null ? zoomDraft : resolveFraming(card, profile).zoom;

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setUploading(true);
    onError(null);
    try {
      // T5190's endpoint owns the R2 object (per-profile prefix) and returns a
      // key; the card then points its image_key at it.
      const result = await uploadIntroImage(profile.id, file);
      onImageChanged(result.key, result.previewUrl);
    } catch (err) {
      onError(err.message || 'Could not upload the photo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      {hasPhoto && (
        <div className="flex items-center gap-3">
          {photoMissing ? (
            <div
              data-testid="card-photo-missing"
              className="w-16 h-16 rounded border border-amber-500/60 bg-gray-900 flex-shrink-0 flex items-center justify-center text-center px-1 text-[10px] leading-tight text-amber-400"
            >
              Photo missing
            </div>
          ) : (
            <img
              src={card.previewUrl}
              alt="Card"
              onError={() => {
                console.warn('[IntroCard] card photo failed to load (missing R2 object?)', card.image_key);
                setBroken(true);
              }}
              className="w-16 h-16 rounded object-cover border border-gray-600 bg-gray-900 flex-shrink-0"
            />
          )}
          <button
            type="button"
            onClick={() => onImageChanged(null)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 coarse-pointer:min-h-[44px]"
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>
      )}

      {photoMissing && (
        <p className="text-xs text-amber-400/90 leading-snug">
          This card&apos;s photo is no longer available. Re-upload it, or refresh it from the profile photo.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-sm text-white disabled:opacity-60 coarse-pointer:min-h-[44px]"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
          {uploading ? 'Uploading...' : hasPhoto ? 'Replace' : 'Upload photo'}
        </button>
        {/* Recovery offered when there is no photo OR the current one is broken
            (T6650 un-gated it from `!hasPhoto` so a broken card refreshes in
            place without Remove first). Re-snapshots the CURRENT profile key. */}
        {(!hasPhoto || photoMissing) && profileKey && (
          <button
            type="button"
            onClick={() => onImageChanged(profileKey, profile?.introPhotoUrl || null)}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-sm text-gray-200 coarse-pointer:min-h-[44px]"
          >
            Use profile photo
          </button>
        )}
      </div>

      {/* Zoom — the photo's indirect reframe control, kept WITH replace/remove
          (the drag itself stays on the stage). Commits on release. */}
      {hasPhoto && (
        <label className="flex items-center gap-2.5 text-xs text-gray-400 pt-1">
          <span className="uppercase tracking-wide">Zoom</span>
          <input
            type="range"
            aria-label="Zoom"
            min={1}
            max={4}
            step={0.05}
            value={zoom}
            onChange={(e) => onZoomInput(parseFloat(e.target.value))}
            onPointerUp={(e) => onZoomRelease(parseFloat(e.currentTarget.value))}
            onBlur={(e) => onZoomRelease(parseFloat(e.currentTarget.value))}
            className="flex-1"
          />
        </label>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFilePick}
        data-testid="card-image-input"
        className="hidden"
      />
    </div>
  );
}

export default IntroCardRail;

// T5205 / T6540 — the editor RIGHT RAIL (presentational + small local input
// drafts). Information design (T6540): the rail is organised into two tiers a
// first-time user can scan without reading every label —
//   CONTENT ("On the card"): which facts show (the composition axis), captioned
//     with the live layout name so ticking a fact reads as cause -> effect.
//   PHOTO: the photo as ONE object — thumbnail, replace/remove, AND zoom together
//     (drag stays on the stage; the indirect controls live here, not split off).
//   STYLE: the look — treatment + the selected slot's typography, grouped in one
//     panel so it reads as secondary to the content decision above.
// White section headings vs grey mini-labels give the hierarchy; expert dials
// (shadow/stroke) sit behind the shared editor's collapsed "Effects" disclosure.
// Styling edits go through the SHARED TextSpecEditor (T5225) — one editor.

import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { TextSpecEditor } from '../textspec/TextSpecEditor';
import { useProfileStore } from '../../stores';
import {
  FACT_SLOTS,
  SLOT_META,
  TITLE_SLOT,
  TREATMENTS,
  COLOR_SWATCHES,
} from './introCardEditorConstants';
import { treatmentAccent, treatmentBackgroundCss } from './introCardVisual';
import { slotDisplayText, resolveFraming } from './IntroCardPreview';

export function IntroCardRail({
  card,
  profile,
  selectedSlot,
  onSelectSlot,
  onToggleFact,
  onSetTreatment,
  specForSlot,
  onUpdateSlotSpec,
  onImageChanged,
  onEditProfile,
  onError,
  zoomDraft,
  onZoomInput,
  onZoomRelease,
}) {
  const shown = card.shown_fields || [];
  // Slots available to style: the title, plus every shown fact.
  const slotOptions = [TITLE_SLOT, ...FACT_SLOTS.filter((f) => shown.includes(f))];
  const activeSlot = slotOptions.includes(selectedSlot) ? selectedSlot : TITLE_SLOT;
  // A single styleable slot means there is nothing to switch between: showing a
  // one-item "picker" reads as a stray button, so we drop it and label the drawer
  // for the one slot instead (recognition over recall).
  const hasSlotChoice = slotOptions.length > 1;

  return (
    <div className="w-full lg:w-[360px] lg:shrink-0 lg:min-h-0 lg:overflow-y-auto space-y-3 lg:pr-1">
      {/* CONTENT tier — the primary decision, and the ONLY signpost that ticking
          a fact re-lays-out the card (the epic has no template picker). */}
      <section>
        <SectionHeading>On the card</SectionHeading>
        <p className="text-xs text-gray-400 leading-snug mb-1.5">
          The layout adapts to the facts you show (named on the card).
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

      {/* STYLE tier — the look. Treatment + typography read as refinements,
          secondary to the content decision above; the heading alone sets them
          apart (a box or divider only added scroll height). */}
      <section>
        <SectionHeading>Style</SectionHeading>
        <div className="space-y-3">
          {/* Treatment — independent of composition (decision 2b). No mini-label:
              each swatch is captioned (Gold / Dark / Photo forward), so a group
              label just added a row of scroll for no information. */}
          <div>
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
                    {/* The swatch shows what actually DIFFERS between treatments:
                        backdrop + the treatment's accent. Backdrop alone is not it
                        (all three are near-black by design), so a backdrop-only
                        swatch read as three identical dark rectangles. */}
                    <span
                      className="w-full h-8 rounded flex items-end justify-center pb-1 overflow-hidden"
                      style={{ background: treatmentBackgroundCss(t.key) }}
                    >
                      <span
                        className="block w-3/5 h-1.5 rounded-sm"
                        style={{ background: treatmentAccent(t.key) }}
                      />
                    </span>
                    <span className="text-xs text-gray-200">{t.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected slot's text + typography. The slot picker appears only when
              there is more than one slot to choose between. */}
          <div>
            <MiniLabel>{hasSlotChoice ? 'Text' : `${SLOT_META[activeSlot].label} style`}</MiniLabel>
            {hasSlotChoice && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {slotOptions.map((slot) => {
                  const active = slot === activeSlot;
                  return (
                    <button
                      key={slot}
                      type="button"
                      aria-pressed={active}
                      onClick={() => onSelectSlot(slot)}
                      className={`px-3 py-1.5 rounded text-sm font-medium border transition-colors coarse-pointer:min-h-[44px] ${
                        active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      {SLOT_META[slot].label}
                    </button>
                  );
                })}
              </div>
            )}

            <SlotEditor
              slot={activeSlot}
              card={card}
              profile={profile}
              specForSlot={specForSlot}
              onUpdateSlotSpec={onUpdateSlotSpec}
              onEditProfile={onEditProfile}
            />
          </div>
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

/** Secondary group label (grey, uppercase) — subordinate to a SectionHeading. */
function MiniLabel({ children }) {
  return (
    <span className="block text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1.5">{children}</span>
  );
}

/**
 * Title slot -> a text input (commits card.title_text on blur). Fact slot -> the
 * profile value (read-only here; edited on the profile), or an inline prompt.
 * Both share the styling editor below.
 */
function SlotEditor({ slot, card, profile, specForSlot, onUpdateSlotSpec, onEditProfile }) {
  const meta = SLOT_META[slot];
  const spec = specForSlot(slot);
  const value = slotDisplayText(slot, card, profile);
  // T6570: the title is no longer a free-text box — it is the profile's Full
  // Name (a property of the athlete), so it reads exactly like a fact: the
  // resolved value, edited on the profile, with an inline prompt when unset.
  const isTitle = slot === TITLE_SLOT;
  const sourceLabel = isTitle ? 'Full name' : meta.label;

  return (
    <div className="space-y-3">
      {value ? (
        <div className="text-xs text-gray-400">
          {sourceLabel}: <span className="text-gray-200">{value}</span> (edit on the profile)
        </div>
      ) : (
        <p className="text-xs text-amber-400/90">
          No {sourceLabel.toLowerCase()} on this profile yet.{' '}
          <button type="button" onClick={onEditProfile} className="underline hover:text-amber-300">
            Add it
          </button>
          .
        </p>
      )}

      <TextSpecEditor
        spec={spec}
        onChange={(next) => onUpdateSlotSpec(slot, next)}
        hideText
        hideSize
        hideAlign
        hideFooterNote
        collapseEffects
        colorSwatches={COLOR_SWATCHES}
      />
    </div>
  );
}

function PhotoControls({ card, profile, onImageChanged, onError, zoomDraft, onZoomInput, onZoomRelease }) {
  const uploadIntroImage = useProfileStore((s) => s.uploadIntroImage);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const hasPhoto = !!card.image_key;
  const profileKey = profile?.introPhotoKey;
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
          <img
            src={card.previewUrl}
            alt="Card"
            className="w-16 h-16 rounded object-cover border border-gray-600 bg-gray-900 flex-shrink-0"
          />
          <button
            type="button"
            onClick={() => onImageChanged(null)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 coarse-pointer:min-h-[44px]"
          >
            <Trash2 size={14} /> Remove
          </button>
        </div>
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
        {!hasPhoto && profileKey && (
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

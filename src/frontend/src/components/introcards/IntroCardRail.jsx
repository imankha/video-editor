// T5205 — the editor RIGHT RAIL (presentational + small local input drafts).
// Sections: which facts to show (the composition axis), the visual treatment
// (independent look axis), the photo, and the selected slot's text + styling.
// Ends with the public-exposure notice. Styling edits go through the SHARED
// TextSpecEditor (T5225) — one editor, extended in place, not a second one.

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
import { slotDisplayText } from './IntroCardPreview';

export function IntroCardRail({
  card,
  profile,
  selectedSlot,
  onSelectSlot,
  onToggleFact,
  onSetTreatment,
  onCommitTitle,
  specForSlot,
  onUpdateSlotSpec,
  onImageChanged,
  onEditProfile,
  onError,
}) {
  const shown = card.shown_fields || [];
  // Slots available to style: the title, plus every shown fact.
  const slotOptions = [TITLE_SLOT, ...FACT_SLOTS.filter((f) => shown.includes(f))];
  const activeSlot = slotOptions.includes(selectedSlot) ? selectedSlot : TITLE_SLOT;

  return (
    <div className="flex-1 min-w-0 lg:max-w-sm overflow-y-auto space-y-5 pr-1">
      {/* Facts to show -> derives the composition */}
      <Section title="Show on the card">
        <div className="space-y-2">
          {FACT_SLOTS.map((slot) => {
            const meta = SLOT_META[slot];
            const isShown = shown.includes(slot);
            const value = slotDisplayText(slot, card, profile);
            return (
              <div key={slot}>
                <label className="flex items-center gap-2.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={isShown}
                    onChange={() => onToggleFact(slot)}
                    className="w-4 h-4 accent-blue-500 cursor-pointer"
                  />
                  <span className="text-sm text-gray-200">{meta.label}</span>
                  {value && <span className="text-xs text-gray-500 truncate">— {value}</span>}
                </label>
                {isShown && !value && (
                  <p className="ml-6 mt-0.5 text-xs text-amber-400/90">
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
      </Section>

      {/* Treatment — independent of composition */}
      <Section title="Treatment">
        <div className="flex gap-2" role="group" aria-label="Treatment">
          {TREATMENTS.map((t) => {
            const active = card.treatment === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => onSetTreatment(t.key)}
                className={`flex-1 flex flex-col items-center gap-1 p-2 rounded border transition-colors ${
                  active ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-700 hover:border-gray-600'
                }`}
              >
                {/* The swatch must show what actually DIFFERS between treatments.
                    Backdrop alone is not it: all three backdrops are near-black by
                    design (they sit behind a photo), so a backdrop-only swatch made
                    the three read as identical dark rectangles - the one control
                    whose whole job is "change the look" previewed no look at all.
                    Backdrop + the treatment's accent is what the card really is. */}
                <span
                  className="w-full h-8 rounded flex items-end justify-center pb-1 overflow-hidden"
                  style={{ background: treatmentBackgroundCss(t.key) }}
                >
                  <span
                    className="block w-3/5 h-1.5 rounded-sm"
                    style={{ background: treatmentAccent(t.key) }}
                  />
                </span>
                <span className="text-[11px] text-gray-300">{t.label}</span>
              </button>
            );
          })}
        </div>
      </Section>

      {/* Photo */}
      <Section title="Photo">
        <PhotoControls card={card} profile={profile} onImageChanged={onImageChanged} onError={onError} />
      </Section>

      {/* Slot text + styling */}
      <Section title="Text">
        <div className="flex flex-wrap gap-1.5 mb-3">
          {slotOptions.map((slot) => {
            const active = slot === activeSlot;
            return (
              <button
                key={slot}
                type="button"
                aria-pressed={active}
                onClick={() => onSelectSlot(slot)}
                className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
                  active ? 'bg-blue-600 border-blue-500 text-white' : 'bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {SLOT_META[slot].label}
              </button>
            );
          })}
        </div>

        <SlotEditor
          slot={activeSlot}
          card={card}
          profile={profile}
          specForSlot={specForSlot}
          onUpdateSlotSpec={onUpdateSlotSpec}
          onCommitTitle={onCommitTitle}
          onEditProfile={onEditProfile}
        />
      </Section>

      <p className="text-xs text-amber-400/90 leading-snug border-t border-gray-700 pt-3">
        Anyone with the share link can see this card.
      </p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div>
      <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">{title}</h4>
      {children}
    </div>
  );
}

/**
 * Title slot -> a text input (commits card.title_text on blur). Fact slot -> the
 * profile value (read-only here; edited on the profile), or an inline prompt.
 * Both share the styling editor below.
 */
function SlotEditor({ slot, card, profile, specForSlot, onUpdateSlotSpec, onCommitTitle, onEditProfile }) {
  const meta = SLOT_META[slot];
  const spec = specForSlot(slot);
  const value = slotDisplayText(slot, card, profile);

  return (
    <div className="space-y-3">
      {slot === TITLE_SLOT ? (
        <TitleInput value={card.title_text || ''} onCommit={onCommitTitle} />
      ) : value ? (
        <div className="text-xs text-gray-400">
          {meta.label}: <span className="text-gray-200">{value}</span> (edit on the profile)
        </div>
      ) : (
        <p className="text-xs text-amber-400/90">
          No {meta.label.toLowerCase()} on this profile yet.{' '}
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
        colorSwatches={COLOR_SWATCHES}
      />
    </div>
  );
}

/**
 * Title text draft — typing never hits the API; commits on blur/Enter, and only
 * when the value actually changed (mirrors ProfileIntroSection's IntroFactInput).
 */
function TitleInput({ value, onCommit }) {
  const [draft, setDraft] = useState(value);
  const [dirty, setDirty] = useState(false);
  const [lastValue, setLastValue] = useState(value);

  // Render-time re-sync when the persisted value moves under an untouched input.
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
      <span className="text-xs uppercase tracking-wide text-gray-400">Title text</span>
      <input
        type="text"
        value={draft}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="bg-gray-800 border border-gray-700 rounded px-2 py-1.5 text-sm text-white"
      />
    </label>
  );
}

function PhotoControls({ card, profile, onImageChanged, onError }) {
  const uploadIntroImage = useProfileStore((s) => s.uploadIntroImage);
  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const hasPhoto = !!card.image_key;
  const profileKey = profile?.introPhotoKey;

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
            className="w-16 h-16 rounded object-cover border border-gray-600 bg-gray-900"
          />
          <button
            type="button"
            onClick={() => onImageChanged(null)}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400"
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
          className="flex items-center gap-2 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded text-sm text-white disabled:opacity-60"
        >
          {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
          {uploading ? 'Uploading...' : hasPhoto ? 'Replace' : 'Upload photo'}
        </button>
        {!hasPhoto && profileKey && (
          <button
            type="button"
            onClick={() => onImageChanged(profileKey, profile?.introPhotoUrl || null)}
            className="px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded text-sm text-gray-200"
          >
            Use profile photo
          </button>
        )}
      </div>

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

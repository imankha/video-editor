import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { useProfileStore } from '../stores';

const INTRO_FACT_FIELDS = [
  { key: 'position', label: 'Position', placeholder: 'e.g. Midfielder 6-8-10' },
  { key: 'class', label: 'Class', placeholder: 'e.g. 2029' },
  { key: 'team', label: 'Team', placeholder: 'e.g. Riverside FC' },
];

/**
 * ProfileIntroSection (T5190) — the per-profile surface for a player-intro
 * card's photo, structured facts and the parental-consent attestation.
 *
 * Foundation for the Player Intro epic: the image upload proves the R2 object
 * round-trip, position/class/team (epic decision 3 reversal, 2026-08-04) are
 * the named fields the card layout is DERIVED from (epic decision 2), and the
 * consent tick is the compliance gate T5215 reads before letting a card
 * attach to a reel or collection.
 *
 * Every write here is an explicit gesture (file pick, remove click, consent
 * toggle, field blur) — no reactive persistence. The photo, facts and consent
 * all persist in user.sqlite and are derived LIVE from the profile prop
 * (store), never held in local useState as the source of truth — so a
 * reload, new session, or another device all hydrate the same values.
 */
export function ProfileIntroSection({ profile }) {
  const uploadIntroImage = useProfileStore(state => state.uploadIntroImage);
  const deleteIntroImage = useProfileStore(state => state.deleteIntroImage);
  const setIntroConsent = useProfileStore(state => state.setIntroConsent);
  const revokeIntroConsent = useProfileStore(state => state.revokeIntroConsent);
  const setIntroFact = useProfileStore(state => state.setIntroFact);

  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState(null);
  const [consentBusy, setConsentBusy] = useState(false);

  const hasConsent = !!profile.introConsentAt;
  const photoKey = profile.introPhotoKey;
  const photoUrl = profile.introPhotoUrl;

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    // Reset the input so re-picking the same file fires change again.
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      await uploadIntroImage(profile.id, file);
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!photoKey) return;
    setError(null);
    try {
      await deleteIntroImage(profile.id, photoKey);
    } catch (err) {
      setError(err.message || 'Could not remove the image');
    }
  };

  const handleConsentToggle = async (e) => {
    const next = e.target.checked;
    setError(null);
    setConsentBusy(true);
    try {
      if (next) await setIntroConsent(profile.id);
      else await revokeIntroConsent(profile.id);
    } catch (err) {
      // The write failed, so the store's introConsentAt did not change — with
      // hasConsent derived live from the store the checkbox self-corrects to the
      // server truth. Surface why so it isn't a silent no-op.
      setError(err.message || 'Could not update consent');
    } finally {
      setConsentBusy(false);
    }
  };

  return (
    <div className="p-4 border-t border-gray-700 space-y-4">
      <h3 className="text-sm font-semibold text-white">Player intro card</h3>

      {/* Image upload + preview */}
      <div>
        <label className="block text-sm font-medium text-gray-300 mb-2">Photo</label>
        {photoUrl ? (
          <div className="flex items-center gap-3">
            <img
              src={photoUrl}
              alt="Intro card"
              className="w-20 h-20 rounded-lg object-cover border border-gray-600 bg-gray-900"
            />
            <button
              type="button"
              onClick={handleRemove}
              className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-red-400 transition-colors"
            >
              <Trash2 size={14} /> Remove
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 px-3 py-2 bg-gray-700 hover:bg-gray-600 border border-gray-600 rounded-lg text-sm text-white transition-colors disabled:opacity-60"
          >
            {uploading ? <Loader2 size={16} className="animate-spin" /> : <ImagePlus size={16} />}
            {uploading ? 'Uploading...' : 'Upload photo'}
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFilePick}
          data-testid="intro-image-input"
          className="hidden"
        />
      </div>

      {/* Full Name — the card TITLE source (T6570). A property of the ATHLETE,
          not of a card, so it lives here and every card reads it. Distinct from
          the profile's short switcher label (profile.name, e.g. "Stafford").
          Same gesture-based KV save as the facts, but it is NOT a composition
          fact — it never changes which layout is derived. */}
      <IntroFactInput
        profileId={profile.id}
        field="full_name"
        label="Full Name"
        placeholder="e.g. Jordan Vega"
        value={profile.full_name}
        onCommit={setIntroFact}
        onError={setError}
      />

      {/* Structured intro facts — position/class/team. The card layout T5195/
          T5210 render is DERIVED from how many of these are set (epic
          decision 2), so each is independently editable and clearable. */}
      <div className="grid grid-cols-3 gap-3">
        {INTRO_FACT_FIELDS.map(({ key, label, placeholder }) => (
          <IntroFactInput
            key={key}
            profileId={profile.id}
            field={key}
            label={label}
            placeholder={placeholder}
            value={profile[key]}
            onCommit={setIntroFact}
            onError={setError}
          />
        ))}
      </div>

      {/* Parental-consent attestation */}
      <label className="flex items-start gap-2.5 cursor-pointer">
        <input
          type="checkbox"
          checked={hasConsent}
          disabled={consentBusy}
          onChange={handleConsentToggle}
          className="mt-0.5 w-4 h-4 flex-shrink-0 accent-purple-500 cursor-pointer"
        />
        <span className="text-xs text-gray-300 leading-relaxed">
          I am the parent or guardian, I consent to using this player&apos;s likeness, and I
          understand it becomes publicly visible to anyone I share a link with.
        </span>
      </label>

      {/* Shared failure surface for the image, fact and consent gestures. */}
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}

/**
 * One position/class/team field. Local `draft` state holds keystrokes so
 * typing never fires a request; the gesture is blur (or Enter) only, and it
 * skips the write entirely when the value didn't change. `draft` re-hydrates
 * from the store's value whenever it moves out from under an untouched
 * input (profile switch, or another device's write arriving via refetch) —
 * never while the field the user is actively editing.
 */
function IntroFactInput({ profileId, field, label, placeholder, value, onCommit, onError }) {
  const [draft, setDraft] = useState(value || '');
  const [dirty, setDirty] = useState(false);
  const [lastProfileId, setLastProfileId] = useState(profileId);

  if (profileId !== lastProfileId) {
    // Render-time re-sync on profile switch (React's documented pattern for
    // "adjusting state when a prop changes"), not a persisting effect.
    setLastProfileId(profileId);
    setDraft(value || '');
    setDirty(false);
  }

  const commit = async () => {
    if (!dirty) return;
    setDirty(false);
    const trimmed = draft.trim();
    if (trimmed === (value || '')) return;
    try {
      await onCommit(profileId, field, trimmed);
    } catch (err) {
      onError(err.message || `Could not update ${label.toLowerCase()}`);
    }
  };

  return (
    <div>
      <label className="block text-xs font-medium text-gray-400 mb-1">{label}</label>
      <input
        type="text"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => { setDraft(e.target.value); setDirty(true); }}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        className="w-full px-2 py-1.5 bg-gray-900 border border-gray-600 rounded text-xs text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
      />
    </div>
  );
}

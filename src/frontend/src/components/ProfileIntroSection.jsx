import { useRef, useState } from 'react';
import { ImagePlus, Trash2, Loader2 } from 'lucide-react';
import { useProfileStore } from '../stores';

/**
 * ProfileIntroSection (T5190) — the per-profile surface for a player-intro
 * card's photo + the parental-consent attestation.
 *
 * Foundation for the Player Intro epic: the image upload proves the R2 object
 * round-trip (T5195 will persist the returned key onto a card row), and the
 * consent tick is the compliance gate T5215 reads before letting a card attach
 * to a reel or collection.
 *
 * Every write here is an explicit gesture (file pick, remove click, consent
 * toggle) — no reactive persistence. The uploaded preview is session-only
 * because no card row exists yet to persist the key against (T5195); consent
 * DOES persist (user.sqlite) and arrives on the profile via introConsentAt.
 */
export function ProfileIntroSection({ profile }) {
  const uploadIntroImage = useProfileStore(state => state.uploadIntroImage);
  const deleteIntroImage = useProfileStore(state => state.deleteIntroImage);
  const setIntroConsent = useProfileStore(state => state.setIntroConsent);
  const revokeIntroConsent = useProfileStore(state => state.revokeIntroConsent);

  const fileInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(null); // { key, previewUrl }
  const [error, setError] = useState(null);
  const [consentBusy, setConsentBusy] = useState(false);

  const hasConsent = !!profile.introConsentAt;

  const handleFilePick = async (e) => {
    const file = e.target.files?.[0];
    // Reset the input so re-picking the same file fires change again.
    e.target.value = '';
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const result = await uploadIntroImage(profile.id, file);
      setUploaded({ key: result.key, previewUrl: result.previewUrl });
    } catch (err) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (!uploaded) return;
    setError(null);
    try {
      await deleteIntroImage(profile.id, uploaded.key);
      setUploaded(null);
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
        {uploaded ? (
          <div className="flex items-center gap-3">
            <img
              src={uploaded.previewUrl}
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

      {/* Shared failure surface for both the image and consent gestures. */}
      {error && <p className="text-red-400 text-xs">{error}</p>}
    </div>
  );
}

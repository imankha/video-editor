import { useState } from 'react';
import { useProfileStore } from '../stores';
import { useAuthStore } from '../stores/authStore';
import { ManageProfilesModal } from './ManageProfilesModal';
import { sportEmoji, sportDisplayName } from '../modes/annotate/constants/tagRegistry';

/**
 * ProfileSportButton - Header control surfacing the current profile's sport.
 *
 * A profile is a content bucket tied to a single sport. This is the discoverable
 * entry point to change the sport on the current profile, switch profiles, or add
 * a new one — it opens the profile manager directly instead of burying it in the
 * account dropdown (where users couldn't tell sport was switchable).
 *
 * The glyph identifies the ACTIVE profile (state + affordance in one). When the
 * profile has an intro photo (T5190) that photo IS the indicator — a face beats a
 * generic sport emoji for telling profiles apart — and the sport emoji is the
 * fallback when there is no photo.
 *   Mobile:  glyph only.
 *   Desktop: glyph + profile name (the user's own bucket label — never an
 *            athlete name; we don't collect those, for COPPA reasons).
 */
export function ProfileSportButton() {
  const profiles = useProfileStore(state => state.profiles);
  const currentProfileId = useProfileStore(state => state.currentProfileId);
  const isInitialized = useProfileStore(state => state.isInitialized);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);

  const [showManageModal, setShowManageModal] = useState(false);
  // The URL whose object failed to load, NOT a boolean — comparing against the
  // current URL resets the fallback on its own when the photo changes, with no
  // effect watching state. R2 is an external dependency, so a dead object falls
  // back to the sport emoji here rather than showing a broken image in the header;
  // T6650 owns surfacing the missing photo where the user can act on it.
  const [failedPhotoUrl, setFailedPhotoUrl] = useState(null);

  if (!isAuthenticated || !isInitialized) return null;

  const currentProfile = profiles.find(p => p.id === currentProfileId);
  const sport = currentProfile?.sport;
  const sportLabel = sportDisplayName(sport) || 'sport';
  const color = currentProfile?.color || '#3B82F6';
  const photoUrl = currentProfile?.introPhotoUrl;
  const showPhoto = !!photoUrl && failedPhotoUrl !== photoUrl;

  return (
    <>
      <button
        onClick={() => setShowManageModal(true)}
        title={`${sportLabel} — switch sport or profile`}
        aria-label={`${sportLabel}. Switch sport or profile.`}
        className="flex items-center gap-2 h-[38px] px-3 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        style={{ boxShadow: `inset 0 0 0 1.5px ${color}66` }}
      >
        {showPhoto ? (
          <img
            src={photoUrl}
            alt=""
            aria-hidden
            onError={() => setFailedPhotoUrl(photoUrl)}
            className="w-7 h-7 rounded-full object-cover bg-white/10"
          />
        ) : (
          <span className="text-2xl leading-none" aria-hidden>{sportEmoji(sport)}</span>
        )}
        {currentProfile?.name && (
          <span className="hidden sm:inline text-sm text-white font-medium max-w-[120px] truncate">
            {currentProfile.name}
          </span>
        )}
      </button>

      <ManageProfilesModal
        isOpen={showManageModal}
        onClose={() => setShowManageModal(false)}
      />
    </>
  );
}

export default ProfileSportButton;

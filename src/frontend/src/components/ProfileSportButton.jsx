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
 * The glyph reflects the ACTIVE sport (state + affordance in one).
 *   Mobile:  emoji only.
 *   Desktop: emoji + profile name (the user's own bucket label — never an
 *            athlete name; we don't collect those, for COPPA reasons).
 */
export function ProfileSportButton() {
  const profiles = useProfileStore(state => state.profiles);
  const currentProfileId = useProfileStore(state => state.currentProfileId);
  const isInitialized = useProfileStore(state => state.isInitialized);
  const isAuthenticated = useAuthStore(state => state.isAuthenticated);

  const [showManageModal, setShowManageModal] = useState(false);

  if (!isAuthenticated || !isInitialized) return null;

  const currentProfile = profiles.find(p => p.id === currentProfileId);
  const sport = currentProfile?.sport;
  const sportLabel = sportDisplayName(sport) || 'sport';
  const color = currentProfile?.color || '#3B82F6';

  return (
    <>
      <button
        onClick={() => setShowManageModal(true)}
        title={`${sportLabel} — switch sport or profile`}
        aria-label={`${sportLabel}. Switch sport or profile.`}
        className="flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
        style={{ boxShadow: `inset 0 0 0 1.5px ${color}66` }}
      >
        <span className="text-lg leading-none" aria-hidden>{sportEmoji(sport)}</span>
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

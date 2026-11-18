import { useCreditStore } from '../stores/creditStore';
import { useProfileStore } from '../stores/profileStore';

/**
 * T17090 + T17200: "You have N free credits" is a brand new account's welcome, so it
 * needs an ACCOUNT-level signal. Games are per-profile: a second profile on an existing
 * account has zero games too, but its credits are the account's own (shared across
 * profiles), not a gift. A new account has exactly one profile.
 */
export function isNewAccountForCreditHint({ profilesLoaded, profileCount }) {
  return profilesLoaded && profileCount === 1;
}

/** The credit balance to name in the first-run copy, or null when it must not claim free credits. */
export function useFirstRunCredits() {
  const balance = useCreditStore((s) => s.balance);
  const loaded = useCreditStore((s) => s.loaded);
  const profilesLoaded = useProfileStore((s) => s.isInitialized);
  const profileCount = useProfileStore((s) => s.profiles.length);
  return loaded && isNewAccountForCreditHint({ profilesLoaded, profileCount }) ? balance : null;
}

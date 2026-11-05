import { API_BASE } from '../config';
import { ANNOTATE, ERROR_COPY } from '../config/displayNames';
import { toast } from '../components/shared';
import { DEEP_LINK_KIND } from '../constants/deepLinkKinds';
import { useEditorStore } from '../stores/editorStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProfileStore } from '../stores/profileStore';
import apiFetch from './apiFetch';
import { getProfileId } from './sessionInit';

/**
 * T14970: a URL named a game or play this tab's profile does not have. A URL that names its
 * profile has said which object it means, so it is simply gone. An old bookmark has not: ids are
 * per-profile, so look once across the user's other profiles before calling it gone.
 *
 * Only for URL-driven opens: a tap on a stale card in the session keeps its own error.
 */

export const RECOVERY = {
  SWITCHED: 'switched',       // now on the owning profile; the caller reopens the object
  MISSING: 'missing',         // in no profile; the user is on the Games tab with a notice
  UNAVAILABLE: 'unavailable', // could not tell; the caller shows its own retryable error
};

const NOT_HERE_NOTICE = {
  [DEEP_LINK_KIND.GAME]: ANNOTATE.GAME_NOT_HERE,
  [DEEP_LINK_KIND.PROJECT]: ANNOTATE.PLAY_NOT_HERE,
};

const NOT_FOUND = 404;
const NO_RESPONSE = 0;

// A bootstrap landing after a switch would overwrite the new profile's stores with the old
// profile's data, and a cold 404 can easily beat bootstrap.
let settleBootstrap;
const bootstrapSettled = new Promise((resolve) => { settleBootstrap = resolve; });
export function markBootstrapSettled() {
  settleBootstrap();
}

/** Run the bootstrap, and settle however it ends: recovery must never wait on a dead one. */
export async function settleBootstrapAfter(work) {
  try {
    return await work();
  } finally {
    markBootstrapSettled();
  }
}

/** Tell the user a link named something that is not there, whether gone or never valid. */
export function showNotHereNotice(kind) {
  toast.info(NOT_HERE_NOTICE[kind], { dedupKey: 'deep-link-not-here' });
}

/** The landing notice editorStore queued. `unavailable` means we could not tell, so never "gone". */
export function showUrlLandingNotice(notice) {
  if (!notice) return; // Taken once already: StrictMode runs the showing effect twice.
  if (notice.unavailable) {
    toast.error(notice.kind === DEEP_LINK_KIND.GAME ? ERROR_COPY.LOAD_GAME : ERROR_COPY.OPEN_DRAFT);
    return;
  }
  showNotHereNotice(notice.kind);
}

function objectUrl(kind, id) {
  return kind === DEEP_LINK_KIND.GAME ? `${API_BASE}/api/games/${id}` : `${API_BASE}/api/projects/${id}`;
}

async function probeStatus(kind, id, profileId) {
  try {
    const response = await apiFetch(objectUrl(kind, id), { headers: { 'X-Profile-ID': profileId } });
    return response.status;
  } catch (err) {
    console.warn('[deepLinkRecovery] probe failed', { kind, id, profileId, message: err.message });
    return NO_RESPONSE;
  }
}

export async function recoverDeepLink({ kind, id, pinnedToProfile = false }) {
  await bootstrapSettled;

  // This tab's header, not the server's isCurrent: another tab can hold a different profile.
  const tabProfileId = getProfileId();
  if (!tabProfileId) return RECOVERY.UNAVAILABLE;

  let profilesToSearch = [];
  if (!pinnedToProfile) {
    await useProfileStore.getState().fetchProfiles();
    const { profiles, error } = useProfileStore.getState();
    // No list means nothing was searched, which is not the same as nothing being found.
    if (error || profiles.length === 0) return RECOVERY.UNAVAILABLE;
    profilesToSearch = profiles.filter((p) => p.id !== tabProfileId);
  }

  // The failure that brought us here may not have been a 404.
  if (await probeStatus(kind, id, tabProfileId) !== NOT_FOUND) return RECOVERY.UNAVAILABLE;

  let everyProfileAnswered = true;
  for (const { id: profileId } of profilesToSearch) {
    const status = await probeStatus(kind, id, profileId);
    if (status >= 200 && status < 300) {
      await useProfileStore.getState().switchProfile(profileId);
      return getProfileId() === profileId ? RECOVERY.SWITCHED : RECOVERY.UNAVAILABLE;
    }
    if (status !== NOT_FOUND) everyProfileAnswered = false;
  }
  if (!everyProfileAnswered) return RECOVERY.UNAVAILABLE;

  useEditorStore.getState().redirectToGamesTab();
  // Same refresh as a stale card's 404 (T8180): the landing shows the current list.
  useGamesDataStore.getState().fetchGames({ reason: 'deep-link-missing' });
  showNotHereNotice(kind);
  return RECOVERY.MISSING;
}

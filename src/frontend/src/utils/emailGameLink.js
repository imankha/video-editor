import { DEEP_LINK_KIND } from '../constants/deepLinkKinds';
import { EDITOR_MODES, useEditorStore } from '../stores/editorStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProfileStore } from '../stores/profileStore';
import { setPendingGame } from './pendingNavigation';

const GAME_LIST_WAIT_MS = 5000;
const GAME_LIST_POLL_MS = 100;

/**
 * T7670: open the game an upload-complete email names. Ids repeat across profiles, so a link
 * whose profile cannot be selected lands on Games with the notice and never opens the id in
 * the current profile (T14970). The link's profile becomes the active one, unlike an editor
 * URL, which holds its profile on the tab.
 */
export async function openEmailGameLink(gameId, profileId) {
  const land = (unavailable) => useEditorStore.getState().rejectUrlProfile({ kind: DEEP_LINK_KIND.GAME, unavailable });

  if (profileId) {
    await useProfileStore.getState().switchProfile(profileId);
    const { currentProfileId, error } = useProfileStore.getState();
    if (currentProfileId !== profileId) {
      land(!error?.includes('404'));
      return;
    }
  }

  // Keep polling until the game appears: switchProfile's Phase-3 refetch isn't awaited, so a
  // non-empty list can briefly precede the target profile's full list.
  const waitForGame = setInterval(() => {
    const game = useGamesDataStore.getState().games.find(g => g.id === gameId);
    if (!game) return;
    clearInterval(waitForGame);
    clearTimeout(giveUp);
    setPendingGame(game.id);
    useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
  }, GAME_LIST_POLL_MS);

  const giveUp = setTimeout(() => {
    clearInterval(waitForGame);
    if (useEditorStore.getState().editorMode !== EDITOR_MODES.PROJECT_MANAGER) return;
    land(useGamesDataStore.getState().games.length === 0);
  }, GAME_LIST_WAIT_MS);
}

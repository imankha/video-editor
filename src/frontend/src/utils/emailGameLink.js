import { DEEP_LINK_KIND } from '../constants/deepLinkKinds';
import { EDITOR_MODES, useEditorStore } from '../stores/editorStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProfileStore } from '../stores/profileStore';
import { setPendingGame } from './pendingNavigation';

/**
 * T7670: open the game an upload-complete email names. Ids repeat across profiles, so a link
 * whose profile cannot be selected lands on Games with the notice and never opens the id in
 * the current profile (T14970). The link's profile becomes the active one, unlike an editor
 * URL, which holds its profile on the tab.
 *
 * T15240: give up on the list's own settle, never a fixed timer -- a slow list still opens.
 * `force: true` makes the fetch (and what it resolves to) belong to the now-current profile,
 * not a stale list left by switchProfile's un-awaited Phase-3 refetch or an earlier profile.
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

  // Snapshot where the user is once the wait starts (after switchProfile's own navigation to
  // Project Manager). A Home tab change is URL-only -- it never touches editorMode.
  const where = () => `${useEditorStore.getState().editorMode}|${window.location.pathname}`;
  const startedAt = where();

  const games = await useGamesDataStore.getState().fetchGames({ force: true, reason: 'email-game-link' });

  if (where() !== startedAt) return;

  const game = games.find(g => g.id === gameId);
  if (!game) {
    land(games.length === 0);
    return;
  }
  setPendingGame(game.id);
  useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
}

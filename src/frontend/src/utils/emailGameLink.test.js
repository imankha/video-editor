import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '../stores/editorStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProfileStore } from '../stores/profileStore';
import { consumePendingGame } from './pendingNavigation';
import { openEmailGameLink } from './emailGameLink';

// T7670 + T14970 + T15240: the upload-complete email link names a game and its profile. Ids
// repeat across profiles, so the game must never open in any profile but the one the link
// names, the give-up must track the list's own settle rather than a fixed timer, and a user
// who has moved on by the time the list settles must be left alone.

const GAME = 11;
const NAMED = 'named-profile';
const CURRENT = 'current-profile';

// Captured before any test overwrites it, so the real-rejectUrlProfile test can restore it.
const realRejectUrlProfile = useEditorStore.getState().rejectUrlProfile;

describe('openEmailGameLink', () => {
  let rejectUrlProfile;
  let setEditorMode;
  let fetchGames;

  const mockFetchGames = (games) => {
    fetchGames = vi.fn(async () => {
      useGamesDataStore.setState({ games, isLoading: false });
      return games;
    });
    useGamesDataStore.setState({ fetchGames });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    consumePendingGame();
    rejectUrlProfile = vi.fn();
    setEditorMode = vi.fn();
    useEditorStore.setState({ rejectUrlProfile, setEditorMode, editorMode: 'project-manager' });
    window.history.pushState({}, '', '/home/games');
    useGamesDataStore.setState({ games: [{ id: GAME }] });
    useProfileStore.setState({
      currentProfileId: CURRENT,
      error: null,
      switchProfile: vi.fn(async id => useProfileStore.setState({ currentProfileId: id })),
    });
    mockFetchGames([{ id: GAME }]);
  });

  afterEach(() => {
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
  });

  const failSwitch = status => useProfileStore.setState({
    switchProfile: vi.fn(async () => useProfileStore.setState({ error: `Failed to switch profile: ${status}` })),
  });

  it('opens the game once the named profile is current', async () => {
    await openEmailGameLink(GAME, NAMED);
    expect(useProfileStore.getState().currentProfileId).toBe(NAMED);
    expect(fetchGames).toHaveBeenCalledWith({ force: true, reason: 'email-game-link' });
    expect(setEditorMode).toHaveBeenCalledWith('annotate');
    expect(consumePendingGame()).toMatchObject({ gameId: GAME });
    expect(rejectUrlProfile).not.toHaveBeenCalled();
  });

  it('a profile the account cannot use never opens the id in the current profile', async () => {
    failSwitch(404);
    await openEmailGameLink(GAME, 'deadbeef');
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(consumePendingGame()).toBeNull();
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: false });
  });

  it('a failed switch does not claim the profile is gone', async () => {
    failSwitch(500);
    await openEmailGameLink(GAME, NAMED);
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: true });
  });

  it('a game that is not in the settled list lands with the notice', async () => {
    mockFetchGames([{ id: GAME }]);
    await openEmailGameLink(999, NAMED);
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: false });
  });

  it('an empty settled list cannot prove the game is gone', async () => {
    mockFetchGames([]);
    await openEmailGameLink(GAME, NAMED);
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: true });
  });

  it('a stale list from the old profile never satisfies the wait (N5)', async () => {
    // The old profile's list is still sitting in the store when the switch finishes; the
    // link must decide from its OWN force-fetch, not from this stale non-empty list.
    useGamesDataStore.setState({ games: [{ id: GAME }] });
    mockFetchGames([]);
    await openEmailGameLink(GAME, NAMED);
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: true });
  });

  it('leaves the user alone if the editor mode changed while the list loaded (N3)', async () => {
    let resolveFetch;
    fetchGames = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    useGamesDataStore.setState({ fetchGames });

    const pending = openEmailGameLink(999, NAMED);
    await vi.advanceTimersByTimeAsync(0);
    useEditorStore.setState({ editorMode: 'overlay' });
    resolveFetch([]);
    await pending;

    expect(rejectUrlProfile).not.toHaveBeenCalled();
    expect(setEditorMode).not.toHaveBeenCalled();
  });

  it('leaves the user alone if they moved to another Home tab while the list loaded (N3)', async () => {
    let resolveFetch;
    fetchGames = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    useGamesDataStore.setState({ fetchGames });

    const pending = openEmailGameLink(999, NAMED);
    await vi.advanceTimersByTimeAsync(0);
    window.history.pushState({}, '', '/home/reels');
    resolveFetch([]);
    await pending;

    expect(rejectUrlProfile).not.toHaveBeenCalled();
    expect(setEditorMode).not.toHaveBeenCalled();
  });

  it('a slow list still opens the game however long it takes (N4)', async () => {
    let resolveFetch;
    fetchGames = vi.fn(() => new Promise(resolve => { resolveFetch = resolve; }));
    useGamesDataStore.setState({ fetchGames });

    const pending = openEmailGameLink(GAME, NAMED);
    await vi.advanceTimersByTimeAsync(7000);
    expect(setEditorMode).not.toHaveBeenCalled();
    resolveFetch([{ id: GAME }]);
    await pending;

    expect(setEditorMode).toHaveBeenCalledWith('annotate');
    expect(consumePendingGame()).toMatchObject({ gameId: GAME });
    expect(rejectUrlProfile).not.toHaveBeenCalled();
  });

  it('drives the real rejectUrlProfile, landing on Games with the notice', async () => {
    useEditorStore.setState({ rejectUrlProfile: realRejectUrlProfile });
    mockFetchGames([]);

    await openEmailGameLink(GAME, NAMED);

    expect(useEditorStore.getState().urlLandingNotice).toEqual({ kind: 'game', unavailable: true });
    expect(window.location.pathname).toBe('/home/games');
    expect(setEditorMode).not.toHaveBeenCalled();
  });
});

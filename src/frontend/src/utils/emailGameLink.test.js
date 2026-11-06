import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '../stores/editorStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProfileStore } from '../stores/profileStore';
import { consumePendingGame } from './pendingNavigation';
import { openEmailGameLink } from './emailGameLink';

// T7670 + T14970: the upload-complete email link names a game and its profile. Ids repeat
// across profiles, so the game must never open in any profile but the one the link names.

const GAME = 11;
const NAMED = 'named-profile';
const CURRENT = 'current-profile';

describe('openEmailGameLink', () => {
  let rejectUrlProfile;
  let setEditorMode;

  beforeEach(() => {
    vi.useFakeTimers();
    consumePendingGame();
    rejectUrlProfile = vi.fn();
    setEditorMode = vi.fn();
    useEditorStore.setState({ rejectUrlProfile, setEditorMode, editorMode: 'project-manager' });
    useGamesDataStore.setState({ games: [{ id: GAME }] });
    useProfileStore.setState({
      currentProfileId: CURRENT,
      error: null,
      switchProfile: vi.fn(async id => useProfileStore.setState({ currentProfileId: id })),
    });
  });

  afterEach(() => vi.useRealTimers());

  const failSwitch = status => useProfileStore.setState({
    switchProfile: vi.fn(async () => useProfileStore.setState({ error: `Failed to switch profile: ${status}` })),
  });

  it('opens the game once the named profile is current', async () => {
    await openEmailGameLink(GAME, NAMED);
    await vi.advanceTimersByTimeAsync(200);
    expect(useProfileStore.getState().currentProfileId).toBe(NAMED);
    expect(setEditorMode).toHaveBeenCalledWith('annotate');
    expect(consumePendingGame()).toMatchObject({ gameId: GAME });
    expect(rejectUrlProfile).not.toHaveBeenCalled();
  });

  it('a profile the account cannot use never opens the id in the current profile', async () => {
    failSwitch(404);
    await openEmailGameLink(GAME, 'deadbeef');
    await vi.advanceTimersByTimeAsync(6000);
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(consumePendingGame()).toBeNull();
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: false });
  });

  it('a failed switch does not claim the profile is gone', async () => {
    failSwitch(500);
    await openEmailGameLink(GAME, NAMED);
    await vi.advanceTimersByTimeAsync(6000);
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: true });
  });

  it('a game that is not in the list lands with the notice', async () => {
    await openEmailGameLink(999, NAMED);
    await vi.advanceTimersByTimeAsync(6000);
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: false });
  });

  it('an empty list cannot prove the game is gone', async () => {
    useGamesDataStore.setState({ games: [] });
    await openEmailGameLink(GAME, NAMED);
    await vi.advanceTimersByTimeAsync(6000);
    expect(rejectUrlProfile).toHaveBeenCalledWith({ kind: 'game', unavailable: true });
  });

  it('leaves the user alone if they moved on while the list loaded', async () => {
    await openEmailGameLink(999, NAMED);
    useEditorStore.setState({ editorMode: 'overlay' });
    await vi.advanceTimersByTimeAsync(6000);
    expect(rejectUrlProfile).not.toHaveBeenCalled();
  });
});

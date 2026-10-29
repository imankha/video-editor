// T13850: reel_count on the game card follows a local change event (restore,
// delete, move) -- delta on ONE game, no /api/games refetch.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('../utils/apiFetch', () => ({ default: apiFetch }));

import { useGamesDataStore } from './gamesDataStore';

const games = () => [
  { id: 1, status: 'ready', reel_count: 2 },
  { id: 2, status: 'ready', reel_count: 1 },
];

describe('gamesDataStore.applyReelCountDelta (T13850)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useGamesDataStore.setState({ games: games(), readyGames: games() });
  });

  it('T13850:C1 decrements only the single game the reel belongs to, without a fetch', () => {
    useGamesDataStore.getState().applyReelCountDelta({ game_ids: [1] }, -1, 'delete-highlight');
    const { games: g, readyGames } = useGamesDataStore.getState();
    expect(g.map((x) => x.reel_count)).toEqual([1, 1]);
    expect(readyGames.map((x) => x.reel_count)).toEqual([1, 1]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('T13850:C1 mixes (multi-game / game-less) count for no game', () => {
    useGamesDataStore.getState().applyReelCountDelta({ game_ids: [1, 2] }, -1, 'restore');
    useGamesDataStore.getState().applyReelCountDelta({ game_ids: [] }, -1, 'restore');
    expect(useGamesDataStore.getState().games.map((x) => x.reel_count)).toEqual([2, 1]);
  });

  it('T13850:C1 never goes below zero', () => {
    useGamesDataStore.getState().applyReelCountDelta({ game_ids: [2] }, -5, 'move');
    expect(useGamesDataStore.getState().games[1].reel_count).toBe(0);
  });
});

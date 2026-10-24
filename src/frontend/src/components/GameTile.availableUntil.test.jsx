import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => true }));
vi.mock('../stores', () => {
  const state = { profiles: [{ id: 'p1', sport: 'soccer' }], currentProfileId: 'p1' };
  const useProfileStore = (sel) => sel(state);
  useProfileStore.getState = () => state;
  return { useProfileStore };
});
vi.mock('./instructions/GuideScope', () => ({ useGuidePulse: () => '' }));

import { GameTile } from './GameTile';

const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString();
const baseGame = (over = {}) => ({
  id: 7, name: 'Eagles vs Hawks', status: 'ready', storage_status: 'active',
  storage_expires_at: inDays(30), clip_count: 3, reel_count: 0, plays_only: false, ...over,
});
const noop = () => {};
const openMenu = (game) => {
  render(<GameTile game={game} onLoad={noop} onDelete={noop} onExtend={noop} onPlayRecap={noop}
    onShare={noop} onEdit={noop} onAddVideo={noop} />);
  fireEvent.click(screen.getByLabelText('More actions'));
};

describe('T12850 game menu availability', () => {
  it('shows the Available until date for a fresh game, without Extend', () => {
    const game = baseGame();
    openMenu(game);
    const date = new Date(game.storage_expires_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    expect(screen.getByText(`Available until ${date}`)).toBeTruthy();
    expect(screen.queryByText('Extend storage')).toBeNull();
  });

  it('keeps Extend inside the 14-day window alongside the date', () => {
    openMenu(baseGame({ storage_expires_at: inDays(5) }));
    expect(screen.getByText(/^Available until /)).toBeTruthy();
    expect(screen.getByText('Extend storage')).toBeTruthy();
  });

  it('omits the date row when the game has no expiry', () => {
    openMenu(baseGame({ storage_expires_at: null }));
    expect(screen.queryByText(/^Available until /)).toBeNull();
  });
});

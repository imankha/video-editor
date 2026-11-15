import { render } from '@testing-library/react';
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

const FUTURE = new Date(Date.now() + 40 * 86400000).toISOString();
const game = (over = {}) => ({
  id: 7, name: 'Eagles vs Hawks', status: 'ready', storage_status: 'active',
  storage_expires_at: FUTURE, clip_count: 1, reel_count: 0, brilliant_count: 0,
  plays_only: false, poster_version: '12-100.000-1', ...over,
});
const noop = () => {};
const posterSrc = (g) => {
  const { container } = render(<GameTile game={g} onLoad={noop} onDelete={noop} onExtend={noop}
    onPlayRecap={noop} onShare={noop} onEdit={noop} onAddVideo={noop} />);
  return container.querySelector('img[src*="/poster.jpg"]').getAttribute('src');
};

describe('T10540 game tile picture address follows the top-rated play', () => {
  it('carries the game poster_version in the poster URL', () => {
    const src = posterSrc(game());
    expect(src).toContain('/api/games/7/poster.jpg?profile_id=p1');
    expect(src).toContain('v=12-100.000-1');
  });

  it('a new top play gives a new address (browser cache cannot hold the old picture)', () => {
    const a = posterSrc(game());
    const b = posterSrc(game({ poster_version: '15-200.000-1' }));
    expect(a).not.toBe(b);
  });
});

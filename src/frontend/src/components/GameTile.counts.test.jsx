import { render, screen } from '@testing-library/react';
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

const baseGame = (over = {}) => ({
  id: 7,
  name: 'Eagles vs Hawks',
  status: 'ready',
  storage_status: 'active',
  storage_expires_at: FUTURE,
  clip_count: 12,
  reel_count: 2,
  brilliant_count: 3,
  plays_only: false,
  ...over,
});

const noop = () => {};
const renderTile = (game) =>
  render(<GameTile game={game} onLoad={noop} onDelete={noop} onExtend={noop} onPlayRecap={noop}
    onShare={noop} onEdit={noop} onAddVideo={noop} />);

describe('T12950 game tile counts line', () => {
  it('renders a gold star with the brilliant count and accessible name', () => {
    renderTile(baseGame());
    const seg = screen.getByLabelText('3 brilliant');
    expect(seg.textContent).toContain('3');
    expect(seg.querySelector('svg').getAttribute('fill')).toBe('#F5B700');
    expect(screen.getByText(/12 plays/)).toBeTruthy();
    expect(screen.getByText(/2 finished/)).toBeTruthy();
  });

  it('omits the brilliant segment at 0 or missing', () => {
    renderTile(baseGame({ brilliant_count: 0 }));
    expect(screen.queryByLabelText(/brilliant/)).toBeNull();
  });

  it('omits the finished segment at 0 but keeps brilliant', () => {
    renderTile(baseGame({ reel_count: 0 }));
    expect(screen.getByLabelText('3 brilliant')).toBeTruthy();
    expect(screen.queryByText(/finished/)).toBeNull();
  });
});

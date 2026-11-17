import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * T16780: a game whose upload never finished has no poster, so its tile must not ask
 * the server for one (every Home load logged a 404 per unfinished upload). The tile
 * shows the branded "No poster" fallback straight away.
 */
vi.mock('../hooks/useIsMobile', () => ({ useIsMobile: () => false }));
vi.mock('../stores', () => ({
  useProfileStore: (sel) => sel({ profiles: [{ id: 'p1', name: 'Fall Soccer', sport: 'soccer', isCurrent: true }], currentProfileId: 'p1' }),
}));

import { GameTile } from './GameTile';

const game = (status) => ({
  id: 7, name: 'Eagles vs Hawks', status, storage_status: 'active',
  created_at: '2026-07-01T12:00:00Z', clip_count: 0, poster_version: '0',
});

const handlers = {
  onLoad: vi.fn(), onDelete: vi.fn(), onExtend: vi.fn(),
  onPlayRecap: vi.fn(), onShare: vi.fn(), onEdit: vi.fn(),
};

describe('GameTile poster request by upload status (T16780)', () => {
  it('requests no poster.jpg for an upload_failed game and shows the fallback', () => {
    render(<GameTile game={game('upload_failed')} {...handlers} />);
    const posterImgs = [...document.querySelectorAll('img')].filter((i) => (i.getAttribute('src') || '').includes('poster.jpg'));
    expect(posterImgs).toHaveLength(0);
    expect(screen.getByText('No poster')).toBeTruthy();
  });

  it('still requests the poster for a ready game', () => {
    render(<GameTile game={game('ready')} {...handlers} />);
    const posterImgs = [...document.querySelectorAll('img')].filter((i) => (i.getAttribute('src') || '').includes('poster.jpg'));
    expect(posterImgs).toHaveLength(1);
  });
});

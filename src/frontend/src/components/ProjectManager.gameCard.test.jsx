import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// useIsMobile reads window.matchMedia, which jsdom does not implement.
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
}));

import { GameCard } from './ProjectManager';

const baseGame = {
  id: 7,
  name: 'Test Game',
  created_at: '2026-06-01T00:00:00Z',
  clip_count: 3,
  brilliant_count: 1,
  good_count: 0,
  interesting_count: 0,
  mistake_count: 0,
  blunder_count: 0,
  tag_badges: [],
  video_duration: 100,
  viewed_duration: 0,
  recap_video_url: 'https://example.com/recap.mp4',
};

function renderCard(overrides = {}, handlers = {}) {
  const game = { ...baseGame, ...overrides };
  const props = {
    game,
    onLoad: vi.fn(),
    onDelete: vi.fn(),
    onExtend: vi.fn(),
    onPlayRecap: vi.fn(),
    onShare: vi.fn(),
    onEdit: vi.fn(),
    ...handlers,
  };
  render(<GameCard {...props} />);
  return props;
}

describe('GameCard - expired game (T3970)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not render any Share button on an expired card', () => {
    renderCard({ storage_status: 'expired' });
    expect(screen.queryByTitle('Storage expired - extend to share')).toBeNull();
    expect(screen.queryByTitle('Share game')).toBeNull();
  });

  it('exposes a Playback annotations action on an expired card', () => {
    const { onPlayRecap } = renderCard({ storage_status: 'expired' });
    const playback = screen.getByTitle('Watch all annotated clips');
    expect(playback.textContent).toContain('Playback annotations');
    playback.click();
    expect(onPlayRecap).toHaveBeenCalledWith('annotations');
  });

  it('offers playback even when the game is still extendable', () => {
    renderCard({ storage_status: 'expired', can_extend: true });
    expect(screen.getByTitle('Watch all annotated clips')).toBeTruthy();
    expect(screen.getByTitle('Extend storage')).toBeTruthy();
  });

  it('offers playback even without a recap video (annotations persist post-grace)', () => {
    renderCard({ storage_status: 'expired', recap_video_url: null });
    expect(screen.getByTitle('Watch all annotated clips')).toBeTruthy();
  });

  it('does not render an enabled Share affordance on an expired card', () => {
    renderCard({ storage_status: 'expired' });
    expect(screen.queryByTitle('Share game')).toBeNull();
  });

  it('active (non-expired) card keeps an enabled Share button', () => {
    renderCard({ storage_status: 'active' });
    const share = screen.getByTitle('Share game');
    expect(share.disabled).toBe(false);
  });
});

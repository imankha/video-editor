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

  it('exposes exactly ONE recap entry labeled "Recap" (opens annotations tab)', () => {
    const { onPlayRecap } = renderCard({ storage_status: 'expired' });
    const recapButtons = screen.getAllByText('Recap');
    expect(recapButtons).toHaveLength(1);
    // The single consolidated entry; no separate Highlights / Playback annotations.
    expect(screen.queryByText('Highlights')).toBeNull();
    expect(screen.queryByText('Playback annotations')).toBeNull();
    recapButtons[0].click();
    expect(onPlayRecap).toHaveBeenCalledWith('annotations');
  });

  it('offers the Recap entry even when the game is still extendable', () => {
    renderCard({ storage_status: 'expired', can_extend: true });
    expect(screen.getByText('Recap')).toBeTruthy();
    expect(screen.getByTitle('Extend storage')).toBeTruthy();
  });

  it('offers the Recap entry even without a recap video (annotations persist post-grace)', () => {
    renderCard({ storage_status: 'expired', recap_video_url: null });
    expect(screen.getByText('Recap')).toBeTruthy();
  });

  it('shows no Recap entry when the expired game has no clips', () => {
    renderCard({ storage_status: 'expired', clip_count: 0 });
    expect(screen.queryByText('Recap')).toBeNull();
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

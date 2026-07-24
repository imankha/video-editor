import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// Mutable state so tests can vary the current profile's sport + viewport.
const h = vi.hoisted(() => ({
  isMobile: false,
  profiles: [{ id: 'p1', name: 'Fall Soccer', sport: 'soccer', isCurrent: true }],
  currentProfileId: 'p1',
}));

vi.mock('../../hooks/useIsMobile', () => ({
  useIsMobile: () => h.isMobile,
}));
vi.mock('../../stores', () => ({
  useProfileStore: (sel) => sel({ profiles: h.profiles, currentProfileId: h.currentProfileId }),
}));

import { GameTile } from '../GameTile';

const baseGame = {
  id: 42,
  name: 'vs Rivals',
  created_at: '2026-07-01T12:00:00Z',
  clip_count: 3,
  recap_video_url: 'recaps/42.mp4',
  storage_status: 'active',
  can_extend: true,
};

const handlers = () => ({
  onLoad: vi.fn(),
  onDelete: vi.fn(),
  onExtend: vi.fn(),
  onPlayRecap: vi.fn(),
  onShare: vi.fn(),
  onEdit: vi.fn(),
});

beforeEach(() => {
  h.isMobile = false;
  h.profiles = [{ id: 'p1', name: 'Fall Soccer', sport: 'soccer', isCurrent: true }];
  h.currentProfileId = 'p1';
});

function forcePosterError() {
  // The poster endpoint 404s -> the <img> errors -> the branded fallback renders.
  const img = document.querySelector('img');
  fireEvent.error(img);
}

describe('GameTile — sport-aware fallback (item 1)', () => {
  it('shows the CURRENT profile sport ball (soccer) in the no-poster fallback', () => {
    render(<GameTile game={baseGame} {...handlers()} />);
    forcePosterError();
    expect(screen.getByText('⚽')).toBeTruthy();
    // Never a hardcoded baseball for a soccer profile.
    expect(screen.queryByText('⚾')).toBeNull();
  });

  it('shows the correct ball for a different sport (baseball)', () => {
    h.profiles = [{ id: 'p1', name: 'Spring Ball', sport: 'baseball', isCurrent: true }];
    render(<GameTile game={baseGame} {...handlers()} />);
    forcePosterError();
    expect(screen.getByText('⚾')).toBeTruthy();
  });

  it('falls back to the app logo (not another sport) for an unknown/custom sport', () => {
    h.profiles = [{ id: 'p1', name: 'Ultimate', sport: 'quidditch', isCurrent: true }];
    const { container } = render(<GameTile game={baseGame} {...handlers()} />);
    forcePosterError();
    // No sport emoji rendered; the app logo SVG stands in.
    expect(screen.queryByText('⚽')).toBeNull();
    expect(screen.queryByText('🏅')).toBeNull();
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('GameTile — kebab menu (item 4)', () => {
  it('opens a menu with full-label actions from the single kebab button', () => {
    const hs = handlers();
    render(<GameTile game={baseGame} {...hs} />);

    // No action labels until the kebab is opened.
    expect(screen.queryByText('Edit game')).toBeNull();

    fireEvent.click(screen.getByLabelText('More actions'));

    expect(screen.getByText('Watch recap')).toBeTruthy(); // hasRecap
    expect(screen.getByText('Share game')).toBeTruthy();   // active
    expect(screen.getByText('Edit game')).toBeTruthy();
    expect(screen.getByText('Delete game')).toBeTruthy();

    fireEvent.click(screen.getByText('Edit game'));
    expect(hs.onEdit).toHaveBeenCalledTimes(1);
  });

  it('delete requires a second confirm tap', () => {
    const hs = handlers();
    render(<GameTile game={baseGame} {...hs} />);
    fireEvent.click(screen.getByLabelText('More actions'));

    fireEvent.click(screen.getByText('Delete game'));
    expect(hs.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Tap again to confirm')).toBeTruthy();

    fireEvent.click(screen.getByText('Tap again to confirm'));
    expect(hs.onDelete).toHaveBeenCalledTimes(1);
  });

  it('renders a bottom sheet on coarse (mobile) pointers', () => {
    h.isMobile = true;
    const hs = handlers();
    render(<GameTile game={baseGame} {...hs} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    const sheet = document.querySelector('[data-game-menu]');
    expect(sheet).toBeTruthy();
    expect(within(sheet).getByText('Edit game')).toBeTruthy();
  });

  it('tapping the tile body triggers the primary open (annotate), not the menu', () => {
    const hs = handlers();
    const { container } = render(<GameTile game={baseGame} {...hs} />);
    fireEvent.click(container.firstChild);
    expect(hs.onLoad).toHaveBeenCalledTimes(1);
  });

  it('omits Share for an expired game and offers Extend', () => {
    const hs = handlers();
    const expired = { ...baseGame, storage_status: 'expired' };
    render(<GameTile game={expired} {...hs} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.queryByText('Share game')).toBeNull();
    expect(screen.getByText('Extend storage')).toBeTruthy();
  });
});

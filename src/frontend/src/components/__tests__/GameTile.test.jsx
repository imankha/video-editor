import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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

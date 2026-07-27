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

  // Re-homed from the retired ProjectManager.gameCard.test.jsx ("offers the Recap
  // entry even when the game is still extendable", T5990): an expired game that
  // still has a recap video AND is extendable must expose BOTH the recap entry and
  // Extend -- the tile menu gates recap on recap_video_url (hasRecap), independent
  // of Extend. NOTE (surfaced by T5990): unlike the old GameCard, the tile does NOT
  // offer a recap entry for an expired game with no recap_video_url, and it gates
  // recap on the recap video rather than clip_count.
  it('offers both Watch recap and Extend on an expired, extendable game with a recap', () => {
    const hs = handlers();
    const expired = { ...baseGame, storage_status: 'expired', can_extend: true, recap_video_url: 'recaps/42.mp4' };
    render(<GameTile game={expired} {...hs} />);
    fireEvent.click(screen.getByLabelText('More actions'));
    expect(screen.getByText('Watch recap')).toBeTruthy();
    expect(screen.getByText('Extend storage')).toBeTruthy();
    fireEvent.click(screen.getByText('Watch recap'));
    expect(hs.onPlayRecap).toHaveBeenCalledTimes(1);
  });
});

describe('GameTile — game name on the scrim (T5681 follow-up)', () => {
  it('shows the game name as the scrim primary line when a poster is showing', () => {
    render(<GameTile game={baseGame} {...handlers()} />);
    // Poster is still loading/showing (no forced error) -- the name must render
    // on the SAME shared scrim regardless of poster state.
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.textContent).toBe(baseGame.name);
  });

  it('shows the SAME name element on the no-poster fallback (one consistent structure)', () => {
    render(<GameTile game={baseGame} {...handlers()} />);
    forcePosterError();
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.textContent).toBe(baseGame.name);
  });

  it('truncates a long name (single line, no wrap) and carries a full-text title tooltip', () => {
    const longName = 'A Very Long Tournament Game Name That Should Not Wrap Or Overflow The Tile';
    render(<GameTile game={{ ...baseGame, name: longName }} {...handlers()} />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.textContent).toBe(longName);
    expect(heading.className).toContain('truncate');
    // Full name still reachable (hover tooltip) even though it's visually clipped.
    expect(heading.getAttribute('title')).toBe(longName);
  });

  it('keeps date + clip count as the secondary line under the name', () => {
    render(<GameTile game={baseGame} {...handlers()} />);
    const heading = screen.getByRole('heading', { level: 3 });
    // Secondary line (date/clip count) renders in a sibling below the name.
    const secondary = heading.nextElementSibling;
    expect(secondary.textContent).toContain('3 clips');
  });
});

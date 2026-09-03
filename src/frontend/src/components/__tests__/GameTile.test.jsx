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

    // No kebab action labels until the kebab is opened.
    expect(screen.queryByText('Watch recap')).toBeNull();

    fireEvent.click(screen.getByLabelText('More actions'));

    expect(screen.getByText('Watch recap')).toBeTruthy(); // hasRecap
    expect(screen.getByText('Share game')).toBeTruthy();   // active
    expect(screen.getByText('Delete game')).toBeTruthy();
    // T6890: Edit moved OUT of the kebab to the pencil beside the name.
    expect(screen.queryByText('Edit game')).toBeNull();
  });

  it('T6890: the edit pencil sits beside the name and opens the edit form', () => {
    const hs = handlers();
    render(<GameTile game={baseGame} {...hs} />);
    // Discoverable at rest (no kebab open needed) — the affordance is next to the name.
    const editBtn = screen.getByRole('button', { name: 'Edit game' });
    expect(editBtn).toBeTruthy();
    fireEvent.click(editBtn);
    expect(hs.onEdit).toHaveBeenCalledTimes(1);
    // Editing must NOT also trigger the tile's primary open (annotate).
    expect(hs.onLoad).not.toHaveBeenCalled();
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
    expect(within(sheet).getByText('Share game')).toBeTruthy();
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

describe('GameTile — upload_failed state (T7490)', () => {
  const failedHandlers = () => ({ ...handlers(), onRetryUpload: vi.fn(), onDiscardFailed: vi.fn() });
  const failedGame = { ...baseGame, status: 'upload_failed', recap_video_url: null };

  it('renders the "Upload incomplete" badge and a clip-preserving explainer', () => {
    render(<GameTile game={failedGame} {...failedHandlers()} />);
    expect(screen.getByText('Upload incomplete')).toBeTruthy();
    // clip_count=3 -> reassurance the annotations survive on Retry (T8260: "annotations", not "clips").
    expect(screen.getByText(/3 annotations saved — Retry to keep them/)).toBeTruthy();
  });

  it('shows the no-clips explainer variant when clip_count is 0', () => {
    render(<GameTile game={{ ...failedGame, clip_count: 0 }} {...failedHandlers()} />);
    expect(screen.getByText(/Retry to resume, or discard/)).toBeTruthy();
  });

  it('Retry fires onRetryUpload', () => {
    const hs = failedHandlers();
    render(<GameTile game={failedGame} {...hs} />);
    fireEvent.click(screen.getByRole('button', { name: /Retry upload of/ }));
    expect(hs.onRetryUpload).toHaveBeenCalledTimes(1);
  });

  it('Discard requires a second confirm tap before the cascade delete', () => {
    const hs = failedHandlers();
    render(<GameTile game={failedGame} {...hs} />);
    fireEvent.click(screen.getByRole('button', { name: /^Discard/ }));
    expect(hs.onDiscardFailed).not.toHaveBeenCalled();
    // Escalated confirm affordance appears.
    const confirm = screen.getByRole('button', { name: /Confirm discard of/ });
    expect(confirm.textContent).toContain('Delete for good?');
    fireEvent.click(confirm);
    expect(hs.onDiscardFailed).toHaveBeenCalledTimes(1);
  });

  it('is inert: tapping the tile body does NOT open annotate, and the kebab/pencil are gone', () => {
    const hs = failedHandlers();
    const { container } = render(<GameTile game={failedGame} {...hs} />);
    fireEvent.click(container.firstChild);
    expect(hs.onLoad).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('More actions')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit game' })).toBeNull();
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

  it('keeps the annotation count as the secondary line under the name (T8260)', () => {
    render(<GameTile game={baseGame} {...handlers()} />);
    const heading = screen.getByRole('heading', { level: 3 });
    // T6890: the name shares a row with the edit pencil, so the secondary line
    // (annotation count) sits below that name-row wrapper, not the bare heading.
    const secondary = heading.closest('div').nextElementSibling;
    expect(secondary.textContent).toContain('3 annotations');
    // T8260: the word "clips" must appear nowhere on the tile.
    expect(secondary.textContent).not.toMatch(/clip/i);
  });

  // T8260: published reels surface as a second segment; omitted entirely at 0.
  it('appends "N reels" when the game has published reels', () => {
    render(<GameTile game={{ ...baseGame, reel_count: 3 }} {...handlers()} />);
    const secondary = screen.getByRole('heading', { level: 3 }).closest('div').nextElementSibling;
    expect(secondary.textContent).toContain('3 annotations');
    expect(secondary.textContent).toContain('3 reels');
    expect(secondary.textContent).toContain('•');
  });

  it('omits the reels segment when reel_count is 0 or absent', () => {
    render(<GameTile game={{ ...baseGame, reel_count: 0 }} {...handlers()} />);
    const secondary = screen.getByRole('heading', { level: 3 }).closest('div').nextElementSibling;
    expect(secondary.textContent).not.toContain('reel');
    expect(secondary.textContent).not.toContain('•');
  });

  it('uses singular forms for one annotation and one reel', () => {
    render(<GameTile game={{ ...baseGame, clip_count: 1, reel_count: 1 }} {...handlers()} />);
    const secondary = screen.getByRole('heading', { level: 3 }).closest('div').nextElementSibling;
    expect(secondary.textContent).toContain('1 annotation •');
    expect(secondary.textContent).toContain('1 reel');
    expect(secondary.textContent).not.toContain('annotations');
    expect(secondary.textContent).not.toContain('reels');
  });

  // T7330 (reversing T7290's removal): the footer shows the MATCH date with its weekday.
  // T7290 dropped it as redundant with the title suffix, but the title is truncated in
  // ~120px and the suffix sits at the truncation end, so it is the first thing lost.
  it('renders the match date with its weekday, from game_date', () => {
    const game = { ...baseGame, created_at: '2026-07-01T12:00:00Z', game_date: '2026-03-21' };
    render(<GameTile game={game} {...handlers()} />);
    const secondary = screen.getByRole('heading', { level: 3 }).closest('div').nextElementSibling;

    expect(secondary.textContent).toContain('Mar 21');
    expect(secondary.textContent).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),/);
    expect(secondary.textContent).toContain('3 annotations');
    // The UPLOAD date is never shown -- it would contradict the match-date header above.
    expect(secondary.textContent).not.toContain('Jul');
  });

  it.each([
    ['null', null],
    ['empty', ''],
    ['malformed', '03/21/2026'],
  ])('renders NO date when game_date is %s, and never the upload date', (_label, gameDate) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const game = { ...baseGame, created_at: '2026-07-01T12:00:00Z', game_date: gameDate };
    render(<GameTile game={game} {...handlers()} />);
    const secondary = screen.getByRole('heading', { level: 3 }).closest('div').nextElementSibling;

    expect(secondary.textContent.trim()).toBe('3 annotations');
    expect(secondary.textContent).not.toMatch(/Jul|Invalid|NaN/);
    warn.mockRestore();
  });
});

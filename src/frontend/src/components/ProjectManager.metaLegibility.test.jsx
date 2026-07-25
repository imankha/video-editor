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
  created_at: '2026-06-11T00:00:00Z',
  clip_count: 13,
  brilliant_count: 5,
  good_count: 4,
  interesting_count: 0,
  mistake_count: 0,
  blunder_count: 0,
  tag_badges: [],
  video_duration: 100,
  viewed_duration: 0,
  storage_status: 'active',
};

function renderCard(overrides = {}) {
  const game = { ...baseGame, ...overrides };
  render(
    <GameCard
      game={game}
      onLoad={vi.fn()}
      onDelete={vi.fn()}
      onExtend={vi.fn()}
      onPlayRecap={vi.fn()}
      onShare={vi.fn()}
      onEdit={vi.fn()}
    />
  );
}

describe('GameCard metadata legibility (T5675)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('labels the date with an "Uploaded" prefix', () => {
    renderCard();
    expect(screen.getByText(/Uploaded/)).toBeTruthy();
  });

  it('replaces chess-notation rating shorthand with labeled adjective chips', () => {
    renderCard();
    // Human-readable adjective labels, not "5!!" / "4!".
    expect(screen.getByText(/5\s+Brilliant/)).toBeTruthy();
    expect(screen.getByText(/4\s+Good/)).toBeTruthy();
    // No chess notation anywhere on the card.
    expect(document.body.textContent).not.toMatch(/!!/);
    expect(document.body.textContent).not.toMatch(/5!/);
  });

  it('gives each rating chip an aria-label describing the count', () => {
    renderCard();
    expect(screen.getByLabelText('5 brilliant clips')).toBeTruthy();
    expect(screen.getByLabelText('4 good clips')).toBeTruthy();
  });

  it('labels the quality score instead of a bare "Quality:" token', () => {
    renderCard();
    // 5*3 + 4*2 = 23
    expect(screen.getByText(/Footage quality 23\/100/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Quality: /);
  });

  it('omits rating chips when there are no rated clips', () => {
    renderCard({ brilliant_count: 0, good_count: 0 });
    expect(screen.queryByText(/Brilliant/)).toBeNull();
    expect(screen.queryByText(/Good/)).toBeNull();
  });
});

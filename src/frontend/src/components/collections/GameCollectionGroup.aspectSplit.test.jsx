import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T5672: a game/mixes group whose reels mix aspects already rendered as two
// rows (eligible/sub-threshold split, portrait first) -- but the only ratio
// indicator was a glyph with no legible text. Stub the wrapper + heavy card
// components so we exercise only GameCollectionGroup's own row/chip markup;
// CardCarousel (and its aria-label) render for real, like the sibling
// order.test.jsx.
vi.mock('../shared/CollapsibleGroup', () => ({
  CollapsibleGroup: ({ children }) => <div>{children}</div>,
}));
vi.mock('./CollectionCard', () => ({
  CollectionCard: ({ ratio }) => <div data-testid={`collection-card-${ratio}`}>card {ratio}</div>,
}));
vi.mock('./RatioUnlockGroup', () => ({
  RatioUnlockGroup: ({ ratio }) => <div data-testid={`ratio-unlock-${ratio}`}>locked {ratio}</div>,
}));

import { GameCollectionGroup } from './GameCollectionGroup';

function renderGroup({ collection, members = [] }) {
  return render(
    <GameCollectionGroup
      name="Vs Legends Jun 6"
      collection={collection}
      defaultExpanded
      members={members}
      memberState="ready"
      requestMembers={() => {}}
      onPlay={() => {}}
      renderCard={(d) => <div data-testid="reel" key={d.id}>{d.id}</div>}
      shareScope={{ type: 'game', game_id: 1 }}
    />,
  );
}

describe('GameCollectionGroup — aspect-split rows (T5672)', () => {
  it('shows no aspect chip for a single-aspect group (unchanged look)', () => {
    renderGroup({
      collection: {
        reel_count: 2,
        ratio_counts: { '9:16': 2 },
        ratio_durations: { '9:16': 60 },
        ratio_eligible: { '9:16': true },
      },
      members: [
        { id: 'a', aspect_ratio: '9:16', clip_game_start_time: 100 },
        { id: 'b', aspect_ratio: '9:16', clip_game_start_time: 200 },
      ],
    });
    expect(screen.queryByText('9:16')).toBeNull();
    expect(screen.queryByText('16:9')).toBeNull();
    expect(screen.getByTestId('collection-card-9:16')).toBeTruthy();
  });

  it('shows a "9:16"/"16:9" text chip on each row when both ratios are eligible, portrait first', () => {
    renderGroup({
      collection: {
        reel_count: 4,
        ratio_counts: { '9:16': 2, '16:9': 2 },
        ratio_durations: { '9:16': 40, '16:9': 40 },
        ratio_eligible: { '9:16': true, '16:9': true },
      },
      members: [
        { id: 'p1', aspect_ratio: '9:16', clip_game_start_time: 100 },
        { id: 'p2', aspect_ratio: '9:16', clip_game_start_time: 200 },
        { id: 'l1', aspect_ratio: '16:9', clip_game_start_time: 150 },
        { id: 'l2', aspect_ratio: '16:9', clip_game_start_time: 250 },
      ],
    });

    expect(screen.getByText('9:16')).toBeTruthy();
    expect(screen.getByText('16:9')).toBeTruthy();

    // Portrait chip precedes landscape chip in DOM order.
    const chips = screen.getAllByText(/^(9:16|16:9)$/);
    expect(chips.map((c) => c.textContent)).toEqual(['9:16', '16:9']);

    // Each ratio's own CardCarousel is present, correctly labeled.
    expect(screen.getByRole('group', { name: 'Game Highlights 9:16 reels' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Game Highlights 16:9 reels' })).toBeTruthy();
  });

  it('shows the aspect chip on a sub-threshold (locked) ratio row too', () => {
    renderGroup({
      collection: {
        reel_count: 3,
        ratio_counts: { '9:16': 2, '16:9': 1 },
        ratio_durations: { '9:16': 40, '16:9': 5 },
        ratio_eligible: { '9:16': true, '16:9': false }, // 16:9 under the 30s threshold
      },
      members: [
        { id: 'p1', aspect_ratio: '9:16', clip_game_start_time: 100 },
        { id: 'p2', aspect_ratio: '9:16', clip_game_start_time: 200 },
        { id: 'l1', aspect_ratio: '16:9', clip_game_start_time: 150 },
      ],
    });

    expect(screen.getByText('9:16')).toBeTruthy();
    expect(screen.getByText('16:9')).toBeTruthy();
    expect(screen.getByTestId('collection-card-9:16')).toBeTruthy();
    expect(screen.getByTestId('ratio-unlock-16:9')).toBeTruthy();
  });

  it('routes each member into its own ratio bucket (no cross-aspect leakage)', () => {
    renderGroup({
      collection: {
        reel_count: 4,
        ratio_counts: { '9:16': 2, '16:9': 2 },
        ratio_durations: { '9:16': 40, '16:9': 40 },
        ratio_eligible: { '9:16': true, '16:9': true },
      },
      members: [
        { id: 'l1', aspect_ratio: '16:9', clip_game_start_time: 300 },
        { id: 'p1', aspect_ratio: '9:16', clip_game_start_time: 100 },
        { id: 'l2', aspect_ratio: '16:9', clip_game_start_time: 150 },
        { id: 'p2', aspect_ratio: '9:16', clip_game_start_time: 200 },
      ],
    });

    const portraitRow = screen.getByRole('group', { name: 'Game Highlights 9:16 reels' });
    const landscapeRow = screen.getByRole('group', { name: 'Game Highlights 16:9 reels' });
    expect(portraitRow.textContent).toBe('p1p2'); // sorted by game time within the bucket
    expect(landscapeRow.textContent).toBe('l2l1');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T4080: a game's reels must render ordered by in-game time (clip_game_start_time),
// nulls last, matching the annotation clip-list order. Stub the heavy children and
// the collapsible wrapper so we exercise only GameCollectionGroup's member ordering.
vi.mock('../shared/CollapsibleGroup', () => ({
  CollapsibleGroup: ({ children }) => <div>{children}</div>,
}));
vi.mock('./CollectionCard', () => ({ CollectionCard: () => null }));
vi.mock('./RatioUnlockGroup', () => ({ RatioUnlockGroup: () => null }));

import { GameCollectionGroup } from './GameCollectionGroup';

describe('GameCollectionGroup — in-game-time ordering (T4080)', () => {
  it('orders reels by clip_game_start_time, nulls last', () => {
    const members = [
      { id: 'r_late', aspect_ratio: '9:16', clip_game_start_time: 3000 },
      { id: 'r_null', aspect_ratio: '9:16', clip_game_start_time: null },
      { id: 'r_early', aspect_ratio: '9:16', clip_game_start_time: 120 },
      { id: 'r_mid', aspect_ratio: '9:16', clip_game_start_time: 1800 },
    ];
    const collection = {
      reel_count: 4,
      ratio_counts: { '9:16': 4 },
      ratio_durations: { '9:16': 200 },
      ratio_eligible: { '9:16': true },
    };

    render(
      <GameCollectionGroup
        name="Game A"
        collection={collection}
        defaultExpanded
        members={members}
        memberState="ready"
        requestMembers={() => {}}
        onPlay={() => {}}
        renderCard={(d) => <div data-testid="reel" key={d.id}>{d.id}</div>}
      />,
    );

    const ids = screen.getAllByTestId('reel').map((el) => el.textContent);
    expect(ids).toEqual(['r_early', 'r_mid', 'r_late', 'r_null']);
  });
});

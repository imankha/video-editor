import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T4190: the game group's play-all card must be labelled with the game
// (opponent + date) instead of the anonymous "Game Highlights", and the group
// header must forward the bucket's unwatched_count as its NEW chip. Mock the
// wrapper + card so we capture exactly the props GameCollectionGroup passes.
vi.mock('../shared/CollapsibleGroup', () => ({
  CollapsibleGroup: ({ title, newCount, children }) => (
    <div>
      <span data-testid="group-title">{title}</span>
      <span data-testid="group-newcount">{newCount}</span>
      {children}
    </div>
  ),
}));
vi.mock('./CollectionCard', () => ({
  CollectionCard: ({ title, playTitle }) => (
    <div data-testid="card-title" data-play={playTitle}>{title}</div>
  ),
}));
vi.mock('./RatioUnlockGroup', () => ({ RatioUnlockGroup: () => null }));

import { GameCollectionGroup } from './GameCollectionGroup';

const collection = {
  reel_count: 2,
  unwatched_count: 1,
  ratio_counts: { '9:16': 2 },
  ratio_durations: { '9:16': 60 },
  ratio_eligible: { '9:16': true },
};

describe('GameCollectionGroup — naming + NEW chip (T4190)', () => {
  it('titles the play-all card with the game name, not "Game Highlights"', () => {
    render(
      <GameCollectionGroup
        name="Vs Legends Jun 6"
        collection={collection}
        members={[]}
        memberState="ready"
        requestMembers={() => {}}
        onPlay={() => {}}
        renderCard={() => null}
      />,
    );
    const card = screen.getByTestId('card-title');
    expect(card.textContent).toBe('Vs Legends Jun 6');
    expect(screen.queryByText('Game Highlights')).toBeNull();
    expect(card.getAttribute('data-play')).toBe('Vs Legends Jun 6');
  });

  it('forwards the bucket unwatched_count as the header newCount', () => {
    render(
      <GameCollectionGroup
        name="Vs Legends Jun 6"
        collection={collection}
        members={[]}
        memberState="ready"
        requestMembers={() => {}}
        onPlay={() => {}}
        renderCard={() => null}
      />,
    );
    expect(screen.getByTestId('group-newcount').textContent).toBe('1');
  });
});

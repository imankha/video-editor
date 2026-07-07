import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T4810 (reconciles T4190): the game group's play-all card reads the collection
// TYPE "Game Highlights", while the group HEADER carries the game name so two
// games are never visually identical (the T4190 disambiguation lives in the
// header, not the card). The player/share title (data-play) keeps the game name.
// The group header must also forward the bucket's unwatched_count as its NEW
// chip. Mock the wrapper + card so we capture exactly the props the group passes.
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
  it('titles the play-all card "Game Highlights" while the header keeps the game name (T4810/T4190)', () => {
    render(
      <GameCollectionGroup
        name="Vs Legends Jun 6"
        collection={collection}
        members={[]}
        memberState="ready"
        requestMembers={() => {}}
        onPlay={() => {}}
        renderCard={() => null}
        shareScope={{ type: 'game', game_id: 1 }}
      />,
    );
    const card = screen.getByTestId('card-title');
    // Card reads the collection type; the group header carries the game name so
    // two different games are never visually identical (T4190 survives).
    expect(card.textContent).toBe('Game Highlights');
    expect(screen.getByTestId('group-title').textContent).toBe('Vs Legends Jun 6');
    // Player/share title stays game-identified.
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

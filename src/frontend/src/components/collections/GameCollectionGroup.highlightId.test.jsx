import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T11580: highlightId rings + marks NEW the matching tile, without touching
// renderCard's own output (an opaque (download) => ReactNode owned by the
// panel) -- it wraps it instead. CollapsibleGroup/CollectionCard render for
// real (like the sibling order.test.jsx) so the actual carousel tree is
// exercised; only renderCard itself is a minimal stub per-tile marker.
vi.mock('../shared/CollapsibleGroup', () => ({
  CollapsibleGroup: ({ children }) => <div>{children}</div>,
}));
vi.mock('./CollectionCard', () => ({ CollectionCard: () => null }));

import { GameCollectionGroup } from './GameCollectionGroup';

const collection = {
  reel_count: 2,
  ratio_counts: { '9:16': 2 },
  ratio_durations: { '9:16': 60 },
  ratio_eligible: { '9:16': true },
};
const members = [
  { id: 101, aspect_ratio: '9:16', clip_game_start_time: 100 },
  { id: 102, aspect_ratio: '9:16', clip_game_start_time: 200 },
];

function renderGroup(highlightId) {
  return render(
    <GameCollectionGroup
      name="Vs Legends Jun 6"
      collection={collection}
      defaultExpanded
      members={members}
      memberState="ready"
      requestMembers={() => {}}
      onPlay={() => {}}
      renderCard={(d) => <div data-testid={`tile-${d.id}`} key={d.id}>{d.id}</div>}
      shareScope={{ type: 'game', game_id: 1 }}
      highlightId={highlightId}
    />,
  );
}

describe('GameCollectionGroup — justPublished tile ring/NEW badge (T11580)', () => {
  it('rings + marks NEW only the matching tile when highlightId is set', () => {
    renderGroup(102);
    const ringWrapper = screen.getByTestId('just-published-tile-ring');
    expect(ringWrapper.querySelector('[data-testid="tile-102"]')).toBeTruthy();
    // The NEW badge lives inside the ring wrapper, not on the other tile.
    expect(ringWrapper.textContent).toContain('NEW');
    expect(screen.getByTestId('tile-101').closest('[data-testid="just-published-tile-ring"]')).toBeNull();
  });

  it('rings nothing when highlightId is absent', () => {
    renderGroup(undefined);
    expect(screen.queryByTestId('just-published-tile-ring')).toBeNull();
    expect(screen.getByTestId('tile-101')).toBeTruthy();
    expect(screen.getByTestId('tile-102')).toBeTruthy();
  });

  it('rings nothing when highlightId does not match any member in this group', () => {
    renderGroup(999);
    expect(screen.queryByTestId('just-published-tile-ring')).toBeNull();
  });
});

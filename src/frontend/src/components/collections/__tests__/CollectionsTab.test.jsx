import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Stub the heavy child cards so we test ONLY CollectionsTab's branch logic:
// eligible -> CollectionCard, sub-30s curated -> SmartLockedCard (nudge),
// sub-30s per-tag -> nothing (hidden until ready).
vi.mock('../CollectionCard', () => ({
  CollectionCard: ({ title, ratio }) => <div data-testid="card">{`${title}:${ratio}`}</div>,
}));
vi.mock('../SmartLockedCard', () => ({
  SmartLockedCard: ({ name, ratio }) => <div data-testid="locked">{`${name}:${ratio}`}</div>,
}));
vi.mock('../GameCollectionGroup', () => ({ GameCollectionGroup: () => null }));

import { CollectionsTab } from '../CollectionsTab';

const BUCKET = {
  reel_count: 0, ratio_counts: {}, ratio_durations: {}, ratio_eligible: {},
  total_duration: 0, has_null_durations: false, latest_published_at: null,
};

const sub30 = (overrides) => ({
  ...BUCKET, reel_count: 1,
  ratio_counts: { '9:16': 1 }, ratio_durations: { '9:16': 12 }, ratio_eligible: { '9:16': false },
  ...overrides,
});
const ready = (overrides) => ({
  ...BUCKET, reel_count: 3,
  ratio_counts: { '9:16': 3 }, ratio_durations: { '9:16': 40 }, ratio_eligible: { '9:16': true },
  ...overrides,
});

const renderTab = (smart_collections) =>
  render(
    <CollectionsTab
      collections={{
        summary: { smart_collections, games: [], mixes: { reel_count: 0 } },
        summaryState: 'ready',
        members: {}, memberStates: {},
        fetchSummary: () => {}, fetchMembers: () => {},
      }}
      renderCard={() => null}
      onPlayCollection={() => {}}
    />,
  );

describe('CollectionsTab — nudge vs hidden', () => {
  it('shows the amber locked card for a sub-30s CURATED collection (nudge)', () => {
    renderTab([
      sub30({ key: 'soccer_goals_assists', name: 'Top Goals & Assists', tags: ['Assist', 'Goal'], nudge_when_locked: true }),
    ]);
    expect(screen.getByTestId('locked').textContent).toBe('Top Goals & Assists:9:16');
    expect(screen.queryByTestId('card')).toBeNull();
  });

  it('HIDES a sub-30s PER-TAG collection (no locked card, no nudge)', () => {
    renderTab([
      sub30({ key: 'tag:Dig', name: 'Top Digs', tags: ['Dig'], nudge_when_locked: false }),
    ]);
    expect(screen.queryByTestId('locked')).toBeNull();
    expect(screen.queryByTestId('card')).toBeNull();
  });

  it('shows a real card once eligible, for either kind', () => {
    renderTab([
      ready({ key: 'tag:Dig', name: 'Top Digs', tags: ['Dig'], nudge_when_locked: false }),
    ]);
    expect(screen.getByTestId('card').textContent).toBe('Top Digs:9:16');
    expect(screen.queryByTestId('locked')).toBeNull();
  });
});

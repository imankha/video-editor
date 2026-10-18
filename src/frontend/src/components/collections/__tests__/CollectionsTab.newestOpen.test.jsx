import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('../GameCollectionGroup', () => ({
  GameCollectionGroup: ({ name, defaultExpanded }) => (
    <div data-testid="game-group" data-name={name} data-expanded={String(defaultExpanded)} />
  ),
}));
vi.mock('../CollectionCard', () => ({ CollectionCard: () => null }));
vi.mock('../SmartLockedCard', () => ({ SmartLockedCard: () => null }));
vi.mock('../JustPublishedCard', () => ({ JustPublishedCard: () => null }));

import { CollectionsTab } from '../CollectionsTab';
import { useGalleryStore } from '../../../stores/galleryStore';

const BUCKET = {
  reel_count: 2, unwatched_count: 0, ratio_counts: {}, ratio_durations: {},
  ratio_eligible: {}, total_duration: 0, has_null_durations: false,
};
const game = (id, name, latest) => ({
  ...BUCKET, game_id: id, game_name: name, game_date: null, latest_published_at: latest,
});

const renderTab = (summary) =>
  render(
    <CollectionsTab
      collections={{
        summary, summaryState: 'ready', members: {}, memberStates: {},
        fetchSummary: () => {}, fetchMembers: () => {},
      }}
      renderCard={() => null}
      onPlayCollection={() => {}}
    />,
  );

const expandedOf = (name) =>
  screen.getAllByTestId('game-group').find((n) => n.dataset.name === name).dataset.expanded;

describe('CollectionsTab -- newest finished group opens on every entry', () => {
  beforeEach(() => {
    useGalleryStore.getState().reset();
    cleanup();
  });

  const SUMMARY = {
    smart_collections: [],
    mixes: { reel_count: 0 },
    games: [
      game(7, 'Vs Alpha', '2026-10-01T00:00:00Z'),
      game(8, 'Vs Bravo', '2026-10-10T00:00:00Z'),
      game(9, 'Vs Charlie', '2026-10-05T00:00:00Z'),
    ],
    game_groups: [],
  };

  it('expands only the game with the most recent latest_published_at', () => {
    renderTab(SUMMARY);
    expect(expandedOf('Vs Bravo')).toBe('true');
    expect(expandedOf('Vs Alpha')).toBe('false');
    expect(expandedOf('Vs Charlie')).toBe('false');
  });

  it('does it again on a fresh mount (re-entering the tab)', () => {
    renderTab(SUMMARY).unmount();
    renderTab(SUMMARY);
    expect(expandedOf('Vs Bravo')).toBe('true');
  });

  it('expands the mixes group when it holds the newest highlight', () => {
    renderTab({
      ...SUMMARY,
      mixes: { ...BUCKET, reel_count: 1, latest_published_at: '2026-10-17T00:00:00Z' },
    });
    expect(expandedOf('Vs Bravo')).toBe('false');
    expect(screen.getAllByTestId('game-group').find((n) => n.dataset.name !== 'Vs Bravo'
      && !['Vs Alpha', 'Vs Charlie'].includes(n.dataset.name)).dataset.expanded).toBe('true');
  });
});

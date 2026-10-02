import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

// Capture exactly the props CollectionsTab passes to each GameCollectionGroup
// call (defaultExpanded / highlightId), mirroring GameCollectionGroup.newchip
// test's style — these are the two signals T11580 threads through, and the
// T8990 landmine is specifically about defaultExpanded being re-derived on
// every render instead of consumed once.
vi.mock('../GameCollectionGroup', () => ({
  GameCollectionGroup: ({ name, defaultExpanded, highlightId }) => (
    <div data-testid="game-group" data-name={name} data-expanded={String(defaultExpanded)} data-highlight={String(highlightId)} />
  ),
}));
vi.mock('../CollectionCard', () => ({ CollectionCard: () => null }));
vi.mock('../SmartLockedCard', () => ({ SmartLockedCard: () => null }));
vi.mock('../JustPublishedCard', () => ({
  JustPublishedCard: ({ justPublished, onDismiss }) => (
    <div data-testid="just-published-card" data-final-video-id={justPublished.finalVideoId}>
      <button type="button" onClick={onDismiss}>Dismiss</button>
    </div>
  ),
}));

import { CollectionsTab } from '../CollectionsTab';
import { useGalleryStore } from '../../../stores/galleryStore';

const BUCKET = {
  reel_count: 2, unwatched_count: 1, ratio_counts: {}, ratio_durations: {},
  ratio_eligible: {}, total_duration: 0, has_null_durations: false,
  latest_published_at: null,
};
const game = (id, name) => ({ ...BUCKET, game_id: id, game_name: name, game_date: null });

const SUMMARY = {
  smart_collections: [],
  mixes: { reel_count: 0 },
  games: [game(7, 'Vs Alpha'), game(8, 'Vs Bravo')],
  game_groups: [],
};

const renderTab = () =>
  render(
    <CollectionsTab
      collections={{
        summary: SUMMARY, summaryState: 'ready', members: {}, memberStates: {},
        fetchSummary: () => {}, fetchMembers: () => {},
      }}
      renderCard={() => null}
      onPlayCollection={() => {}}
      buildPosterUrl={(id) => `poster/${id}`}
    />,
  );

const groupByName = (name) => screen.getAllByTestId('game-group').find((n) => n.dataset.name === name);

describe('CollectionsTab — Just Published spotlight (T11580)', () => {
  beforeEach(() => {
    useGalleryStore.getState().reset();
    cleanup();
  });

  it('renders nothing extra when there is no justPublished', () => {
    renderTab();
    expect(screen.queryByTestId('just-published-card')).toBeNull();
    expect(groupByName('Vs Alpha').dataset.expanded).toBe('false');
    expect(groupByName('Vs Bravo').dataset.expanded).toBe('false');
  });

  it('auto-expands ONLY the matching game group on first mount after a publish, and rings its tile', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 501, gameId: 8, aspectRatio: '9:16' });
    renderTab();

    expect(screen.getByTestId('just-published-card').dataset.finalVideoId).toBe('501');
    // Matching group (Bravo, game_id 8): auto-expanded + ringed.
    expect(groupByName('Vs Bravo').dataset.expanded).toBe('true');
    expect(groupByName('Vs Bravo').dataset.highlight).toBe('501');
    // Every other group stays collapsed and unmarked.
    expect(groupByName('Vs Alpha').dataset.expanded).toBe('false');
    expect(groupByName('Vs Alpha').dataset.highlight).toBe('undefined');
  });

  // T8990 regression: the auto-expand is a CONSUME-ONCE signal. A later
  // reopen of the Published tab (CollectionsTab remount — the panel unmounts
  // its children when the tab goes inactive) must NOT re-force the same
  // group open again, even though justPublished (and therefore the ring/NEW
  // badge) is still present. Re-forcing it would silently discard a user's
  // deliberate collapse of that group — the exact bug T8990 fixed for the
  // old "first game" default-expand.
  it('does NOT re-force the group open on a later remount (T8990 regression)', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 501, gameId: 8, aspectRatio: '9:16' });

    const first = renderTab();
    expect(groupByName('Vs Bravo').dataset.expanded).toBe('true');

    // Simulate the Published tab going inactive then active again: the real
    // PublishedReelsPanel unmounts CollectionsTab's whole subtree while
    // inactive (`active && !storyPlayer` false -> returns null), so a reopen
    // is a FRESH mount of CollectionsTab, not a re-render of the same instance.
    first.unmount();
    renderTab();

    // Card (justPublished itself) and the ring/NEW badge are still present --
    // only the auto-expand is spent.
    expect(screen.getByTestId('just-published-card')).toBeTruthy();
    expect(groupByName('Vs Bravo').dataset.highlight).toBe('501');
    expect(groupByName('Vs Bravo').dataset.expanded).toBe('false');
  });

  it('dismissing the card clears justPublished (and a later remount shows nothing)', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 501, gameId: 8, aspectRatio: '9:16' });
    const first = renderTab();

    fireEvent.click(screen.getByText('Dismiss'));
    expect(useGalleryStore.getState().justPublished).toBeNull();

    first.unmount();
    renderTab();
    expect(screen.queryByTestId('just-published-card')).toBeNull();
    expect(groupByName('Vs Bravo').dataset.highlight).toBe('undefined');
  });

  it('targets the Mixes group (gameId: null) and leaves every game group untouched', () => {
    useGalleryStore.getState().setJustPublished({ finalVideoId: 777, gameId: null, aspectRatio: '16:9' });
    render(
      <CollectionsTab
        collections={{
          summary: { ...SUMMARY, mixes: { reel_count: 1 } },
          summaryState: 'ready', members: {}, memberStates: {},
          fetchSummary: () => {}, fetchMembers: () => {},
        }}
        renderCard={() => null}
        onPlayCollection={() => {}}
        buildPosterUrl={(id) => `poster/${id}`}
      />,
    );
    expect(groupByName('Mixes & compilations').dataset.expanded).toBe('true');
    expect(groupByName('Mixes & compilations').dataset.highlight).toBe('777');
    expect(groupByName('Vs Alpha').dataset.expanded).toBe('false');
    expect(groupByName('Vs Bravo').dataset.expanded).toBe('false');
    expect(groupByName('Vs Alpha').dataset.highlight).toBe('undefined');
    expect(groupByName('Vs Bravo').dataset.highlight).toBe('undefined');
  });
});

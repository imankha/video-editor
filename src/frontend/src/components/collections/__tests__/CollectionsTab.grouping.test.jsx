import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

// Stub the leaf cards; keep GameAxisGroup + CollapsibleGroup REAL so we test the
// actual two-level nesting. GameCollectionGroup is stubbed to a simple node that
// echoes the game name so we can assert which games render where (T5880).
vi.mock('../CollectionCard', () => ({ CollectionCard: () => null }));
vi.mock('../SmartLockedCard', () => ({ SmartLockedCard: () => null }));
vi.mock('../GameCollectionGroup', () => ({
  GameCollectionGroup: ({ name }) => <div data-testid="game-group">{name}</div>,
}));

import { CollectionsTab } from '../CollectionsTab';

const BUCKET = {
  reel_count: 2, unwatched_count: 1, ratio_counts: {}, ratio_durations: {},
  ratio_eligible: {}, total_duration: 0, has_null_durations: false,
  latest_published_at: null,
};
const game = (id, name) => ({ ...BUCKET, game_id: id, game_name: name, game_date: null });

const SUMMARY = {
  smart_collections: [],
  mixes: { reel_count: 0 },
  games: [game(7, 'Vs Alpha'), game(8, 'Vs Bravo'), game(9, 'Vs Charlie')],
  game_groups: [
    // Alpha + Bravo are in a tournament; Charlie is not.
    { axis: 'tournament', key: 'tournament:Summer Cup', label: 'Summer Cup',
      game_ids: [7, 8], reel_count: 4, unwatched_count: 2 },
    // All three share a month.
    { axis: 'month', key: 'month:2026-07', label: 'July 2026',
      game_ids: [7, 8, 9], reel_count: 6, unwatched_count: 3 },
  ],
};

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

describe('CollectionsTab - derived tournament/month grouping (T5880)', () => {
  it('defaults to the flat By-game view and offers a toggle per available axis', () => {
    renderTab(SUMMARY);
    // Flat: all three games render directly.
    expect(screen.getAllByTestId('game-group').map((n) => n.textContent))
      .toEqual(['Vs Alpha', 'Vs Bravo', 'Vs Charlie']);
    // Toggle exposes exactly the axes the server produced groups for.
    const toggle = screen.getByRole('group', { name: /group reels by/i });
    expect(within(toggle).getByRole('button', { name: 'By game' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(toggle).getByRole('button', { name: 'By tournament' })).toBeTruthy();
    expect(within(toggle).getByRole('button', { name: 'By month' })).toBeTruthy();
  });

  it('groups games under a tournament heading; a game without a tournament falls to a flat list (no fabricated bucket)', () => {
    renderTab(SUMMARY);
    fireEvent.click(screen.getByRole('button', { name: 'By tournament' }));

    // The tournament heading is shown.
    const heading = screen.getByRole('button', { name: /Summer Cup/ });
    expect(heading).toBeTruthy();

    // Collapsed by default: the two tournament games are NOT yet in the DOM.
    expect(screen.queryByText('Vs Alpha')).toBeNull();
    expect(screen.queryByText('Vs Bravo')).toBeNull();
    // Charlie has no tournament -> it renders flat, always visible.
    expect(screen.getByText('Vs Charlie')).toBeTruthy();

    // Expanding the heading reveals the two nested games (two-level shape).
    fireEvent.click(heading);
    expect(screen.getByText('Vs Alpha')).toBeTruthy();
    expect(screen.getByText('Vs Bravo')).toBeTruthy();
  });

  it('groups all dated games under a month heading', () => {
    renderTab(SUMMARY);
    fireEvent.click(screen.getByRole('button', { name: 'By month' }));

    const heading = screen.getByRole('button', { name: /July 2026/ });
    expect(heading).toBeTruthy();
    // No ungrouped games this axis (all three share the month).
    expect(screen.queryByTestId('game-group')).toBeNull();

    fireEvent.click(heading);
    expect(screen.getAllByTestId('game-group').map((n) => n.textContent))
      .toEqual(['Vs Alpha', 'Vs Bravo', 'Vs Charlie']);
  });

  it('shows no toggle when the server produced no derivable groups', () => {
    renderTab({ ...SUMMARY, game_groups: [] });
    expect(screen.queryByRole('group', { name: /group reels by/i })).toBeNull();
    // Still renders the flat game list.
    expect(screen.getAllByTestId('game-group')).toHaveLength(3);
  });
});

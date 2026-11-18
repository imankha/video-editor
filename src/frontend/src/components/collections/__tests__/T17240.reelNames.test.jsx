import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// T17240:C1 -- no two reel cards on one profile share a name. "My highlights"
// eligible in both shapes rendered two cards both titled "My highlights".
vi.mock('../CollectionCard', () => ({
  CollectionCard: ({ title }) => <div data-testid="card">{title}</div>,
}));
vi.mock('../SmartLockedCard', () => ({
  SmartLockedCard: ({ name }) => <div data-testid="locked">{name}</div>,
}));
vi.mock('../RatioUnlockGroup', () => ({
  RatioUnlockGroup: ({ name }) => <div data-testid="locked">{name}</div>,
}));
vi.mock('../../shared/CollapsibleGroup', () => ({
  CollapsibleGroup: ({ children }) => <div>{children}</div>,
}));

import { CollectionsTab } from '../CollectionsTab';
import { GameCollectionGroup } from '../GameCollectionGroup';
import { toPlayerReel } from '../playerReels';
import { getProjectDisplayName } from '../../../utils/clipDisplayName';

const bothShapes = {
  reel_count: 6,
  ratio_counts: { '9:16': 3, '16:9': 3 },
  ratio_durations: { '9:16': 40, '16:9': 45 },
  ratio_eligible: { '9:16': true, '16:9': true },
  total_duration: 85, has_null_durations: false, latest_published_at: null,
};

describe('T17240:C1 reel cards never share a name', () => {
  it('names the portrait and landscape "My highlights" cards apart', () => {
    render(
      <CollectionsTab
        collections={{
          summary: {
            smart_collections: [{ ...bothShapes, key: 'top_plays', name: 'My highlights', tags: null, nudge_when_locked: true }],
            games: [], mixes: { reel_count: 0 },
          },
          summaryState: 'ready', members: {}, memberStates: {},
          fetchSummary: () => {}, fetchMembers: () => {},
        }}
        renderCard={() => null}
        onPlayCollection={() => {}}
      />,
    );
    const names = screen.getAllByTestId('card').map((el) => el.textContent);
    expect(names).toEqual(['My highlights (portrait)', 'My highlights (landscape)']);
  });

  it('names a game group\'s two shape cards apart', () => {
    render(
      <GameCollectionGroup
        name="Vs Legends Jun 6"
        collection={{
          ...bothShapes,
          ratio_eligible: { '9:16': true, '16:9': false },
        }}
        defaultExpanded
        members={[]}
        memberState="ready"
        requestMembers={() => {}}
        onPlay={() => {}}
        renderCard={() => null}
        shareScope={{ type: 'game', game_id: 1 }}
      />,
    );
    const names = [
      ...screen.getAllByTestId('card'),
      ...screen.getAllByTestId('locked'),
    ].map((el) => el.textContent);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('T17240:C2 an unnamed play shows its game plus time', () => {
  const reel = { id: 7, project_name: 'Play 1', display_name: 'Vs Oceanside 0:14', aspect_ratio: '9:16' };

  it('the reel player title uses the display name', () => {
    expect(toPlayerReel(reel).name).toBe('Vs Oceanside 0:14');
  });

  it('a draft tile uses the display name, never rewriting the stored name', () => {
    const draft = { id: 3, name: 'Play 1', display_name: 'Vs Oceanside 0:14' };
    expect(getProjectDisplayName(draft)).toBe('Vs Oceanside 0:14');
    expect(draft.name).toBe('Play 1');
  });
});

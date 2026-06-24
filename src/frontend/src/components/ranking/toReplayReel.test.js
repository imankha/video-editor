import { describe, it, expect, vi } from 'vitest';

// RankingGame pulls in stores/hooks at import time; stub the heavy children so the
// module loads in jsdom for a pure-function test of its reel mapper.
vi.mock('./ReelMatchCard', () => ({ ReelMatchCard: () => null }));
vi.mock('./HeroMatchup', () => ({ HeroMatchup: () => null }));
vi.mock('../collections/CollectionPlayer', () => ({ CollectionPlayer: () => null }));

import { toReplayReel } from './RankingGame';

describe('toReplayReel (T3940 project_id threading)', () => {
  it('carries project_id from the rank matchup side', () => {
    const reel = toReplayReel({
      id: 5,
      name: 'Reel 5',
      stream_url: '/api/downloads/5/stream',
      aspect_ratio: '9:16',
      project_id: 11,
    });
    expect(reel.id).toBe(5);
    expect(reel.project_id).toBe(11);
    expect(reel.streamUrl).toContain('/api/downloads/5/stream');
  });

  it('passes through a null/absent project_id untouched', () => {
    expect(toReplayReel({ id: 1, stream_url: '/x' }).project_id).toBeUndefined();
    expect(toReplayReel({ id: 2, stream_url: '/x', project_id: null }).project_id).toBeNull();
  });
});

import { describe, it, expect } from 'vitest';
import { compareReels, sortReels } from '../reelOrder';

const reel = (over) => ({ season_rank: null, quality_score: null, created_at: '2026-01-01T00:00:00Z', ...over });

describe('compareReels (T3630 canonical order)', () => {
  it('ranked sorts above unranked', () => {
    const ranked = reel({ season_rank: 9.0, quality_score: 1.0 });
    const unranked = reel({ quality_score: 5.0 });
    expect(compareReels(ranked, unranked)).toBeLessThan(0);
    expect(compareReels(unranked, ranked)).toBeGreaterThan(0);
  });

  it('among ranked, lower season_rank first (ascending)', () => {
    expect(compareReels(reel({ season_rank: 1.0 }), reel({ season_rank: 2.0 }))).toBeLessThan(0);
  });

  it('among unranked, higher quality_score first (descending), nulls last', () => {
    expect(compareReels(reel({ quality_score: 5.0 }), reel({ quality_score: 4.0 }))).toBeLessThan(0);
    expect(compareReels(reel({ quality_score: 4.0 }), reel({ quality_score: null }))).toBeLessThan(0);
  });

  it('ties break by recency (newer first)', () => {
    const newer = reel({ quality_score: 5.0, created_at: '2026-02-01T00:00:00Z' });
    const older = reel({ quality_score: 5.0, created_at: '2026-01-01T00:00:00Z' });
    expect(compareReels(newer, older)).toBeLessThan(0);
  });

  it('sortReels produces rank -> quality -> recency order', () => {
    const a = reel({ id: 'a', season_rank: 2.0, quality_score: 1.0 });
    const b = reel({ id: 'b', season_rank: 1.0, quality_score: 1.0 });
    const c = reel({ id: 'c', quality_score: 5.0, created_at: '2026-02-01T00:00:00Z' });
    const d = reel({ id: 'd', quality_score: 5.0, created_at: '2026-01-01T00:00:00Z' });
    const e = reel({ id: 'e', quality_score: null });
    const order = sortReels([e, c, a, d, b]).map((r) => r.id);
    expect(order).toEqual(['b', 'a', 'c', 'd', 'e']);
  });
});

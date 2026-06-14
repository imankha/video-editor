import { describe, it, expect } from 'vitest';
import { compareReels, sortReels } from '../reelOrder';

const reel = (over) => ({ rating: null, quality_score: null, created_at: '2026-01-01T00:00:00Z', ...over });

describe('compareReels (T3630 canonical order: rating-first)', () => {
  it('higher rating first (descending), nulls last', () => {
    expect(compareReels(reel({ rating: 1700 }), reel({ rating: 1500 }))).toBeLessThan(0);
    expect(compareReels(reel({ rating: 1500 }), reel({ rating: null }))).toBeLessThan(0);
    expect(compareReels(reel({ rating: null }), reel({ rating: 1500 }))).toBeGreaterThan(0);
  });

  it('equal rating breaks by quality_score (descending, nulls last)', () => {
    expect(compareReels(
      reel({ rating: 1500, quality_score: 5.0 }),
      reel({ rating: 1500, quality_score: 4.0 }),
    )).toBeLessThan(0);
    expect(compareReels(
      reel({ rating: 1500, quality_score: 4.0 }),
      reel({ rating: 1500, quality_score: null }),
    )).toBeLessThan(0);
  });

  it('ties break by recency (newer first)', () => {
    const newer = reel({ rating: 1500, quality_score: 5.0, created_at: '2026-02-01T00:00:00Z' });
    const older = reel({ rating: 1500, quality_score: 5.0, created_at: '2026-01-01T00:00:00Z' });
    expect(compareReels(newer, older)).toBeLessThan(0);
  });

  it('sortReels produces rating -> quality -> recency order', () => {
    const a = reel({ id: 'a', rating: 1700 });
    const b = reel({ id: 'b', rating: 1800 });
    const c = reel({ id: 'c', rating: 1500, quality_score: 5.0, created_at: '2026-02-01T00:00:00Z' });
    const d = reel({ id: 'd', rating: 1500, quality_score: 5.0, created_at: '2026-01-01T00:00:00Z' });
    const e = reel({ id: 'e', rating: null });
    const order = sortReels([e, c, a, d, b]).map((r) => r.id);
    expect(order).toEqual(['b', 'a', 'c', 'd', 'e']);
  });
});

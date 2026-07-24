import { describe, it, expect, vi } from 'vitest';

// jsdom lacks matchMedia (useIsMobile) — stub it, since ProjectManager.jsx
// imports several hooks/components at module scope that touch it indirectly.
vi.mock('../hooks/useIsMobile', () => ({
  useIsMobile: () => false,
  useIsLandscape: () => false,
}));

import { splitByAspect } from './ProjectManager';

/**
 * splitByAspect (T5672) - the grouping split behind the "one carousel row per
 * aspect ratio present" feature: a game with both 9:16 and 16:9 drafts must
 * render two rows (portrait first), while a single-aspect game must produce
 * exactly one bucket so it renders identically to before the split.
 */
describe('splitByAspect (T5672 aspect-split rows)', () => {
  const portrait = (id) => ({ id, aspect_ratio: '9:16' });
  const landscape = (id) => ({ id, aspect_ratio: '16:9' });

  it('returns a single portrait-only bucket for an all-portrait list (no extra chrome case)', () => {
    const result = splitByAspect([portrait(1), portrait(2)]);
    expect(result).toHaveLength(1);
    expect(result[0].ratio).toBe('9:16');
    expect(result[0].projects).toHaveLength(2);
  });

  it('returns a single landscape-only bucket for an all-landscape list', () => {
    const result = splitByAspect([landscape(1), landscape(2)]);
    expect(result).toHaveLength(1);
    expect(result[0].ratio).toBe('16:9');
    expect(result[0].projects).toHaveLength(2);
  });

  it('splits a mixed list into two buckets, portrait first', () => {
    const result = splitByAspect([landscape(1), portrait(2), landscape(3), portrait(4)]);
    expect(result).toHaveLength(2);
    expect(result[0].ratio).toBe('9:16');
    expect(result[0].projects.map(p => p.id)).toEqual([2, 4]);
    expect(result[1].ratio).toBe('16:9');
    expect(result[1].projects.map(p => p.id)).toEqual([1, 3]);
  });

  it('defaults a missing aspect_ratio to portrait (matches the filter-count fallback)', () => {
    const result = splitByAspect([{ id: 1, aspect_ratio: undefined }]);
    expect(result).toHaveLength(1);
    expect(result[0].ratio).toBe('9:16');
  });

  it('returns an empty array for an empty list (no empty rows)', () => {
    expect(splitByAspect([])).toEqual([]);
  });
});

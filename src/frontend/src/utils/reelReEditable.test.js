import { describe, it, expect } from 'vitest';
import { canReEditReel } from './reelReEditable';

describe('canReEditReel (T11220)', () => {
  it('allows a single-clip reel with an editable project', () => {
    expect(canReEditReel({ project_id: 7, clip_count: 1 })).toBe(true);
  });

  it('allows an unknown clip_count reel (NULL/undefined — possible legacy single-clip)', () => {
    expect(canReEditReel({ project_id: 7, clip_count: null })).toBe(true);
    expect(canReEditReel({ project_id: 7 })).toBe(true);
  });

  it('BLOCKS a legacy multi-clip reel (clip_count > 1)', () => {
    expect(canReEditReel({ project_id: 7, clip_count: 2 })).toBe(false);
    expect(canReEditReel({ project_id: 7, clip_count: 12 })).toBe(false);
  });

  it('blocks a non-editable export (project_id null/0/absent) regardless of clip_count', () => {
    expect(canReEditReel({ project_id: null, clip_count: 1 })).toBe(false);
    expect(canReEditReel({ project_id: 0, clip_count: 1 })).toBe(false);
    expect(canReEditReel({ clip_count: 1 })).toBe(false);
    expect(canReEditReel(null)).toBe(false);
    expect(canReEditReel(undefined)).toBe(false);
  });
});

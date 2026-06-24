import { describe, it, expect } from 'vitest';
import { toPlayerReel, toPlayerReels } from './playerReels';

describe('toPlayerReel (T3940 project_id threading)', () => {
  it('carries project_id so the in-player Re-edit button can open the reel', () => {
    const reel = toPlayerReel({
      id: 42,
      project_name: 'Goal vs Carlsbad',
      aspect_ratio: '9:16',
      duration: 12,
      project_id: 7,
    });
    expect(reel.id).toBe(42);
    expect(reel.project_id).toBe(7);
    expect(reel.streamUrl).toContain('/api/downloads/42/stream');
  });

  it('passes through a null/absent project_id (non-editable export) untouched', () => {
    expect(toPlayerReel({ id: 1, project_id: null }).project_id).toBeNull();
    expect(toPlayerReel({ id: 2 }).project_id).toBeUndefined();
    expect(toPlayerReel({ id: 3, project_id: 0 }).project_id).toBe(0);
  });

  it('maps each item via toPlayerReels', () => {
    const reels = toPlayerReels([{ id: 1, project_id: 9 }, { id: 2, project_id: 0 }]);
    expect(reels.map((r) => r.project_id)).toEqual([9, 0]);
  });
});

import { describe, it, expect } from 'vitest';
import { resolveInheritedNewClipLayer } from './useAnnotate';

// T6400: a new clip inherits the layer of the game's MOST RECENTLY CREATED own
// clip (highest raw_clip id), ignoring imported clips (shared_by set). Empty /
// only-imported games fall back to My Athlete. `true` = My Athlete, `false` = Team.
// Annotations are the raw /load shape: { id, my_athlete (bool), shared_by }.
describe('resolveInheritedNewClipLayer (T6400)', () => {
  it('empty game -> My Athlete (true)', () => {
    expect(resolveInheritedNewClipLayer([])).toBe(true);
    expect(resolveInheritedNewClipLayer(null)).toBe(true);
    expect(resolveInheritedNewClipLayer(undefined)).toBe(true);
  });

  it('most recent (highest id) clip is Team -> new clip defaults to Team (false)', () => {
    const annotations = [
      { id: 10, my_athlete: true },
      { id: 42, my_athlete: false }, // highest id, Team
      { id: 7, my_athlete: true },
    ];
    expect(resolveInheritedNewClipLayer(annotations)).toBe(false);
  });

  it('most recent (highest id) clip is My Athlete -> new clip defaults to My Athlete (true)', () => {
    const annotations = [
      { id: 10, my_athlete: false },
      { id: 42, my_athlete: true }, // highest id, My Athlete
      { id: 7, my_athlete: false },
    ];
    expect(resolveInheritedNewClipLayer(annotations)).toBe(true);
  });

  it('legacy NULL my_athlete counts as My Athlete (never a truthiness check on the bit)', () => {
    expect(resolveInheritedNewClipLayer([{ id: 5, my_athlete: null }])).toBe(true);
    expect(resolveInheritedNewClipLayer([{ id: 5 }])).toBe(true); // field absent
  });

  it('an imported clip (shared_by set) being the most recent does NOT drag the default to Team', () => {
    const annotations = [
      { id: 10, my_athlete: false }, // own Team clip, older
      { id: 99, my_athlete: false, shared_by: 'Dana Smith' }, // imported, highest id -> ignored
    ];
    // Falls through to the most recent OWN clip (id 10, Team).
    expect(resolveInheritedNewClipLayer(annotations)).toBe(false);
  });

  it('a game whose only clips are imported -> My Athlete (no own-clip signal)', () => {
    const annotations = [
      { id: 3, my_athlete: false, shared_by: 'Coach' },
      { id: 8, my_athlete: false, shared_by: 'Dana Smith' },
    ];
    expect(resolveInheritedNewClipLayer(annotations)).toBe(true);
  });

  it('accepts the raw_clip_id / rawClipId aliases for the id field', () => {
    expect(resolveInheritedNewClipLayer([
      { raw_clip_id: 1, my_athlete: true },
      { raw_clip_id: 2, my_athlete: false },
    ])).toBe(false);
    expect(resolveInheritedNewClipLayer([
      { rawClipId: 1, my_athlete: false },
      { rawClipId: 2, my_athlete: true },
    ])).toBe(true);
  });

  it('ignores own clips with no id yet (unsaved legacy rows), still resolves from the rest', () => {
    const annotations = [
      { my_athlete: false }, // no id -> skipped
      { id: 5, my_athlete: true },
    ];
    expect(resolveInheritedNewClipLayer(annotations)).toBe(true);
  });
});

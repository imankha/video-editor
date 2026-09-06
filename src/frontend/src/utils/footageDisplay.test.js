import { describe, it, expect } from 'vitest';
import { overlapGroups, shortLabel } from './footageDisplay';

// T8822 — overlapGroups: light-touch overlap detection for the upload confirm list.
// Purely informational (not the real lane/angle system T8880/T8890 build in Annotate),
// so it only trusts confidence === 'time' and reads straight off creationTime/duration.

function item(name, { duration = 60, creationTime = null } = {}) {
  return { name, size: 1024, duration, creationTime, file: new File(['x'], name) };
}

describe('overlapGroups', () => {
  it('returns empty when confidence is not "time"', () => {
    const base = new Date('2026-09-05T14:00:00');
    const order = [
      item('a.mp4', { duration: 1500, creationTime: base }),
      item('b.mp4', { duration: 600, creationTime: new Date('2026-09-05T14:10:00') }),
    ];
    expect(overlapGroups(order, 'name').size).toBe(0);
    expect(overlapGroups(order, 'unknown').size).toBe(0);
    expect(overlapGroups(order, 'manual').size).toBe(0);
  });

  it('flags two items whose [creationTime, creationTime+duration) ranges intersect', () => {
    const base = new Date('2026-09-05T14:00:00');
    const order = [
      item('main.mp4', { duration: 1500, creationTime: base }), // 14:00-14:25
      item('phone.mp4', { duration: 600, creationTime: new Date('2026-09-05T14:10:00') }), // 14:10-14:20
    ];
    const groups = overlapGroups(order, 'time');
    expect(groups.get('main.mp4')).toEqual(['phone.mp4']);
    expect(groups.get('phone.mp4')).toEqual(['main.mp4']);
  });

  it('does not flag adjacent, non-overlapping segments', () => {
    const order = [
      item('a.mp4', { duration: 480, creationTime: new Date('2026-09-05T14:00:00') }), // ends 14:08
      item('b.mp4', { duration: 480, creationTime: new Date('2026-09-05T14:08:00') }), // starts exactly at a's end
    ];
    expect(overlapGroups(order, 'time').size).toBe(0);
  });

  it('ignores items with no reliable time evidence (null creationTime or duration)', () => {
    const order = [
      item('a.mp4', { duration: 1500, creationTime: new Date('2026-09-05T14:00:00') }),
      item('b.mp4', { duration: null, creationTime: null }),
    ];
    expect(overlapGroups(order, 'time').size).toBe(0);
  });

  it('flags one item overlapping with multiple others', () => {
    const base = new Date('2026-09-05T14:00:00');
    const order = [
      item('main.mp4', { duration: 3000, creationTime: base }), // 14:00-14:50, spans both halves
      item('phone1.mp4', { duration: 300, creationTime: new Date('2026-09-05T14:05:00') }),
      item('phone2.mp4', { duration: 300, creationTime: new Date('2026-09-05T14:40:00') }),
    ];
    const groups = overlapGroups(order, 'time');
    expect(groups.get('main.mp4')).toEqual(['phone1.mp4', 'phone2.mp4']);
    expect(groups.get('phone1.mp4')).toEqual(['main.mp4']);
    expect(groups.get('phone2.mp4')).toEqual(['main.mp4']);
  });
});

describe('shortLabel', () => {
  it('returns the filename stem unchanged when 14 chars or fewer', () => {
    expect(shortLabel('clip.mp4')).toBe('clip');
  });

  it('middle-ellipsis-truncates a long stem to 14 characters total', () => {
    const label = shortLabel('DJI_20260718120831_0006_D.MP4');
    expect(label.length).toBe(14);
    expect(label).toContain('…');
    expect(label.startsWith('DJI_202')).toBe(true);
    expect(label.endsWith('0006_D')).toBe(true);
  });
});

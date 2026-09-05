/**
 * T8800 — useFootageIntake hook tests (probe queue, merge, exclusions).
 * extractVideoMetadata is mocked so no real <video>/blob parsing runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// Per-test probe behaviour, keyed by file name.
const probeResults = new Map();
vi.mock('../utils/videoMetadata', () => ({
  extractVideoMetadata: vi.fn(async (file) => {
    const r = probeResults.get(file.name);
    if (r === 'throw') throw new Error('probe failed');
    return r ?? { duration: 60, creationTime: null };
  }),
}));

import { useFootageIntake } from './useFootageIntake';

const mkFile = (name, { type = 'video/mp4', size = 1000 } = {}) => ({ name, type, size });

beforeEach(() => {
  probeResults.clear();
});

describe('useFootageIntake', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useFootageIntake());
    expect(result.current.status).toBe('empty');
    expect(result.current.items).toEqual([]);
    expect(result.current.order).toEqual([]);
  });

  it('filters junk into skipped and pairs .LRF proxies, probing only videos', async () => {
    const { result } = renderHook(() => useFootageIntake());
    await act(async () => {
      await result.current.addFiles([
        mkFile('DJI_0003.MP4', { type: '' }),
        mkFile('DJI_0003.LRF', { type: '' }),
        mkFile('poster.jpg', { type: 'image/jpeg' }),
        mkFile('notes.txt', { type: '' }),
      ]);
    });
    expect(result.current.status).toBe('ready');
    expect(result.current.items.map((i) => i.name)).toEqual(['DJI_0003.MP4']);
    expect(result.current.proxies).toEqual({
      'DJI_0003.MP4': expect.objectContaining({ name: 'DJI_0003.LRF' }),
    });
    expect(result.current.skipped).toEqual(expect.arrayContaining(['poster.jpg', 'notes.txt']));
    expect(result.current.skipped).not.toContain('DJI_0003.LRF'); // proxy, not skipped
  });

  it('routes junk-that-looks-like-video (zero-byte, ._ fork) to skipped, never probes it', async () => {
    const { result } = renderHook(() => useFootageIntake());
    await act(async () => {
      await result.current.addFiles([
        mkFile('real.mp4', { type: '' }),
        mkFile('empty.mp4', { type: '', size: 0 }), // zero-byte
        mkFile('._real.mp4', { type: '' }), // AppleDouble fork
      ]);
    });
    expect(result.current.items.map((i) => i.name)).toEqual(['real.mp4']);
    expect(result.current.skipped).toEqual(expect.arrayContaining(['empty.mp4', '._real.mp4']));
  });

  it('excludes a file whose probe throws from order but keeps it in items', async () => {
    probeResults.set('good.mp4', { duration: 60, creationTime: null });
    probeResults.set('bad.mp4', 'throw');
    const { result } = renderHook(() => useFootageIntake());
    await act(async () => {
      await result.current.addFiles([mkFile('good.mp4'), mkFile('bad.mp4')]);
    });
    expect(result.current.items.map((i) => i.name)).toEqual(['good.mp4', 'bad.mp4']);
    expect(result.current.items.find((i) => i.name === 'bad.mp4').probeError).toBe(true);
    expect(result.current.order.map((i) => i.name)).toEqual(['good.mp4']);
  });

  it('dedupes on add-more and reports the duplicate name', async () => {
    probeResults.set('a.mp4', { duration: 5, creationTime: null });
    const { result } = renderHook(() => useFootageIntake());
    await act(async () => {
      await result.current.addFiles([mkFile('a.mp4', { size: 10 })]);
    });
    let ret;
    await act(async () => {
      ret = await result.current.addFiles([mkFile('a.mp4', { size: 10 })]); // same key
    });
    expect(ret.duplicates).toEqual(['a.mp4']);
    expect(result.current.items).toHaveLength(1);
  });

  it('setManualOrder reorders and marks confidence "manual", dropping probe errors', async () => {
    probeResults.set('x.mp4', { duration: 5, creationTime: null });
    probeResults.set('y.mp4', { duration: 5, creationTime: null });
    probeResults.set('z.mp4', 'throw');
    const { result } = renderHook(() => useFootageIntake());
    await act(async () => {
      await result.current.addFiles([mkFile('x.mp4'), mkFile('y.mp4'), mkFile('z.mp4')]);
    });
    act(() => {
      result.current.setManualOrder(['y.mp4', 'x.mp4', 'z.mp4']);
    });
    expect(result.current.confidence).toBe('manual');
    expect(result.current.order.map((i) => i.name)).toEqual(['y.mp4', 'x.mp4']);
  });

  it('setManualOrder clears the time-chain gaps (afterIndex is meaningless once hand-ordered)', async () => {
    // A real time chain with a halftime gap: seg1 (5 min) then seg2 starting
    // 20 min later -> a gap after index 0. inferOrder yields confidence "time".
    const t0 = new Date('2026-09-05T14:00:00');
    const t1 = new Date('2026-09-05T14:20:00');
    probeResults.set('seg1.mp4', { duration: 300, creationTime: t0 });
    probeResults.set('seg2.mp4', { duration: 300, creationTime: t1 });
    const { result } = renderHook(() => useFootageIntake());
    await act(async () => {
      await result.current.addFiles([mkFile('seg1.mp4'), mkFile('seg2.mp4')]);
    });
    expect(result.current.confidence).toBe('time');
    expect(result.current.gaps).toHaveLength(1); // the halftime break

    act(() => {
      result.current.setManualOrder(['seg2.mp4', 'seg1.mp4']);
    });
    // Stale gaps would draw a break connector between the newly-adjacent segments.
    expect(result.current.gaps).toEqual([]);
  });

  it('removeItem drops an item and recomputes order', async () => {
    probeResults.set('a.mp4', { duration: 5, creationTime: null });
    probeResults.set('b.mp4', { duration: 5, creationTime: null });
    const { result } = renderHook(() => useFootageIntake());
    await act(async () => {
      await result.current.addFiles([mkFile('a.mp4'), mkFile('b.mp4')]);
    });
    act(() => {
      result.current.removeItem('a.mp4');
    });
    expect(result.current.items.map((i) => i.name)).toEqual(['b.mp4']);
    expect(result.current.order.map((i) => i.name)).toEqual(['b.mp4']);
  });

  it('reset clears everything', async () => {
    probeResults.set('a.mp4', { duration: 5, creationTime: null });
    const { result } = renderHook(() => useFootageIntake());
    await act(async () => {
      await result.current.addFiles([mkFile('a.mp4')]);
    });
    act(() => {
      result.current.reset();
    });
    expect(result.current.status).toBe('empty');
    expect(result.current.items).toEqual([]);
    expect(result.current.proxies).toEqual({});
    expect(result.current.skipped).toEqual([]);
  });
});

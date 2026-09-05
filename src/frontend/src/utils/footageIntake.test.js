/**
 * T8800 — footage intake pure-function tests.
 *
 * Fixtures mirror the three real folders probed 2026-09-05 (EPIC.md evidence
 * table) as synthetic name/duration/creationTime tuples — we never commit
 * multi-GB videos.
 */
import { describe, it, expect } from 'vitest';
import {
  isJunkFile,
  isVideoFile,
  pairProxies,
  inferOrder,
  dedupeKey,
  CHAIN_TOLERANCE_S,
  GAP_MIN_S,
} from './footageIntake';

// Build a Date from UTC wall-clock components (avoids local-tz drift in CI).
const at = (h, m, s) => new Date(Date.UTC(2026, 8, 5, h, m, s));

describe('isJunkFile', () => {
  it('flags proxy/subtitle/thumbnail/image extensions, case-insensitively', () => {
    for (const name of ['DJI_0003.LRF', 'clip.THM', 'subs.srt', 'a.JPG', 'b.jpeg', 'c.png', 'd.heic', 'e.gif']) {
      expect(isJunkFile({ name, size: 100 })).toBe(true);
    }
  });
  it('flags hidden dotfiles and AppleDouble resource forks', () => {
    expect(isJunkFile({ name: '.DS_Store', size: 100 })).toBe(true);
    expect(isJunkFile({ name: '._DJI_0003.MP4', size: 100 })).toBe(true);
  });
  it('flags zero-byte files', () => {
    expect(isJunkFile({ name: 'empty.mp4', size: 0 })).toBe(true);
  });
  it('does not flag real videos', () => {
    expect(isJunkFile({ name: 'DJI_0003.MP4', size: 5000 })).toBe(false);
  });
});

describe('isVideoFile', () => {
  it('accepts any video/* MIME', () => {
    expect(isVideoFile({ name: 'x.mp4', type: 'video/mp4' })).toBe(true);
    expect(isVideoFile({ name: 'x.mov', type: 'video/quicktime' })).toBe(true);
  });
  it('accepts an empty-MIME file by extension (folder-drop case)', () => {
    expect(isVideoFile({ name: 'DJI_0003.MP4', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'clip.mov', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'clip.webm', type: '' })).toBe(true);
    expect(isVideoFile({ name: 'clip.m4v', type: '' })).toBe(true);
  });
  it('rejects an empty-MIME non-video extension', () => {
    expect(isVideoFile({ name: 'notes.txt', type: '' })).toBe(false);
    expect(isVideoFile({ name: 'DJI_0003.LRF', type: '' })).toBe(false);
  });
  it('rejects a non-video MIME even with a video extension', () => {
    expect(isVideoFile({ name: 'evil.mp4', type: 'image/png' })).toBe(false);
  });
});

describe('pairProxies', () => {
  it('routes an .LRF to proxies keyed by its matching video, keeps it out of videos', () => {
    const mp4 = { name: 'DJI_0003.MP4', type: 'video/mp4' };
    const lrf = { name: 'DJI_0003.LRF', type: '' };
    const { videos, proxies } = pairProxies([mp4, lrf]);
    expect(videos).toEqual([mp4]);
    expect(proxies).toEqual({ 'DJI_0003.MP4': lrf });
  });
  it('drops an unmatched .LRF (no video with that basename)', () => {
    const lrf = { name: 'ORPHAN.LRF', type: '' };
    const { videos, proxies } = pairProxies([lrf]);
    expect(videos).toEqual([]);
    expect(proxies).toEqual({});
  });
});

describe('inferOrder', () => {
  it('DJI chain -> confidence "time", ordered 0003..0006, one ~529s gap after index 1', () => {
    // Times 17:55:44 / 18:19:15 / 18:44:59 / 19:08:32, durations 1410/1013/1411/273.
    const items = [
      { name: 'DJI_0005.MP4', duration: 1411, creationTime: at(18, 44, 59) },
      { name: 'DJI_0003.MP4', duration: 1410, creationTime: at(17, 55, 44) },
      { name: 'DJI_0006.MP4', duration: 273, creationTime: at(19, 8, 32) },
      { name: 'DJI_0004.MP4', duration: 1013, creationTime: at(18, 19, 15) },
    ];
    const { order, confidence, gaps } = inferOrder(items);
    expect(confidence).toBe('time');
    expect(order.map((i) => i.name)).toEqual([
      'DJI_0003.MP4',
      'DJI_0004.MP4',
      'DJI_0005.MP4',
      'DJI_0006.MP4',
    ]);
    expect(gaps).toHaveLength(1);
    expect(gaps[0].afterIndex).toBe(1);
    expect(gaps[0].seconds).toBeGreaterThan(500);
    expect(gaps[0].seconds).toBeLessThan(560);
  });

  it('Legends overlap -> timestamps discarded, half-words decide -> "name", 1st-half first', () => {
    // Export times overlap by ~32 min AND run reverse to filename order, proving
    // timestamps are dropped wholesale and the half-word names win.
    const items = [
      { name: '2nd-half.mp4', duration: 2700, creationTime: at(10, 0, 0) },
      { name: '1st-half.mp4', duration: 2700, creationTime: at(10, 13, 0) },
    ];
    const { order, confidence, gaps } = inferOrder(items);
    expect(confidence).toBe('name');
    expect(order.map((i) => i.name)).toEqual(['1st-half.mp4', '2nd-half.mp4']);
    expect(gaps).toEqual([]);
  });

  it('ambiguous names, no creationTime -> confidence "unknown", natural name order', () => {
    const items = [
      { name: 'b.mp4', duration: 60, creationTime: null },
      { name: 'a.mp4', duration: 60, creationTime: null },
    ];
    const { order, confidence } = inferOrder(items);
    expect(confidence).toBe('unknown');
    expect(order.map((i) => i.name)).toEqual(['a.mp4', 'b.mp4']);
  });

  it('one missing timestamp -> time tier skipped, counter names decide -> "name"', () => {
    const items = [
      { name: 'DJI_0002.MP4', duration: 60, creationTime: at(10, 5, 0) },
      { name: 'DJI_0003.MP4', duration: 60, creationTime: null }, // missing
      { name: 'DJI_0001.MP4', duration: 60, creationTime: at(10, 0, 0) },
    ];
    const { order, confidence } = inferOrder(items);
    expect(confidence).toBe('name');
    expect(order.map((i) => i.name)).toEqual(['DJI_0001.MP4', 'DJI_0002.MP4', 'DJI_0003.MP4']);
  });

  it('a continuous chain with no big gap reports no gaps', () => {
    const items = [
      { name: 'a.mp4', duration: 60, creationTime: at(10, 0, 0) },
      { name: 'b.mp4', duration: 60, creationTime: at(10, 1, 0) }, // starts exactly at prev end
    ];
    const { confidence, gaps } = inferOrder(items);
    expect(confidence).toBe('time');
    expect(gaps).toEqual([]);
  });

  it('tolerates a small overlap within CHAIN_TOLERANCE_S (still "time")', () => {
    const items = [
      { name: 'a.mp4', duration: 100, creationTime: at(10, 0, 0) },
      // next starts 30s before prev end -> within the 120s tolerance
      { name: 'b.mp4', duration: 100, creationTime: at(10, 1, 10) },
    ];
    expect(CHAIN_TOLERANCE_S).toBe(120);
    expect(inferOrder(items).confidence).toBe('time');
  });

  it('handles the empty set', () => {
    expect(inferOrder([])).toEqual({ order: [], confidence: 'unknown', gaps: [] });
  });

  it('exposes GAP_MIN_S as 120', () => {
    expect(GAP_MIN_S).toBe(120);
  });
});

describe('dedupeKey', () => {
  it('is name|size|duration', () => {
    expect(dedupeKey({ name: 'a.mp4', size: 10, duration: 5 })).toBe('a.mp4|10|5');
  });
  it('matches identical files and distinguishes different ones', () => {
    const a = { name: 'a.mp4', size: 10, duration: 5 };
    const aCopy = { name: 'a.mp4', size: 10, duration: 5 };
    const b = { name: 'a.mp4', size: 11, duration: 5 };
    expect(dedupeKey(a)).toBe(dedupeKey(aCopy));
    expect(dedupeKey(a)).not.toBe(dedupeKey(b));
  });
});

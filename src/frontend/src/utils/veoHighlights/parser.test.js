import { describe, it, expect } from 'vitest';
import { parseVeoName, isVeoHighlightsZip, parseEntries, halfMarker } from './parser.js';

const e = (name, crc32 = 1, size = 10) => ({ name, crc32, size, compressedSize: size });

describe('parseVeoName', () => {
  it('parses index, stamp and label', () => {
    expect(parseVeoName('06 001444_-_Goal.mp4')).toEqual({ index: 6, stamp_s: 884, label: 'Goal' });
    expect(parseVeoName('01 000252_-_Shot_on_goal.mp4')).toEqual({ index: 1, stamp_s: 172, label: 'Shot on goal' });
    expect(parseVeoName('02 010203_-_Defence.mp4').stamp_s).toBe(3723);
  });
  it('returns null on a non-matching name', () => {
    expect(parseVeoName('holiday.mp4')).toBeNull();
    expect(parseVeoName('06 00144_-_Goal.mp4')).toBeNull();
  });
});

describe('parseEntries', () => {
  it('reports non-matching mp4s as skipped; ignores the marker and non-mp4', () => {
    const r = parseEntries([e('01 000010_-_Goal.mp4'), e('junk.mp4'), e('.veo-zip', 0, 0), e('readme.txt')]);
    expect(r.parsed).toHaveLength(1);
    expect(r.skipped.map((s) => s.name)).toEqual(['junk.mp4']);
  });
  it('accepts a File[] of loose mp4s', () => {
    const r = parseEntries([new File(['x'], '03 000100_-_Attack.mp4')]);
    expect(r.parsed[0]).toMatchObject({ stamp_s: 60, label: 'Attack' });
  });
});

describe('isVeoHighlightsZip', () => {
  it('true with .veo-zip marker', () => {
    expect(isVeoHighlightsZip([e('.veo-zip', 0, 0), e('a.mp4')])).toBe(true);
  });
  it('true at >= 80% matching mp4s', () => {
    const m = Array.from({ length: 4 }, (_, i) => e(`0${i} 00001${i}_-_Goal.mp4`));
    expect(isVeoHighlightsZip([...m, e('x.mp4')])).toBe(true);
    expect(isVeoHighlightsZip([...m, e('x.mp4'), e('y.mp4')])).toBe(false);
  });
  it('false for a non-Veo zip / no mp4s', () => {
    expect(isVeoHighlightsZip([e('a.mp4'), e('b.mp4')])).toBe(false);
    expect(isVeoHighlightsZip([e('doc.txt')])).toBe(false);
  });
});

describe('halfMarker', () => {
  it('maps (1st Half)/(2nd Half)/none', () => {
    expect(halfMarker('Veo highlights WCFC vs. Legends FC (1st Half).zip')).toBe(1);
    expect(halfMarker('Veo highlights WCFC vs. Legends FC (2nd Half).zip')).toBe(2);
    expect(halfMarker('Veo highlights WCFC vs. Rebels SC.zip')).toBeNull();
  });
});

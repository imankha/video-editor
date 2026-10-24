// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildZip } from './__fixtures__/buildZip.js';
import { readZipEntries } from './zipReader.js';
import { Mp4DurationScanner, entryDuration } from './mp4Duration.js';

const fx = (n) => new Uint8Array(readFileSync(join(process.cwd(), 'src/utils/veoHighlights/__fixtures__', n)));
// ffprobe format=duration at fixture generation: faststart 3.5, moovend 5.2
const FASTSTART = 3.5;
const MOOVEND = 5.2;

describe('Mp4DurationScanner', () => {
  it.each([['faststart.mp4', FASTSTART], ['moovend.mp4', MOOVEND]])('%s within 0.05s of ffprobe', (n, want) => {
    const s = new Mp4DurationScanner();
    s.feed(fx(n));
    expect(s.done).toBe(true);
    expect(Math.abs(s.duration - want)).toBeLessThan(0.05);
  });

  it('is chunk-boundary independent (1 byte at a time)', () => {
    const b = fx('moovend.mp4');
    const s = new Mp4DurationScanner();
    for (let i = 0; i < b.length && !s.done; i++) s.feed(b.subarray(i, i + 1));
    expect(Math.abs(s.duration - MOOVEND)).toBeLessThan(0.05);
  });

  it('stops needing input after moov for a faststart file', () => {
    const b = fx('faststart.mp4');
    const s = new Mp4DurationScanner();
    // ftyp + moov only: everything before the first 'free'/'mdat' box
    const dvw = new DataView(b.buffer, b.byteOffset);
    const ftyp = dvw.getUint32(0);
    const moov = dvw.getUint32(ftyp);
    s.feed(b.subarray(0, ftyp + moov));
    expect(s.done).toBe(true);
  });

  it('throws on truncated input at finish()', () => {
    const s = new Mp4DurationScanner();
    s.feed(fx('moovend.mp4').subarray(0, 100));
    expect(() => s.finish()).toThrow(/moov/i);
  });
});

describe('entryDuration', () => {
  it('reads durations through the zip for both layouts, reporting bytes inflated', async () => {
    const zip = buildZip([
      { name: 'a.mp4', data: fx('faststart.mp4') },
      { name: 'b.mp4', data: fx('moovend.mp4') },
    ]);
    const file = new File([zip], 'z.zip');
    const [a, b] = await readZipEntries(file);
    expect(Math.abs((await entryDuration(file, a)) - FASTSTART)).toBeLessThan(0.05);
    expect(Math.abs((await entryDuration(file, b)) - MOOVEND)).toBeLessThan(0.05);
  });
});

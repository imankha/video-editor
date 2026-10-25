// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildZip } from './__fixtures__/buildZip.js';
import { faststartMp4, moovendMp4 } from './__fixtures__/buildMp4.js';
import { readZipEntries, extractEntry } from './zipReader.js';

const fx = (n) => (n === 'faststart.mp4' ? faststartMp4() : moovendMp4());
const toFile = (u8, name = 'x.zip') => new File([u8], name);
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());

describe('zipReader', () => {
  const payload = fx('moovend.mp4');
  const files = [
    { name: '01 000252_-_Shot_on_goal.mp4', data: payload },
    { name: '.veo-zip', data: new Uint8Array(0), method: 0 },
    { name: '02 000300_-_Goal.mp4', data: new Uint8Array(1000).fill(7), method: 0 },
  ];

  for (const zip64 of [false, true]) {
    it(`lists entries with crc/size (zip64=${zip64})`, async () => {
      const entries = await readZipEntries(toFile(buildZip(files, { zip64 })));
      expect(entries.map((e) => e.name)).toEqual(files.map((f) => f.name));
      expect(entries[0].size).toBe(payload.length);
      expect(entries[0].compressedSize).toBeGreaterThan(0);
      expect(entries[0].crc32).toBeTypeOf('number');
      expect(entries[2].compressedSize).toBe(1000);
    });

    it(`extractEntry round-trips bytes (zip64=${zip64})`, async () => {
      const file = toFile(buildZip(files, { zip64 }));
      const entries = await readZipEntries(file);
      const out = await extractEntry(file, entries[0]);
      expect(out).toBeInstanceOf(File);
      expect(out.name).toBe('01 000252_-_Shot_on_goal.mp4');
      expect(await bytesOf(out)).toEqual(payload);
      expect(await bytesOf(await extractEntry(file, entries[2]))).toEqual(new Uint8Array(1000).fill(7));
    });
  }

  it('rejects a non-zip', async () => {
    await expect(readZipEntries(toFile(new Uint8Array(100)))).rejects.toThrow(/not a zip/i);
  });
});

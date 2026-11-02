// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { buildZip } from './veoHighlights/__fixtures__/buildZip.js';
import { expandClipZips } from './zipClips.js';

// T13247: Upload takes any zip of clips. A Veo zip keeps its own path; any other zip is
// unzipped into loose video Files, exactly as if they had been picked one by one.
const enc = new TextEncoder();
const bytes = (s) => enc.encode(s);
const zipFile = (entries, name = 'clips.zip') => new File([buildZip(entries)], name, { type: 'application/zip' });
const text = async (f) => new TextDecoder().decode(new Uint8Array(await f.arrayBuffer()));

describe('expandClipZips (T13247)', () => {
  it('hands a Veo highlights zip to the Veo path, untouched', async () => {
    const veo = zipFile([
      { name: '.veo-zip', data: new Uint8Array(0), method: 0 },
      { name: '01 000252_-_Shot_on_goal.mp4', data: bytes('a') },
    ], 'Veo highlights A vs. B.zip');
    const r = await expandClipZips([veo]);
    expect(r.veoZips).toEqual([veo]);
    expect(r.files).toEqual([]);
    expect(r.messages).toEqual([]);
  });

  it('unzips a plain zip of clips into Files with base names, skipping junk, merged with loose files', async () => {
    const zip = zipFile([
      { name: 'IMG_0001.mp4', data: bytes('one') },
      { name: 'trip/IMG_0002.MOV', data: bytes('two'), method: 0 },
      { name: 'trip/', data: new Uint8Array(0), method: 0 },
      { name: '__MACOSX/trip/._IMG_0002.MOV', data: bytes('junk') },
      { name: '.DS_Store', data: bytes('junk') },
      { name: 'trip/._IMG_0003.mp4', data: bytes('junk') },
      { name: 'trip/IMG_0004.webm', data: bytes('four') },
      { name: 'IMG_0005.m4v', data: bytes('five') },
      { name: 'cover.jpg', data: bytes('photo') },
    ]);
    const loose = new File(['v'], 'half.mp4', { type: 'video/mp4' });
    const r = await expandClipZips([loose, zip]);
    expect(r.veoZips).toEqual([]);
    expect(r.messages).toEqual([]);
    expect(r.files.map((f) => f.name)).toEqual(['half.mp4', 'IMG_0001.mp4', 'IMG_0002.MOV', 'IMG_0004.webm', 'IMG_0005.m4v']);
    expect(r.files.map((f) => f.type)).toEqual(['video/mp4', 'video/mp4', 'video/quicktime', 'video/webm', 'video/mp4']);
    expect(await text(r.files[1])).toBe('one');
    expect(await text(r.files[2])).toBe('two');
  });

  it('a zip with no videos says so and yields nothing', async () => {
    const r = await expandClipZips([zipFile([{ name: 'a.jpg', data: bytes('p') }, { name: 'b.png', data: bytes('q') }])]);
    expect(r.files).toEqual([]);
    expect(r.veoZips).toEqual([]);
    expect(r.messages).toEqual(['This zip has no videos in it.']);
  });

  it('skips an entry over the cap with a named line, never a silent drop', async () => {
    const zip = zipFile([{ name: 'big.mp4', data: bytes('x'.repeat(50)) }, { name: 'small.mp4', data: bytes('y') }]);
    const r = await expandClipZips([zip], { maxEntryBytes: 10 });
    expect(r.files.map((f) => f.name)).toEqual(['small.mp4']);
    expect(r.messages).toEqual(['big.mp4 is too big to unzip here, upload it on its own']);
  });

  it('an unreadable zip is reported, not swallowed', async () => {
    const r = await expandClipZips([new File(['not a zip'], 'broken.zip')]);
    expect(r.files).toEqual([]);
    expect(r.messages).toEqual(['Could not read broken.zip.']);
  });
});

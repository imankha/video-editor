import { describe, it, expect } from 'vitest';
import { collectFilesFromEntries, entryToFiles, hasDirectoryEntry } from './folderDrop';
import { pairProxies } from './footageIntake';

// T8810 — folder drag-drop walking. The container has no real OS folder to drag,
// so we build a SYNTHETIC FileSystemEntry tree mirroring the real DJI Action 6
// folder (4x .MP4 segments + 4x .LRF proxies), reproducing the tuple values from
// T8800's footageIntake test. A REAL Chrome drag-drop of a real OS folder still
// needs a human (flagged in the status line).

const DJI = [
  'DJI_0003.MP4',
  'DJI_0004.MP4',
  'DJI_0005.MP4',
  'DJI_0006.MP4',
  'DJI_0003.LRF',
  'DJI_0004.LRF',
  'DJI_0005.LRF',
  'DJI_0006.LRF',
];

/** A synthetic file entry that resolves to a File carrying the given name. */
function fileEntry(name) {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (resolve) => resolve(new File(['x'], name, { type: '' })),
  };
}

/**
 * A synthetic directory entry whose reader hands children back in BATCHES —
 * `batchSize` at a time, then an empty batch — exactly like the real
 * DirectoryReader, so the "drain until empty" loop is exercised.
 */
function dirEntry(name, children, batchSize = 100) {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let i = 0;
      return {
        readEntries: (resolve) => {
          const batch = children.slice(i, i + batchSize);
          i += batch.length;
          resolve(batch);
        },
      };
    },
  };
}

describe('folderDrop', () => {
  it('entryToFiles flattens a single file entry to one File', async () => {
    const files = await entryToFiles(fileEntry('DJI_0003.MP4'));
    expect(files.map((f) => f.name)).toEqual(['DJI_0003.MP4']);
  });

  it('collectFilesFromEntries walks a DJI-style folder into all 8 files', async () => {
    const folder = dirEntry('ECNL Test - DJI Action 6', DJI.map(fileEntry));
    const files = await collectFilesFromEntries([folder]);
    expect(files.map((f) => f.name).sort()).toEqual([...DJI].sort());
  });

  it('drains a directory reader that returns children in multiple batches', async () => {
    // batchSize 3 forces 3 readEntries calls (3 + 3 + 2) before the empty batch.
    const folder = dirEntry('deep', DJI.map(fileEntry), 3);
    const files = await collectFilesFromEntries([folder]);
    expect(files).toHaveLength(8);
  });

  it('recurses into nested subdirectories', async () => {
    const nested = dirEntry('inner', [fileEntry('DJI_0006.MP4')]);
    const folder = dirEntry('outer', [fileEntry('DJI_0003.MP4'), nested]);
    const files = await collectFilesFromEntries([folder]);
    expect(files.map((f) => f.name).sort()).toEqual(['DJI_0003.MP4', 'DJI_0006.MP4']);
  });

  it('walked folder feeds pairProxies -> 4 uploadable videos + 4 .LRF proxies', async () => {
    const folder = dirEntry('ECNL Test - DJI Action 6', DJI.map(fileEntry));
    const files = await collectFilesFromEntries([folder]);
    const { videos, proxies } = pairProxies(files);
    expect(videos.map((v) => v.name).sort()).toEqual([
      'DJI_0003.MP4',
      'DJI_0004.MP4',
      'DJI_0005.MP4',
      'DJI_0006.MP4',
    ]);
    expect(Object.keys(proxies).sort()).toEqual([
      'DJI_0003.MP4',
      'DJI_0004.MP4',
      'DJI_0005.MP4',
      'DJI_0006.MP4',
    ]);
  });

  it('hasDirectoryEntry detects a folder among plain files', () => {
    expect(hasDirectoryEntry([fileEntry('a.mp4')])).toBe(false);
    expect(hasDirectoryEntry([fileEntry('a.mp4'), dirEntry('f', [])])).toBe(true);
    expect(hasDirectoryEntry([])).toBe(false);
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import {
  recordSync, syncEntries, syncDump, resetSyncTrace, lastRefresh, lastWriteAfter,
  diffHolders, registerHolder, unregisterHolder, getRegisteredHolder, resolveReason,
} from './syncTrace.js';

beforeEach(() => resetSyncTrace());

describe('ring buffer', () => {
  it('keeps only the newest 500 entries', () => {
    for (let i = 0; i < 520; i++) recordSync({ kind: 'fetch', holder: 'h', reason: 'mount', summary: { i } });
    const e = syncEntries();
    expect(e).toHaveLength(500);
    expect(e[0].summary.i).toBe(20);
    expect(e[499].summary.i).toBe(519);
  });

  it('dump prints compact [SYNC] lines', () => {
    recordSync({ kind: 'write', holder: 'downloads.restore', reason: 'restore', reqId: 'abc12345', summary: { projectId: 7 } });
    const lines = syncDump();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\[SYNC\] .*write .*downloads\.restore .*reason=restore .*req=abc12345 .*\{"projectId":7\}/);
  });
});

describe('resolveReason', () => {
  it('passes a given reason through and flags a missing one', () => {
    expect(resolveReason('publish')).toBe('publish');
    expect(resolveReason(undefined)).toMatch(/^unspecified:/);
  });
});

describe('attribution', () => {
  it('finds the last refresh of a holder and the newer write that did not refresh it', () => {
    recordSync({ kind: 'fetch', holder: 'galleryStore.count', reason: 'bootstrap', reqId: 'r1', summary: { count: 1 } });
    recordSync({ kind: 'write', holder: 'downloads.restore', reason: 'restore', reqId: 'r2', summary: {} });
    expect(lastRefresh('galleryStore.count').reason).toBe('bootstrap');
    expect(lastWriteAfter('galleryStore.count', lastRefresh('galleryStore.count').seq).reqId).toBe('r2');
  });

  it('a later refresh supersedes the write', () => {
    recordSync({ kind: 'write', holder: 'downloads.restore', reason: 'restore', reqId: 'r2', summary: {} });
    recordSync({ kind: 'fetch', holder: 'galleryStore.count', reason: 'restore', reqId: 'r3', summary: {} });
    expect(lastWriteAfter('galleryStore.count', lastRefresh('galleryStore.count').seq)).toBeNull();
  });
});

describe('diffHolders', () => {
  it('reports zero rows when client equals server', () => {
    expect(diffHolders({ 'galleryStore.count': 2 }, { 'galleryStore.count': 2 })).toEqual([]);
  });

  it('names holder, both values, last refresh and the unrefreshed write', () => {
    recordSync({ kind: 'fetch', holder: 'galleryStore.count', reason: 'bootstrap', reqId: 'r1', summary: {} });
    recordSync({ kind: 'write', holder: 'downloads.restore', reason: 'restore', reqId: 'r2', summary: {} });
    const rows = diffHolders({ 'galleryStore.count': 1, 'gamesDataStore.reel_count': 3 },
                             { 'galleryStore.count': 0, 'gamesDataStore.reel_count': 3 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      holder: 'galleryStore.count', client: 1, server: 0,
      lastRefresh: { reason: 'bootstrap', reqId: 'r1' },
      newerWrite: { reason: 'restore', reqId: 'r2' },
    });
    expect(typeof rows[0].lastRefreshAgeMs).toBe('number');
  });

  it('compares objects structurally', () => {
    expect(diffHolders({ a: { x: 1 } }, { a: { x: 1 } })).toEqual([]);
    expect(diffHolders({ a: { x: 1 } }, { a: { x: 2 } })).toHaveLength(1);
  });
});

describe('holder registry', () => {
  it('registers and clears component-held state', () => {
    registerHolder('collections.summary', () => ({ n: 1 }));
    expect(getRegisteredHolder('collections.summary')).toEqual({ n: 1 });
    unregisterHolder('collections.summary');
    expect(getRegisteredHolder('collections.summary')).toBeUndefined();
  });
});

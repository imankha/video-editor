import { describe, it, expect, beforeEach } from 'vitest';
import { recordSync, resetSyncTrace } from './syncTrace.js';
import { buildClientHolders, buildServerHolders, checkSync } from './syncCheck.js';

const inst = (o = {}) => ({ projectId: 7, orientation: '9:16', isPublished: false, hasFinalVideo: false, hasWorkingVideo: true, ...o });

beforeEach(() => resetSyncTrace());

const probe = (o = {}) => ({
  project: { id: 7, is_published: 1, has_final_video: 1, is_auto_created: 1 },
  final_videos: [{ id: 3, version: 1, published_at: '2026-10-28' }],
  raw_clip: { id: 11 },
  highlight_instances: [{ project_id: 7, aspect_ratio: '9:16', is_published: true, has_final_video: true, has_working_video: false }],
  counts: { downloads_count: 1, downloads_unwatched: 1, game_reel_count: 1 },
  ...o,
});

const ids = { projectId: 7, rawClipId: 11, gameId: 2 };

describe('checkSync', () => {
  it('reports zero mismatches when every holder agrees with the server', () => {
    const client = buildClientHolders({
      gallery: { count: 1, unwatchedCount: 1, justPublished: null },
      projects: [{ id: 7, is_published: 1, has_final_video: 1, is_auto_created: 1 }],
      selectedProjectId: null, selectedProject: null,
      games: [{ id: 2, reel_count: 1 }],
      registered: { 'annotate.highlightInstances': { 11: [inst({ isPublished: true, hasFinalVideo: true, hasWorkingVideo: false })] } },
    }, ids);
    const report = checkSync(client, buildServerHolders(probe(), null, ids));
    expect(report.mismatches).toEqual([]);
    expect(report.stageMismatch).toBe(false);
  });

  it('names stale count, reel_count and the Annotate copy, with attribution and the stage the user sees', () => {
    recordSync({ kind: 'fetch', holder: 'annotate.highlightInstances', reason: 'load', summary: {} });
    recordSync({ kind: 'write', holder: 'downloads.publish', reason: 'publish', reqId: 'pub00001', summary: {} });
    const client = buildClientHolders({
      gallery: { count: 0, unwatchedCount: 0, justPublished: null },
      projects: [{ id: 7, is_published: 1, has_final_video: 1, is_auto_created: 1 }],
      selectedProjectId: null, selectedProject: null,
      games: [{ id: 2, reel_count: 0 }],
      registered: { 'annotate.highlightInstances': { 11: [inst()] } },
    }, ids);
    const report = checkSync(client, buildServerHolders(probe(), null, ids));
    const byHolder = Object.fromEntries(report.mismatches.map((r) => [r.holder, r]));
    expect(Object.keys(byHolder).sort()).toEqual([
      'annotate.highlightInstances', 'derive.clipStages', 'galleryStore.count', 'gamesDataStore.games',
    ]);
    expect(byHolder['galleryStore.count']).toMatchObject({ client: { count: 0 }, server: { count: 1 } });
    expect(byHolder['annotate.highlightInstances'].newerWrite).toMatchObject({ reason: 'publish', reqId: 'pub00001' });
    expect(byHolder['derive.clipStages'].lastRefresh.reason).toBe('load'); // attributed to its source holder
    expect(report.stageMismatch).toBe(true);
  });

  it('flags a selectedProject copy that disagrees with the server', () => {
    const client = buildClientHolders({
      gallery: { count: 1, unwatchedCount: 1, justPublished: null },
      projects: [{ id: 7, is_published: 1, has_final_video: 1, is_auto_created: 1 }],
      selectedProjectId: 7, selectedProject: { id: 7, is_published: 0, has_final_video: 1 },
      games: [{ id: 2, reel_count: 1 }], registered: {},
    }, ids);
    const report = checkSync(client, buildServerHolders(probe(), null, ids));
    expect(report.mismatches.map((r) => r.holder)).toEqual(['projectsStore.selectedProject']);
  });
});

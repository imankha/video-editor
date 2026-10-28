import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { syncEntries, resetSyncTrace } from '../utils/syncTrace';
import { useAuthStore } from './authStore';
import { useProjectsStore } from './projectsStore';
import { useGalleryStore } from './galleryStore';
import { useGamesDataStore } from './gamesDataStore';

function okJson(body) {
  return Promise.resolve({ ok: true, status: 200, reqId: 'req00001', json: () => Promise.resolve(body) });
}

beforeEach(() => {
  resetSyncTrace();
  useAuthStore.setState({ isAuthenticated: true });
  vi.stubGlobal('fetch', vi.fn((url) => {
    if (String(url).includes('/downloads/count')) return okJson({ count: 2, unwatched_count: 1 });
    if (String(url).includes('/api/games')) return okJson({ games: [{ id: 1, reel_count: 3, clip_count: 4 }] });
    if (String(url).match(/\/projects\/\d+/)) return okJson({ id: 5, is_published: 1, has_final_video: 1 });
    return okJson([{ id: 5, is_published: 1, has_final_video: 1, is_auto_created: 1 }]);
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('every refresh entry point records a fetch/signal entry carrying its reason', () => {
  it('records named reasons with request ids and summaries', async () => {
    await useProjectsStore.getState().fetchProjects({ force: true, reason: 'publish' });
    await useGalleryStore.getState().fetchCount({ force: true, reason: 'restore' });
    useGalleryStore.getState().notifyCollectionsChanged('move');
    await useGamesDataStore.getState().fetchGames({ force: true, reason: 'bootstrap' });
    await useProjectsStore.getState().fetchProject(5, { reason: 'select-project' });

    const e = syncEntries();
    const by = (holder) => e.find((x) => x.holder === holder);
    expect(by('projectsStore.projects')).toMatchObject({ kind: 'fetch', reason: 'publish', reqId: 'req00001' });
    expect(by('projectsStore.projects').summary.flags).toEqual([[5, 1, 1, 1]]);
    expect(by('galleryStore.count')).toMatchObject({ reason: 'restore', summary: { count: 2, unwatchedCount: 1 } });
    expect(by('galleryStore.collectionsVersion')).toMatchObject({ kind: 'signal', reason: 'move' });
    expect(by('gamesDataStore.games')).toMatchObject({ reason: 'bootstrap' });
    expect(by('gamesDataStore.games').summary.reelCounts).toEqual([[1, 3, 4]]);
    expect(by('projectsStore.project').reason).toBe('select-project');
    expect(e.filter((x) => x.reason.startsWith('unspecified'))).toHaveLength(0);
  });

  it('flags a caller that passes no reason', async () => {
    await useGalleryStore.getState().fetchCount({ force: true });
    expect(syncEntries().find((x) => x.holder === 'galleryStore.count').reason).toMatch(/^unspecified:/);
  });
});

describe('known call sites pass a literal reason', () => {
  const SRC = path.resolve(__dirname, '..');
  const SITES = {
    'hooks/usePublishProject.js': ['fetchCount', 'fetchProjects', 'notifyCollectionsChanged', 'setJustPublished'],
    'hooks/useReEditReel.js': ['fetchCount', 'fetchProjects', 'notifyCollectionsChanged'],
    'components/PublishedReelsPanel.jsx': ['fetchCount', 'notifyCollectionsChanged', 'fetchSummary'],
    'utils/handleOverlayExportCompletion.js': ['fetchProjects'],
    'App.jsx': ['fetchCount', 'fetchGames'],
  };
  for (const [file, fns] of Object.entries(SITES)) {
    it(`${file}`, () => {
      // strip comment lines so doc prose naming a function is not mistaken for a call
      const text = fs.readFileSync(path.join(SRC, file), 'utf8')
        .split('\n').map((l) => (/^\s*(\/\/|\*|\/\*)/.test(l) ? '' : l)).join('\n');
      for (const fn of fns) {
        const calls = [...text.matchAll(new RegExp(`\\b${fn}\\(([^)]*)\\)?`, 'g'))];
        for (const m of calls) {
          const around = text.slice(m.index, m.index + 260).split(';')[0];
          expect(around, `${file} ${fn}(...) lacks a reason`).toMatch(/reason: '[a-z-]+'|\('[a-z-]+'\)|, '[a-z-]+'\)/);
        }
      }
    });
  }
});

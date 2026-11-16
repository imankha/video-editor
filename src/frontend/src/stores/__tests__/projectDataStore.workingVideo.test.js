import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// T4490: the Spotlight video's load status lives in ONE slice of projectDataStore,
// written only by loadWorkingVideo (dedup, bounded retry, stale results dropped).

const { apiFetchSpy, metaSpy } = vi.hoisted(() => ({ apiFetchSpy: vi.fn(), metaSpy: vi.fn() }));
vi.mock('../../utils/apiFetch', () => ({ default: apiFetchSpy }));
vi.mock('../../utils/videoMetadata', () => ({
  extractVideoMetadataFromUrl: metaSpy,
  VideoAssetMissingError: class VideoAssetMissingError extends Error {
    constructor(url, status) { super(`missing ${status}`); this.status = status; }
  },
}));

import { useProjectDataStore } from '../projectDataStore';

const META = { duration: 12, width: 1080, height: 1920 };
const ok = (url) => ({ ok: true, status: 200, json: async () => ({ url }) });
const playbackCalls = () => apiFetchSpy.mock.calls.filter(([u]) => String(u).includes('/working_video/playback-url'));
const slice = () => useProjectDataStore.getState().workingVideo;

describe('T4490 projectDataStore.loadWorkingVideo', () => {
  beforeEach(() => {
    apiFetchSpy.mockReset();
    metaSpy.mockReset().mockResolvedValue(META);
    useProjectDataStore.getState().reset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('starts idle and ends ready with url + metadata together', async () => {
    expect(slice().status).toBe('idle');
    apiFetchSpy.mockResolvedValue(ok('https://r2/wv.mp4'));
    const p = useProjectDataStore.getState().loadWorkingVideo(5, 70);
    expect(slice().status).toBe('loading');
    await p;
    expect(slice()).toMatchObject({ status: 'ready', projectId: 5, videoId: 70, error: null,
      video: { file: null, url: 'https://r2/wv.mp4', metadata: META } });
  });

  it('dedups: two calls for the same video make one fetch', async () => {
    apiFetchSpy.mockResolvedValue(ok('https://r2/wv.mp4'));
    const { loadWorkingVideo } = useProjectDataStore.getState();
    await Promise.all([loadWorkingVideo(5, 70), loadWorkingVideo(5, 70)]);
    await loadWorkingVideo(5, 70);
    expect(playbackCalls()).toHaveLength(1);
  });

  it('a new working_video_id loads again and a late result for the old one is dropped', async () => {
    let releaseOld;
    apiFetchSpy.mockImplementationOnce(() => new Promise((r) => { releaseOld = () => r(ok('https://r2/old.mp4')); }));
    apiFetchSpy.mockResolvedValueOnce(ok('https://r2/new.mp4'));
    const { loadWorkingVideo } = useProjectDataStore.getState();
    const oldLoad = loadWorkingVideo(5, 70);
    await loadWorkingVideo(5, 71);
    releaseOld();
    await oldLoad;
    expect(slice()).toMatchObject({ status: 'ready', videoId: 71, video: { url: 'https://r2/new.mp4' } });
  });

  it('retries once, then reports error; force retries again', async () => {
    apiFetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const { loadWorkingVideo } = useProjectDataStore.getState();
    await loadWorkingVideo(5, 70);
    expect(playbackCalls()).toHaveLength(2);
    expect(slice().status).toBe('error');
    expect(slice().error).toBeTruthy();
    await loadWorkingVideo(5, 70);
    expect(playbackCalls()).toHaveLength(2);
    apiFetchSpy.mockResolvedValue(ok('https://r2/wv.mp4'));
    await loadWorkingVideo(5, 70, { force: true });
    expect(slice().status).toBe('ready');
  });

  it('a 404 is final: missing, no second attempt', async () => {
    apiFetchSpy.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await useProjectDataStore.getState().loadWorkingVideo(5, 70);
    expect(playbackCalls()).toHaveLength(1);
    expect(slice().status).toBe('missing');
  });

  it('reset drops an in-flight result', async () => {
    let release;
    apiFetchSpy.mockImplementationOnce(() => new Promise((r) => { release = () => r(ok('https://r2/wv.mp4')); }));
    const p = useProjectDataStore.getState().loadWorkingVideo(5, 70);
    useProjectDataStore.getState().reset();
    release();
    await p;
    expect(slice().status).toBe('idle');
  });
});

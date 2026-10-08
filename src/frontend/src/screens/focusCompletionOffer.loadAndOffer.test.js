import { describe, it, expect, vi } from 'vitest';
import { loadAndOfferFocusCompletion } from './focusCompletionOffer';

// T11970: the two post-COMPLETE GETs (project refresh + playback URL) must be in
// flight together, and the panel opens as soon as the URL resolves.
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

describe('loadAndOfferFocusCompletion (T11970)', () => {
  it('starts both requests before either resolves', () => {
    const refresh = deferred();
    const url = deferred();
    const refreshProject = vi.fn(() => refresh.promise);
    const resolvePreviewUrl = vi.fn(() => url.promise);

    loadAndOfferFocusCompletion({
      projectId: 7, refreshProject, resolvePreviewUrl,
      openMode: 'framing', jobId: 'j1', openPreview: vi.fn(), recordAchievement: vi.fn(),
    });

    expect(refreshProject).toHaveBeenCalledTimes(1);
    expect(resolvePreviewUrl).toHaveBeenCalledWith(7);
  });

  it('opens the preview when the URL resolves, without waiting for the refresh', async () => {
    const refresh = deferred();
    const openPreview = vi.fn();
    const done = loadAndOfferFocusCompletion({
      projectId: 7,
      refreshProject: () => refresh.promise,
      resolvePreviewUrl: () => Promise.resolve('https://r2/x.mp4'),
      openMode: 'framing', jobId: 'j1', openPreview, recordAchievement: vi.fn(),
    });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(openPreview).toHaveBeenCalledWith({ projectId: 7, previewUrl: 'https://r2/x.mp4', openMode: 'framing', jobId: 'j1' });
    refresh.resolve();
    await done;
  });
});

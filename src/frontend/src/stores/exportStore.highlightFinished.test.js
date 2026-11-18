import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useExportStore } from './exportStore';
import { useGalleryStore } from './galleryStore';

// T17020: the server finishes a sharpened highlight (T16520) before it reports the
// framing export complete, so the moment an export completes the Highlights count and
// the grouped list (collectionsVersion) must refresh, wherever the parent is in the app.
describe('exportStore.completeExport refreshes Highlights (T17020)', () => {
  let fetchCount;

  beforeEach(() => {
    useExportStore.setState({ activeExports: {}, exportingProject: null, exportProgress: null });
    useGalleryStore.getState().reset();
    fetchCount = vi.fn().mockResolvedValue(2);
    useGalleryStore.setState({ fetchCount });
  });

  it.each(['framing', 'overlay'])('a %s export completing refetches the count and bumps collectionsVersion', (type) => {
    useExportStore.getState().startExport('job-1', 7, type, 'Goal');
    const before = useGalleryStore.getState().collectionsVersion;

    useExportStore.getState().completeExport('job-1', 42, 'final.mp4');

    expect(fetchCount).toHaveBeenCalledTimes(1);
    expect(fetchCount).toHaveBeenCalledWith(expect.objectContaining({ force: true }));
    expect(useGalleryStore.getState().collectionsVersion).toBe(before + 1);
  });

  it('a second complete for the same job does not refresh again', () => {
    useExportStore.getState().startExport('job-1', 7, 'framing', 'Goal');
    useExportStore.getState().completeExport('job-1', 42, 'final.mp4');
    useExportStore.getState().completeExport('job-1', 42, 'final.mp4');

    expect(fetchCount).toHaveBeenCalledTimes(1);
  });

  it('an annotate export completing leaves Highlights alone', () => {
    useExportStore.getState().startExport('job-2', { gameId: 3 }, 'annotate', 'Game');
    const before = useGalleryStore.getState().collectionsVersion;

    useExportStore.getState().completeExport('job-2', 9, 'clips.mp4');

    expect(fetchCount).not.toHaveBeenCalled();
    expect(useGalleryStore.getState().collectionsVersion).toBe(before);
  });
});

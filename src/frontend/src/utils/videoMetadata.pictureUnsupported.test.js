/**
 * T17280 (bug 62p): an iPhone HEVC file in a browser that cannot decode HEVC
 * (Windows Chrome without the hardware decoder) loads as AUDIO ONLY: the
 * <video> fires loadedmetadata with a real duration and a 0x0 picture, no error.
 * extractVideoMetadata resolved {width: 0, height: 0}, the upload sent null
 * dimensions, and the parent got a game that plays sound with no picture.
 * The probe must refuse such a file so the upload dialog can say so first.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { extractVideoMetadata } from './videoMetadata';

function stubVideoElement({ videoWidth, videoHeight, duration }) {
  const fakeVideo = {
    preload: '', muted: false, videoWidth, videoHeight, duration,
    readyState: 1, networkState: 1, audioTracks: [], videoTracks: [], textTracks: [],
    defaultPlaybackRate: 1, onloadedmetadata: null, onerror: null,
    removeAttribute: vi.fn(), load: vi.fn(), remove: vi.fn(),
  };
  Object.defineProperty(fakeVideo, 'src', {
    get() { return this._src; },
    set(url) {
      this._src = url;
      setTimeout(() => fakeVideo.onloadedmetadata && fakeVideo.onloadedmetadata(), 0);
    },
  });
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) =>
    (tag === 'video' ? fakeVideo : realCreate(tag)));
}

describe('T17280 extractVideoMetadata refuses a file whose picture cannot be decoded', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete URL.createObjectURL;
    delete URL.revokeObjectURL;
  });

  it('rejects with code VIDEO_PICTURE_UNSUPPORTED when the file has sound but a 0x0 picture', async () => {
    stubVideoElement({ videoWidth: 0, videoHeight: 0, duration: 3600 });
    const file = new File([new Uint8Array(8)], 'IMG_0128.MOV', { type: 'video/quicktime' });
    const err = await extractVideoMetadata(file).then(() => null, (e) => e);
    expect(err).not.toBeNull();
    expect(err.code).toBe('VIDEO_PICTURE_UNSUPPORTED');
  });

  it('still resolves a normal file with a picture', async () => {
    stubVideoElement({ videoWidth: 1920, videoHeight: 1080, duration: 3600 });
    const file = new File([new Uint8Array(8)], 'IMG_0129.MOV', { type: 'video/quicktime' });
    const meta = await extractVideoMetadata(file);
    expect(meta.width).toBe(1920);
  });
});

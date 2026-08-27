/**
 * T7820: captureVideoFrame — local-file thumbnail for uploading game tiles.
 *
 * Contract pinned here:
 *   - happy path: object URL -> offscreen video -> seek min(1s, duration) ->
 *     canvas.drawImage -> toDataURL('image/jpeg', 0.7); object URL revoked after
 *   - seek target CLAMPS to duration for sub-second videos
 *   - EVERY failure resolves to null silently (video error, no 2d context, no file)
 *     — the caller shows the branded fallback; the util never throws
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { captureVideoFrame } from './captureVideoFrame';

// Fake media elements: jsdom's <video> never fires loadedmetadata/seeked and its
// <canvas> has no real 2d context, so both are stand-ins driven by the test.
function mkFakeVideo({ duration = 10, videoWidth = 1920, videoHeight = 1080, failLoad = false } = {}) {
  const video = {
    muted: false,
    playsInline: false,
    preload: '',
    duration,
    videoWidth,
    videoHeight,
    _currentTime: 0,
    onerror: null,
    onloadedmetadata: null,
    onseeked: null,
    removeAttribute: vi.fn(),
    load: vi.fn(),
  };
  Object.defineProperty(video, 'currentTime', {
    get() { return this._currentTime; },
    set(t) {
      this._currentTime = t;
      // A real browser fires `seeked` asynchronously after the seek completes.
      setTimeout(() => this.onseeked && this.onseeked(), 0);
    },
  });
  Object.defineProperty(video, 'src', {
    get() { return this._src; },
    set(url) {
      this._src = url;
      // Metadata (or a decode error) arrives asynchronously after src is set.
      setTimeout(() => {
        if (failLoad) this.onerror && this.onerror();
        else this.onloadedmetadata && this.onloadedmetadata();
      }, 0);
    },
  });
  return video;
}

function mkFakeCanvas({ ctx = { drawImage: vi.fn() } } = {}) {
  return {
    width: 0,
    height: 0,
    getContext: vi.fn(() => ctx),
    toDataURL: vi.fn(() => 'data:image/jpeg;base64,FRAME'),
    _ctx: ctx,
  };
}

const file = new File([new Uint8Array(8)], 'game.mp4', { type: 'video/mp4' });

let fakeVideo;
let fakeCanvas;

function installFakes({ video, canvas } = {}) {
  fakeVideo = video || mkFakeVideo();
  fakeCanvas = canvas || mkFakeCanvas();
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag === 'video') return fakeVideo;
    if (tag === 'canvas') return fakeCanvas;
    return realCreate(tag);
  });
}

beforeEach(() => {
  // jsdom has no createObjectURL/revokeObjectURL — install spies.
  URL.createObjectURL = vi.fn(() => 'blob:mock-object-url');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete URL.createObjectURL;
  delete URL.revokeObjectURL;
});

describe('captureVideoFrame — happy path', () => {
  it('captures a JPEG data URL at ~1s and revokes the object URL', async () => {
    installFakes();

    const result = await captureVideoFrame(file);

    expect(result).toBe('data:image/jpeg;base64,FRAME');
    expect(URL.createObjectURL).toHaveBeenCalledWith(file);
    expect(fakeVideo.currentTime).toBe(1); // seeked to 1s of a 10s video
    expect(fakeCanvas.width).toBe(1920);
    expect(fakeCanvas.height).toBe(1080);
    expect(fakeCanvas._ctx.drawImage).toHaveBeenCalledWith(fakeVideo, 0, 0, 1920, 1080);
    expect(fakeCanvas.toDataURL).toHaveBeenCalledWith('image/jpeg', 0.7);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-object-url');
  });

  it('clamps the seek target to the duration for a sub-second video', async () => {
    installFakes({ video: mkFakeVideo({ duration: 0.5 }) });

    const result = await captureVideoFrame(file);

    expect(result).toBe('data:image/jpeg;base64,FRAME');
    expect(fakeVideo.currentTime).toBe(0.5);
  });
});

describe('captureVideoFrame — silent-null failures', () => {
  it('resolves null when the video errors (unsupported codec), still revoking the URL', async () => {
    installFakes({ video: mkFakeVideo({ failLoad: true }) });

    const result = await captureVideoFrame(file);

    expect(result).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-object-url');
  });

  it('resolves null when no 2d context is available', async () => {
    installFakes({ canvas: mkFakeCanvas({ ctx: null }) });

    const result = await captureVideoFrame(file);

    expect(result).toBeNull();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-object-url');
  });

  it('resolves null when the video reports zero dimensions', async () => {
    installFakes({ video: mkFakeVideo({ videoWidth: 0, videoHeight: 0 }) });

    const result = await captureVideoFrame(file);

    expect(result).toBeNull();
  });

  it('resolves null for a missing file without touching URL APIs', async () => {
    installFakes();

    const result = await captureVideoFrame(null);

    expect(result).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

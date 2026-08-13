// T6960 — preloadIntroImage: always resolves, never hangs, warns on the
// degrade paths. The gate hosts (IntroStoryPlayer / IntroPreRoll / edge page)
// rely on exactly this contract to hold the intro clock without ever holding
// it hostage.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { preloadIntroImage, INTRO_IMAGE_PRELOAD_TIMEOUT_MS } from './preloadIntroImage';

let instances;

class FakeImage {
  constructor() {
    instances.push(this);
    this.onload = null;
    this.onerror = null;
    this.src = null;
  }
}

beforeEach(() => {
  instances = [];
  vi.useFakeTimers();
  vi.stubGlobal('Image', FakeImage);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('preloadIntroImage', () => {
  it('resolves "no-image" immediately for a missing url', async () => {
    await expect(preloadIntroImage(null)).resolves.toBe('no-image');
    expect(instances).toHaveLength(0);
  });

  it('resolves "loaded" when the image loads (no decode() in jsdom -> onload path)', async () => {
    const p = preloadIntroImage('https://r2.example/card.jpg');
    expect(instances[0].src).toBe('https://r2.example/card.jpg');
    instances[0].onload();
    await expect(p).resolves.toBe('loaded');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('resolves "error" (with a warn) on a broken image — the card plays photoless', async () => {
    const p = preloadIntroImage('https://r2.example/404.jpg');
    instances[0].onerror();
    await expect(p).resolves.toBe('error');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('resolves "timeout" (with a warn) when nothing ever fires — never hangs playback', async () => {
    const p = preloadIntroImage('https://r2.example/slow.jpg');
    vi.advanceTimersByTime(INTRO_IMAGE_PRELOAD_TIMEOUT_MS);
    await expect(p).resolves.toBe('timeout');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('a late onload after the timeout does not double-settle', async () => {
    const p = preloadIntroImage('https://r2.example/slow.jpg');
    vi.advanceTimersByTime(INTRO_IMAGE_PRELOAD_TIMEOUT_MS);
    instances[0].onload();
    await expect(p).resolves.toBe('timeout');
  });

  it('honors a custom timeoutMs', async () => {
    const p = preloadIntroImage('https://r2.example/slow.jpg', { timeoutMs: 100 });
    vi.advanceTimersByTime(100);
    await expect(p).resolves.toBe('timeout');
  });

  // Real browsers take the decode() branch — the jsdom-fallback tests above
  // never exercise it (reviewer MAJOR-3).
  it('resolves "loaded" through decode() when it resolves (the real-browser path)', async () => {
    class DecodingImage extends FakeImage {
      decode() { return Promise.resolve(); }
    }
    vi.stubGlobal('Image', DecodingImage);
    const p = preloadIntroImage('https://r2.example/card.jpg');
    instances[0].onload();
    await expect(p).resolves.toBe('loaded');
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('a decode() REJECTION resolves "error" with a warn — never silently reported as loaded', async () => {
    class FailingDecodeImage extends FakeImage {
      decode() { return Promise.reject(new Error('decode failed')); }
    }
    vi.stubGlobal('Image', FailingDecodeImage);
    const p = preloadIntroImage('https://r2.example/corrupt.jpg');
    instances[0].onload();
    await expect(p).resolves.toBe('error');
    expect(console.warn).toHaveBeenCalledTimes(1);
  });
});

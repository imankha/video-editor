import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { useKeyboardShortcuts, ARROW_SEEK_SECONDS } from './useKeyboardShortcuts';

// T4570: an arrow key steps one frame and Shift+arrow jumps four seconds, the
// same in Frame and Spotlight, through this one hook. Frame passes its crop
// layer props; Spotlight passes only the video controls.

const press = (code, options = {}) => {
  document.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, ...options }));
};

describe('T4570 same arrow keys in Frame and Spotlight', () => {
  const video = {
    hasVideo: true,
    togglePlay: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekForward: vi.fn(),
    seekBackward: vi.fn(),
    seek: vi.fn(),
  };
  const frameProps = {
    ...video,
    selectedLayer: 'playhead',
    copiedCrop: null,
    onCopyCrop: vi.fn(),
    onPasteCrop: vi.fn(),
    keyframes: [],
    framerate: 30,
    selectedCropKeyframeIndex: null,
  };
  const spotlightProps = { ...video };

  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  for (const [editor, props] of [['Frame', frameProps], ['Spotlight', spotlightProps]]) {
    it(`T4570:C1 ${editor}: an arrow key steps one frame`, () => {
      renderHook(() => useKeyboardShortcuts(props));
      press('ArrowRight');
      press('ArrowLeft');
      expect(video.stepForward).toHaveBeenCalledTimes(1);
      expect(video.stepBackward).toHaveBeenCalledTimes(1);
      expect(video.seekForward).not.toHaveBeenCalled();
      expect(video.seekBackward).not.toHaveBeenCalled();
    });

    it(`T4570:C1 ${editor}: Shift with an arrow jumps four seconds`, () => {
      renderHook(() => useKeyboardShortcuts(props));
      press('ArrowRight', { shiftKey: true });
      press('ArrowLeft', { shiftKey: true });
      expect(ARROW_SEEK_SECONDS).toBe(4);
      expect(video.seekForward).toHaveBeenCalledWith(4);
      expect(video.seekBackward).toHaveBeenCalledWith(4);
      expect(video.stepForward).not.toHaveBeenCalled();
      expect(video.stepBackward).not.toHaveBeenCalled();
    });
  }

  it('T4570:C1 Spotlight: Ctrl+C is not taken over (no crop to copy)', () => {
    renderHook(() => useKeyboardShortcuts(spotlightProps));
    const event = new KeyboardEvent('keydown', { code: 'KeyC', ctrlKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe('T4570:C2 one keyboard handler', () => {
  const read = (p) => readFileSync(resolve(process.cwd(), p), 'utf8');

  it('Spotlight has no keydown handler of its own', () => {
    const src = read('src/screens/OverlayScreen.jsx');
    expect(src).not.toMatch(/addEventListener\(\s*['"]keydown/);
    expect(src).toMatch(/useKeyboardShortcuts\(/);
  });

  it('Frame and Spotlight share the fullscreen Escape hook', () => {
    for (const p of ['src/screens/OverlayScreen.jsx', 'src/screens/FocusScreen.jsx']) {
      const src = read(p);
      expect(src).not.toMatch(/addEventListener\(\s*['"]keydown/);
      expect(src).toMatch(/useFullscreenToggle\(/);
    }
  });

  it('the shared hook has no Annotate or highlight branch', () => {
    const src = read('src/hooks/useKeyboardShortcuts.js');
    expect(src).not.toMatch(/ANNOTATE|annotate|highlight/i);
  });
});

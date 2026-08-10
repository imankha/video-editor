import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// jsdom lacks matchMedia. The hook self-gates on the REAL useIsCoarsePointer +
// a reduced-motion query (T6420) — stub matchMedia and let each test flip the
// two flags, so this exercises the real capability decision (not a mocked hook).
let coarsePointer = false;
let reducedMotion = false;
beforeEach(() => {
  coarsePointer = false;
  reducedMotion = false;
  window.matchMedia = (query) => ({
    matches: query.includes('pointer: coarse')
      ? coarsePointer
      : query.includes('prefers-reduced-motion')
        ? reducedMotion
        : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

import {
  useTilePreview,
  PREVIEW_PHASE,
  PREVIEW_WARM_DELAY_MS,
  PREVIEW_REVEAL_DELAY_MS,
} from './useTilePreview';

const STREAM = '/api/downloads/7/stream';

describe('useTilePreview — warm early, reveal late (T6420)', () => {
  it('fine pointer: enter -> WARM at ~100ms, REVEAL at ~450ms', () => {
    const { result } = renderHook(() => useTilePreview({ streamUrl: STREAM }));
    expect(result.current.phase).toBe(PREVIEW_PHASE.IDLE);

    act(() => result.current.onPointerEnter());
    // Grace window: still idle just before warm fires.
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS - 1));
    expect(result.current.phase).toBe(PREVIEW_PHASE.IDLE);

    act(() => vi.advanceTimersByTime(1));
    expect(result.current.phase).toBe(PREVIEW_PHASE.WARM);

    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS - PREVIEW_WARM_DELAY_MS));
    expect(result.current.phase).toBe(PREVIEW_PHASE.REVEAL);
  });

  it('grace window: a straight-line crossing (leave before warm) never warms', () => {
    const { result } = renderHook(() => useTilePreview({ streamUrl: STREAM }));
    act(() => result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS - 5));
    act(() => result.current.onPointerLeave());
    // Advance well past reveal — nothing should ever fire (zero requests).
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS * 2));
    expect(result.current.phase).toBe(PREVIEW_PHASE.IDLE);
  });

  it('leave after reveal tears down to idle', () => {
    const { result } = renderHook(() => useTilePreview({ streamUrl: STREAM }));
    act(() => result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS));
    expect(result.current.phase).toBe(PREVIEW_PHASE.REVEAL);
    act(() => result.current.onPointerLeave());
    expect(result.current.phase).toBe(PREVIEW_PHASE.IDLE);
  });

  it('coarse pointer: fine-only child stays inert (touch is T6430)', () => {
    coarsePointer = true;
    const { result } = renderHook(() => useTilePreview({ streamUrl: STREAM }));
    act(() => result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS * 2));
    expect(result.current.phase).toBe(PREVIEW_PHASE.IDLE);
  });

  it('prefers-reduced-motion: reduce disables the preview entirely', () => {
    reducedMotion = true;
    const { result } = renderHook(() => useTilePreview({ streamUrl: STREAM }));
    act(() => result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS * 2));
    expect(result.current.phase).toBe(PREVIEW_PHASE.IDLE);
  });

  it('null streamUrl (draft with no rendered video): inert', () => {
    const { result } = renderHook(() => useTilePreview({ streamUrl: null }));
    act(() => result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS * 2));
    expect(result.current.phase).toBe(PREVIEW_PHASE.IDLE);
  });

  it('single-active registry: activating tile B force-stops tile A', () => {
    const a = renderHook(() => useTilePreview({ streamUrl: '/api/downloads/1/stream' }));
    const b = renderHook(() => useTilePreview({ streamUrl: '/api/downloads/2/stream' }));

    // A warms first -> becomes the single active preview.
    act(() => a.result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS));
    expect(a.result.current.phase).toBe(PREVIEW_PHASE.WARM);

    // B warms -> claims the slot and force-stops A back to idle.
    act(() => b.result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS));
    expect(b.result.current.phase).toBe(PREVIEW_PHASE.WARM);
    expect(a.result.current.phase).toBe(PREVIEW_PHASE.IDLE);
  });

  it('stop() releases the registry slot so a later single hover still activates', () => {
    const a = renderHook(() => useTilePreview({ streamUrl: '/api/downloads/1/stream' }));
    act(() => a.result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_WARM_DELAY_MS));
    act(() => a.result.current.stop());
    expect(a.result.current.phase).toBe(PREVIEW_PHASE.IDLE);

    // Re-hovering the same tile activates again (slot was released, not leaked).
    act(() => a.result.current.onPointerEnter());
    act(() => vi.advanceTimersByTime(PREVIEW_REVEAL_DELAY_MS));
    expect(a.result.current.phase).toBe(PREVIEW_PHASE.REVEAL);
  });
});

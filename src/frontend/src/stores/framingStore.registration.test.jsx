/**
 * T6190 regression pin — the annotate->framing "Maximum update depth exceeded" loop.
 *
 * Root cause (verified): FramingScreen subscribes to the WHOLE framingStore (selector-less
 * `useFramingStore()`), and the effect that exposes `saveCurrentClipState` to updateFlush.js
 * used to write the store (register on run, clear on cleanup) keyed on the HANDLER IDENTITY.
 * `saveCurrentClipState`'s identity churns on almost every render (a useCrop keyframe dispatch
 * regenerates `getKeyframesForExport` during the annotate->framing settling window). So each
 * store write re-rendered the whole-store subscriber, which re-created the handler, which
 * re-fired the effect, which wrote the store again -> unbounded setState feedback loop.
 *
 * `activeSaveCurrentClipState` is only ever read imperatively (getState() in updateFlush.js),
 * never subscribed, so registration must be STABLE. `useRegisterActiveSaveHandler` registers a
 * ref-backed wrapper exactly once per mount.
 *
 * This test drives the exact identity chain (whole-store subscriber + a handler whose identity
 * changes every render). The first test documents that the OLD reactive-registration pattern
 * loops; the rest pin that the fixed hook does not (and still tracks the latest handler).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useFramingStore, useRegisterActiveSaveHandler } from './framingStore';

const RENDER_CAP = 60; // above React's 50 nested-update limit; our own guard so a loop can't hang

afterEach(() => {
  useFramingStore.setState({ activeSaveCurrentClipState: null });
});

// --- The pre-fix pattern, verbatim: an effect keyed on the churning handler identity that
// --- writes the store on run and on cleanup. Kept here ONLY to prove it loops (red).
function useReactiveRegister_PREFIX(handler) {
  useEffect(() => {
    useFramingStore.getState().registerSaveCurrentClipState(handler);
    return () => useFramingStore.getState().clearSaveCurrentClipState();
  }, [handler]); // <-- the bug: reactive to an identity that churns every render
}

/**
 * Whole-store subscriber (reproduces FramingScreen.jsx:59-66) that registers a handler whose
 * identity changes every render (reproduces the churning saveCurrentClipState).
 */
function ChurningSubscriber({ registerImpl, counter }) {
  useFramingStore(); // selector-less subscription: any store write re-renders this component
  counter.n += 1;
  if (counter.n > RENDER_CAP) throw new Error(`render cap exceeded (${counter.n}) — feedback loop`);
  const handler = () => 'saved'; // NEW identity every render
  registerImpl(handler);
  return null;
}

describe('T6190 active-save-handler registration', () => {
  it('RED: the pre-fix reactive registration infinite-loops on a churning handler identity', () => {
    const counter = { n: 0 };
    // React trips its own nested-update guard, or our RENDER_CAP fires first — either proves the loop.
    expect(() =>
      render(<ChurningSubscriber registerImpl={useReactiveRegister_PREFIX} counter={counter} />)
    ).toThrow(/Maximum update depth exceeded|render cap exceeded/);
    expect(counter.n).toBeGreaterThan(10);
  });

  it('GREEN: useRegisterActiveSaveHandler registers stably and does NOT loop', () => {
    const counter = { n: 0 };
    render(<ChurningSubscriber registerImpl={useRegisterActiveSaveHandler} counter={counter} />);
    // One mount write re-renders the subscriber once; no per-render re-registration -> no storm.
    expect(counter.n).toBeLessThan(5);
    // The stable wrapper is registered and callable.
    expect(typeof useFramingStore.getState().activeSaveCurrentClipState).toBe('function');
    expect(useFramingStore.getState().activeSaveCurrentClipState()).toBe('saved');
  });

  it('GREEN: the stable registration always calls the LATEST handler (ref semantics)', () => {
    let latestCalled = null;
    function Host({ tag }) {
      useRegisterActiveSaveHandler(() => { latestCalled = tag; return tag; });
      return null;
    }
    const { rerender } = render(<Host tag="A" />);
    rerender(<Host tag="B" />);
    rerender(<Host tag="C" />);
    // Registered wrapper is stable across rerenders but forwards to the newest handler.
    const registered = useFramingStore.getState().activeSaveCurrentClipState;
    expect(registered()).toBe('C');
    expect(latestCalled).toBe('C');
  });

  it('GREEN: clears the registration on unmount', () => {
    const { unmount } = render(<ChurningSubscriber registerImpl={useRegisterActiveSaveHandler} counter={{ n: 0 }} />);
    expect(useFramingStore.getState().activeSaveCurrentClipState).toBeTypeOf('function');
    act(() => unmount());
    expect(useFramingStore.getState().activeSaveCurrentClipState).toBeNull();
  });
});

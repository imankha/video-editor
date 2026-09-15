import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import useFramingHistory from './useFramingHistory';

describe('useFramingHistory (T9950 Slice 2)', () => {
  it('starts with canUndo false', () => {
    const { result } = renderHook(() => useFramingHistory());
    expect(result.current.canUndo).toBe(false);
  });

  it('canUndo becomes true after a push, and the pushed thunk runs on undo (LIFO)', async () => {
    const { result, rerender } = renderHook(() => useFramingHistory());
    const applyA = vi.fn();
    const applyB = vi.fn();

    act(() => { result.current.push('a', applyA); });
    rerender();
    expect(result.current.canUndo).toBe(true);

    act(() => { result.current.push('b', applyB); });
    rerender();

    await act(async () => { await result.current.undo(); });
    rerender();
    expect(applyB).toHaveBeenCalledTimes(1);
    expect(applyA).not.toHaveBeenCalled();
    expect(result.current.canUndo).toBe(true); // one entry (a) remains

    await act(async () => { await result.current.undo(); });
    rerender();
    expect(applyA).toHaveBeenCalledTimes(1);
    expect(result.current.canUndo).toBe(false);
  });

  it('undo on an empty stack is a safe no-op', async () => {
    const { result } = renderHook(() => useFramingHistory());
    const returned = await result.current.undo();
    expect(returned).toBe(false);
    expect(result.current.canUndo).toBe(false);
  });

  it('clear empties the stack (the clip-selection gesture)', () => {
    const { result, rerender } = renderHook(() => useFramingHistory());
    act(() => { result.current.push('a', vi.fn()); });
    rerender();
    expect(result.current.canUndo).toBe(true);

    act(() => { result.current.clear(); });
    rerender();
    expect(result.current.canUndo).toBe(false);
  });

  it('caps depth at 20, dropping the oldest entries first', async () => {
    const { result, rerender } = renderHook(() => useFramingHistory());
    const applies = Array.from({ length: 25 }, () => vi.fn());
    act(() => {
      applies.forEach((fn, i) => result.current.push(`entry-${i}`, fn));
    });
    rerender();
    expect(result.current.canUndo).toBe(true);

    // Pop all remaining entries; only the last 20 pushed (entries 5..24) should fire.
    for (let i = 0; i < 20; i++) {
      await act(async () => { await result.current.undo(); });
    }
    rerender();
    expect(result.current.canUndo).toBe(false);
    applies.slice(0, 5).forEach(fn => expect(fn).not.toHaveBeenCalled());
    applies.slice(5).forEach(fn => expect(fn).toHaveBeenCalledTimes(1));
  });
});

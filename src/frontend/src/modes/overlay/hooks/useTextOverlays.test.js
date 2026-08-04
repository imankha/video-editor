import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTextOverlays from './useTextOverlays';

/**
 * T5225 — Stage 3 (test-first). `useTextOverlays` does not exist yet.
 *
 * Design: docs/plans/tasks/T5225-design.md §1 (entry shape), §5.1 (hook contract).
 * Mirrors `useHighlightRegions` + pins the exact T5644 landmine fix pattern
 * (`addRegion` returning the new entity, not relying on a same-tick state
 * re-read) for every mutating method: add/moveEdge/updateSpec/toggle/delete
 * must each RETURN the updated entity so `OverlayScreen`'s wrapped gesture
 * handlers can dispatch the surgical POST from the return value directly
 * (see design §5.1, `OverlayScreen.jsx:707-732`).
 *
 * Entry shape (design §1.1):
 *   { id, spec: TextSpec, startTime, endTime, enabled }
 */

function baseSpec(overrides = {}) {
  return {
    text: 'GOAL',
    font: 'anton',
    size: 0.08,
    color: '#FFD66B',
    align: 'left',
    position: { x: 0.08, y: 0.4 },
    maxWidth: 0.84,
    shadow: { blur: 0, color: '#000000', opacity: 0 },
    stroke: { width: 0, color: '#000000' },
    animation: 'none',
    ...overrides,
  };
}

describe('useTextOverlays - add returns the new entity (T5225)', () => {
  it('addText returns the new block OBJECT (id, spec, startTime, endTime, enabled)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let returned;
    act(() => { returned = result.current.addText(3, baseSpec()); });

    expect(returned).toBeTruthy();
    expect(typeof returned).toBe('object');
    expect(typeof returned.id).toBe('string');
    expect(returned.spec).toEqual(baseSpec());
    expect(typeof returned.startTime).toBe('number');
    expect(typeof returned.endTime).toBe('number');
    expect(returned.endTime).toBeGreaterThan(returned.startTime);
    expect(returned.enabled).toBe(true);

    // Matches what actually landed in state -- not a stale closure value.
    const inState = result.current.textOverlays.find((b) => b.id === returned.id);
    expect(inState).toBeTruthy();
    expect(inState.startTime).toBe(returned.startTime);
    expect(inState.endTime).toBe(returned.endTime);
  });

  it('addText assigns a client-minted id distinct across two adds (optimistic create)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let first, second;
    act(() => { first = result.current.addText(0, baseSpec()); });
    act(() => { second = result.current.addText(5, baseSpec()); });

    expect(first.id).not.toBe(second.id);
    expect(result.current.textOverlays).toHaveLength(2);
  });
});

describe('useTextOverlays - moveEdge returns the updated entity (T5225)', () => {
  it('moveTextStart returns the updated block with the new startTime applied', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let block;
    act(() => { block = result.current.addText(3, baseSpec()); });

    let updated;
    act(() => { updated = result.current.moveTextStart(block.id, 1.5); });

    expect(updated).toBeTruthy();
    expect(updated.id).toBe(block.id);
    expect(updated.startTime).toBe(1.5);
    expect(updated.endTime).toBe(block.endTime); // untouched edge unchanged

    const inState = result.current.textOverlays.find((b) => b.id === block.id);
    expect(inState.startTime).toBe(1.5);
  });

  it('moveTextEnd returns the updated block with the new endTime applied', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let block;
    act(() => { block = result.current.addText(3, baseSpec()); });

    let updated;
    act(() => { updated = result.current.moveTextEnd(block.id, 8); });

    expect(updated).toBeTruthy();
    expect(updated.endTime).toBe(8);
    expect(updated.startTime).toBe(block.startTime);
  });

  it('moveTextStart/End enforce a minimum span and cannot cross the partner edge', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let block;
    act(() => { block = result.current.addText(3, baseSpec()); }); // e.g. [3, 5]

    // Attempt to drag start past end (or within MIN_TEXT_DURATION of it).
    let updated;
    act(() => { updated = result.current.moveTextStart(block.id, block.endTime + 1); });

    expect(updated).toBeTruthy();
    // Guarded: start must stay strictly less than end by at least the minimum span.
    expect(updated.startTime).toBeLessThan(updated.endTime);
  });
});

describe('useTextOverlays - updateSpec returns the updated entity (T5225)', () => {
  it('updateTextSpec replaces the block spec wholesale and returns the updated block', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let block;
    act(() => { block = result.current.addText(0, baseSpec()); });

    const nextSpec = baseSpec({ text: 'CHANGED', color: '#FF0000' });
    let updated;
    act(() => { updated = result.current.updateTextSpec(block.id, nextSpec); });

    expect(updated).toBeTruthy();
    expect(updated.spec).toEqual(nextSpec);
    expect(updated.id).toBe(block.id);

    const inState = result.current.textOverlays.find((b) => b.id === block.id);
    expect(inState.spec).toEqual(nextSpec);
  });
});

describe('useTextOverlays - toggle returns the updated entity (T5225)', () => {
  it('toggleText flips enabled and returns the updated block', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let block;
    act(() => { block = result.current.addText(0, baseSpec()); });
    expect(block.enabled).toBe(true);

    let updated;
    act(() => { updated = result.current.toggleText(block.id, false); });

    expect(updated).toBeTruthy();
    expect(updated.enabled).toBe(false);

    const inState = result.current.textOverlays.find((b) => b.id === block.id);
    expect(inState.enabled).toBe(false);
  });
});

describe('useTextOverlays - delete returns the removed entity (T5225)', () => {
  it('deleteText removes the block from state and returns the removed block (id/spec/bounds)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let block;
    act(() => { block = result.current.addText(0, baseSpec()); });

    let removed;
    act(() => { removed = result.current.deleteText(block.id); });

    expect(removed).toBeTruthy();
    expect(removed.id).toBe(block.id);
    expect(result.current.textOverlays.find((b) => b.id === block.id)).toBeUndefined();
  });

  it('delete -> re-add mirrors the T5644 fix: re-add returns a NEW id, not the deleted one', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let first;
    act(() => { first = result.current.addText(3, baseSpec()); });
    act(() => { result.current.deleteText(first.id); });

    let readded;
    act(() => { readded = result.current.addText(3, baseSpec()); });

    expect(readded).toBeTruthy();
    expect(readded.id).not.toBe(first.id);
    expect(result.current.textOverlays).toHaveLength(1);
  });
});

describe('useTextOverlays - restore is read-only (T5225 design §5.1)', () => {
  it('restoreTextOverlays hydrates state from backend-shaped entries without mutating input', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    const saved = [
      { id: 'txt_saved1', spec: baseSpec(), startTime: 1, endTime: 4, enabled: true },
    ];

    act(() => { result.current.restoreTextOverlays(saved, 10); });

    expect(result.current.textOverlays).toHaveLength(1);
    expect(result.current.textOverlays[0]).toEqual(
      expect.objectContaining({ id: 'txt_saved1', startTime: 1, endTime: 4, enabled: true })
    );
  });
});

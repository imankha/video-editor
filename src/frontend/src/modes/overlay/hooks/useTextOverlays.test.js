import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useTextOverlays from './useTextOverlays';

/**
 * T6630 round 4 -- text REGIONS containing ELEMENTS (T5225's original single-
 * element-per-block model, replaced).
 *
 * Entry shape:
 *   { id, startTime, endTime, elements: [{ id, spec: TextSpec, enabled }] }
 *
 * Every mutating method must RETURN the updated/new/removed entity, not rely
 * on a same-tick re-read of `textOverlays` (T5644 fix pattern, mirrors
 * useHighlightRegions.addRegion) so OverlayScreen's wrapped gesture handlers
 * can dispatch the surgical POST from the return value directly.
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

describe('useTextOverlays - addRegion creates a region with ONE starter element (T6630 round 4)', () => {
  it('addRegion returns the new REGION (id, startTime, endTime, elements[1])', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(3, baseSpec()); });

    expect(region).toBeTruthy();
    expect(typeof region.id).toBe('string');
    expect(typeof region.startTime).toBe('number');
    expect(typeof region.endTime).toBe('number');
    expect(region.endTime).toBeGreaterThan(region.startTime);
    expect(region.elements).toHaveLength(1);
    expect(region.elements[0].enabled).toBe(true);
    expect(region.elements[0].spec.text).toBe('GOAL');

    const inState = result.current.textOverlays.find((r) => r.id === region.id);
    expect(inState).toBeTruthy();
    expect(inState.elements[0].id).toBe(region.elements[0].id);
  });

  it('a new region\'s element spawns with a DEFAULT POSITION PRESET (never Custom)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    // baseSpec's own position (0.08, 0.4) is intentionally NOT a preset --
    // addRegion must override it, not pass it through.
    act(() => { region = result.current.addRegion(0, baseSpec()); });

    // bottom-center is pickDefaultPreset's top priority for a fresh region.
    expect(region.elements[0].spec.position).toEqual({ x: 0.5, y: 0.82 });
    expect(region.elements[0].spec.align).toBe('center');
  });

  it('addRegion assigns a client-minted id distinct across two adds (optimistic create)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let first, second;
    act(() => { first = result.current.addRegion(0, baseSpec()); });
    act(() => { second = result.current.addRegion(5, baseSpec()); });

    expect(first.id).not.toBe(second.id);
    expect(result.current.textOverlays).toHaveLength(2);
  });
});

describe('useTextOverlays - addElement appends into an EXISTING region (T6630 round 4)', () => {
  it('addElement returns the new element and does NOT create a second region', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec({ text: 'First' })); });

    let element;
    act(() => { element = result.current.addElement(region.id, baseSpec({ text: 'Second' })); });

    expect(element).toBeTruthy();
    expect(element.regionId).toBe(region.id);
    expect(result.current.textOverlays).toHaveLength(1); // still ONE region
    const updatedRegion = result.current.textOverlays[0];
    expect(updatedRegion.elements).toHaveLength(2);
    expect(updatedRegion.startTime).toBe(region.startTime); // timing unchanged
    expect(updatedRegion.endTime).toBe(region.endTime);
  });

  it('THE BUG THIS GUARDS: two elements added into the SAME region share ONE time window (both render together)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(2, baseSpec({ text: 'GOAL' })); });
    act(() => { result.current.addElement(region.id, baseSpec({ text: 'ASSIST' })); });

    const stored = result.current.textOverlays[0];
    // Both elements share the SAME startTime/endTime (the region's), unlike
    // the old model where each "element" got its own disjoint time span.
    expect(stored.elements).toHaveLength(2);
    expect(stored.startTime).toBe(region.startTime);
    expect(stored.endTime).toBe(region.endTime);
  });

  it('addElement NEVER touches a sibling element\'s enabled state', () => {
    /* Round-4 investigation: the user reported the first element's eye
     * flipped to hidden right after adding a second. Audited addElement --
     * it only appends a new element object; every existing element is
     * spread from the region's CURRENT array untouched. This test pins that
     * contract so a future edit can't silently reintroduce the bug. */
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec({ text: 'First' })); });
    const firstElementId = region.elements[0].id;
    expect(result.current.textOverlays[0].elements[0].enabled).toBe(true);

    act(() => { result.current.addElement(region.id, baseSpec({ text: 'Second' })); });

    const firstAfter = result.current.textOverlays[0].elements.find((el) => el.id === firstElementId);
    expect(firstAfter.enabled).toBe(true); // untouched
  });

  it('addElement picks the NEXT available default preset (bottom-center taken -> center)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec()); }); // takes bottom-center

    let element;
    act(() => { element = result.current.addElement(region.id, baseSpec()); });

    expect(element.spec.position).toEqual({ x: 0.5, y: 0.45 }); // center-middle
    expect(element.spec.align).toBe('center');
  });

  it('addElement returns null for an unknown region id', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let element;
    act(() => { element = result.current.addElement('does-not-exist', baseSpec()); });
    expect(element).toBeNull();
  });
});

describe('useTextOverlays - moveRegionStart/End return the updated region (T6630 round 4)', () => {
  it('moveRegionStart returns the updated region with the new startTime applied', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(3, baseSpec()); });

    let updated;
    act(() => { updated = result.current.moveRegionStart(region.id, 1.5); });

    expect(updated).toBeTruthy();
    expect(updated.id).toBe(region.id);
    expect(updated.startTime).toBe(1.5);
    expect(updated.endTime).toBe(region.endTime); // untouched edge unchanged
    expect(updated.elements).toEqual(region.elements); // elements untouched

    const inState = result.current.textOverlays.find((r) => r.id === region.id);
    expect(inState.startTime).toBe(1.5);
  });

  it('moveRegionEnd returns the updated region with the new endTime applied', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(3, baseSpec()); });

    let updated;
    act(() => { updated = result.current.moveRegionEnd(region.id, 8); });

    expect(updated).toBeTruthy();
    expect(updated.endTime).toBe(8);
    expect(updated.startTime).toBe(region.startTime);
  });

  it('moveRegionStart/End enforce a minimum span and cannot cross the partner edge', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(3, baseSpec()); }); // e.g. [3, 5]

    let updated;
    act(() => { updated = result.current.moveRegionStart(region.id, region.endTime + 1); });

    expect(updated).toBeTruthy();
    expect(updated.startTime).toBeLessThan(updated.endTime);
  });
});

describe('useTextOverlays - moveRegionBlock moves the whole region (T6610, region-scoped)', () => {
  it('moves start AND end together, preserving duration, and returns the updated region', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(2, baseSpec()); }); // [2, 4], duration 2
    const span = region.endTime - region.startTime;

    let updated;
    act(() => { updated = result.current.moveRegionBlock(region.id, 6); });

    expect(updated).toBeTruthy();
    expect(updated.id).toBe(region.id);
    expect(updated.startTime).toBeCloseTo(6, 5);
    expect(updated.endTime).toBeCloseTo(6 + span, 5);
    expect(updated.endTime - updated.startTime).toBeCloseTo(span, 5);
  });

  it('clamps at the LEFT edge (start cannot go below 0), duration preserved', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(2, baseSpec()); });
    const span = region.endTime - region.startTime;

    let updated;
    act(() => { updated = result.current.moveRegionBlock(region.id, -5); });

    expect(updated.startTime).toBe(0);
    expect(updated.endTime).toBeCloseTo(span, 5);
  });

  it('clamps at the RIGHT edge (end cannot exceed duration), duration preserved', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(2, baseSpec()); });
    const span = region.endTime - region.startTime;

    let updated;
    act(() => { updated = result.current.moveRegionBlock(region.id, 100); });

    expect(updated.endTime).toBeCloseTo(10, 5);
    expect(updated.startTime).toBeCloseTo(10 - span, 5);
  });

  it('returns null for an unknown id (nothing to move)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));
    act(() => { result.current.addRegion(2, baseSpec()); });

    let updated;
    act(() => { updated = result.current.moveRegionBlock('does-not-exist', 5); });
    expect(updated).toBeNull();
  });
});

describe('useTextOverlays - updateElementSpec targets ONE element (T6630 round 4)', () => {
  it('updateElementSpec replaces that element\'s spec wholesale and returns it', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec()); });
    const elementId = region.elements[0].id;

    const nextSpec = baseSpec({ text: 'CHANGED', color: '#FF0000' });
    let updated;
    act(() => { updated = result.current.updateElementSpec(elementId, nextSpec); });

    expect(updated).toBeTruthy();
    expect(updated.spec).toEqual(nextSpec);
    expect(updated.id).toBe(elementId);
    expect(updated.regionId).toBe(region.id);

    const inState = result.current.textOverlays[0].elements.find((el) => el.id === elementId);
    expect(inState.spec).toEqual(nextSpec);
  });

  it('editing one element never touches a sibling element\'s spec', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec({ text: 'First' })); });
    let second;
    act(() => { second = result.current.addElement(region.id, baseSpec({ text: 'Second' })); });

    act(() => { result.current.updateElementSpec(second.id, baseSpec({ text: 'Second Edited' })); });

    const first = result.current.textOverlays[0].elements.find((el) => el.id !== second.id);
    expect(first.spec.text).toBe('First'); // untouched
  });
});

describe('useTextOverlays - toggleElement targets ONE element (T6630 round 4)', () => {
  it('toggleElement flips enabled and returns the updated element', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec()); });
    const elementId = region.elements[0].id;

    let updated;
    act(() => { updated = result.current.toggleElement(elementId, false); });

    expect(updated).toBeTruthy();
    expect(updated.enabled).toBe(false);

    const inState = result.current.textOverlays[0].elements.find((el) => el.id === elementId);
    expect(inState.enabled).toBe(false);
  });
});

describe('useTextOverlays - deleteElement / deleteRegion (T6630 round 4)', () => {
  it('deleteElement removes an element WITHOUT deleting the region when others remain', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec({ text: 'First' })); });
    let second;
    act(() => { second = result.current.addElement(region.id, baseSpec({ text: 'Second' })); });

    let removed;
    act(() => { removed = result.current.deleteElement(second.id); });

    expect(removed.id).toBe(second.id);
    expect(result.current.textOverlays).toHaveLength(1); // region survives
    expect(result.current.textOverlays[0].elements).toHaveLength(1);
  });

  it('deleteElement on the LAST element of a region deletes the region too', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec()); });
    const elementId = region.elements[0].id;

    act(() => { result.current.deleteElement(elementId); });

    expect(result.current.textOverlays).toHaveLength(0); // region gone
  });

  it('deleteRegion removes the region and all its elements in one call', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec({ text: 'First' })); });
    act(() => { result.current.addElement(region.id, baseSpec({ text: 'Second' })); });

    let removed;
    act(() => { removed = result.current.deleteRegion(region.id); });

    expect(removed).toBeTruthy();
    expect(removed.elements).toHaveLength(2);
    expect(result.current.textOverlays).toHaveLength(0);
  });

  it('delete -> re-add mirrors the T5644 fix: re-add returns a NEW id, not the deleted one', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let first;
    act(() => { first = result.current.addRegion(3, baseSpec()); });
    act(() => { result.current.deleteRegion(first.id); });

    let readded;
    act(() => { readded = result.current.addRegion(3, baseSpec()); });

    expect(readded).toBeTruthy();
    expect(readded.id).not.toBe(first.id);
    expect(result.current.textOverlays).toHaveLength(1);
  });
});

describe('useTextOverlays - selection (T6630 round 4)', () => {
  it('selectRegion auto-selects the region\'s FIRST element', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec()); });
    act(() => { result.current.selectRegion(region.id); });

    expect(result.current.selectedRegionId).toBe(region.id);
    expect(result.current.selectedElementId).toBe(region.elements[0].id);
  });

  it('selectElement also selects its parent region', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec()); });
    act(() => { result.current.selectElement(region.elements[0].id); });

    expect(result.current.selectedRegionId).toBe(region.id);
    expect(result.current.selectedElementId).toBe(region.elements[0].id);
  });

  it('selectRegion(null) clears both selections', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    let region;
    act(() => { region = result.current.addRegion(0, baseSpec()); });
    act(() => { result.current.selectRegion(region.id); });
    act(() => { result.current.selectRegion(null); });

    expect(result.current.selectedRegionId).toBeNull();
    expect(result.current.selectedElementId).toBeNull();
  });
});

describe('useTextOverlays - restore is read-only (T6630 round 4, region shape)', () => {
  it('restoreTextOverlays hydrates state from backend-shaped REGION entries without mutating input', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    const saved = [
      {
        id: 'txt_saved1',
        startTime: 1,
        endTime: 4,
        elements: [{ id: 'el_saved1', spec: baseSpec(), enabled: true }],
      },
    ];

    act(() => { result.current.restoreTextOverlays(saved, 10); });

    expect(result.current.textOverlays).toHaveLength(1);
    expect(result.current.textOverlays[0]).toEqual(
      expect.objectContaining({ id: 'txt_saved1', startTime: 1, endTime: 4 })
    );
    expect(result.current.textOverlays[0].elements).toHaveLength(1);
    expect(result.current.textOverlays[0].elements[0].id).toBe('el_saved1');
  });

  it('restoreTextOverlays hydrates a region with MULTIPLE elements (the round-4 model)', () => {
    const { result } = renderHook(() => useTextOverlays());
    act(() => result.current.initializeWithDuration(10));

    const saved = [
      {
        id: 'txt_multi',
        startTime: 0,
        endTime: 3,
        elements: [
          { id: 'el_a', spec: baseSpec({ text: 'A' }), enabled: true },
          { id: 'el_b', spec: baseSpec({ text: 'B' }), enabled: false },
        ],
      },
    ];

    act(() => { result.current.restoreTextOverlays(saved, 10); });

    expect(result.current.textOverlays[0].elements).toHaveLength(2);
    expect(result.current.textOverlays[0].elements[1].enabled).toBe(false);
  });
});

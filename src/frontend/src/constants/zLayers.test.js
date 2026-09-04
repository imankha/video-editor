import { describe, it, expect } from 'vitest';
import { Z } from './zLayers';

/**
 * T6600 — the ordered z-index ladder is the contract the whole overlay stack
 * depends on. jsdom can't prove pixel stacking (that's the real-browser QA spec,
 * e2e/T6600-modal-z-order.qa.spec.js), but it CAN lock the ORDER so a future edit
 * can't silently reorder a rung and regress the layering that the migrated call
 * sites (CollectionPlayer/PublishedReelsPanel/LockedReason/IntroCards) now read from.
 */

// 'z-40' -> 40, 'z-[70]' -> 70
const num = (cls) => parseInt(cls.replace(/^z-\[?(\d+)\]?$/, '$1'), 10);

const LADDER = [
  'DROPDOWN',
  'MODAL',
  'OVERLAY_BACKDROP',
  'PLAYER',
  'MODAL_ELEVATED',
  'INTRO',
  'ALERT',
  'TOAST',
  'SHARE',
  'SYSTEM',
];

describe('zLayers scale (T6600)', () => {
  it('exposes exactly the named rungs, each a parseable z class', () => {
    expect(Object.keys(Z).sort()).toEqual([...LADDER].sort());
    for (const key of LADDER) {
      expect(Number.isFinite(num(Z[key])), `${key}=${Z[key]}`).toBe(true);
    }
  });

  it('is STRICTLY increasing in declared order (the readable ladder)', () => {
    for (let i = 1; i < LADDER.length; i++) {
      const lo = num(Z[LADDER[i - 1]]);
      const hi = num(Z[LADDER[i]]);
      expect(hi, `${LADDER[i]}(${hi}) must outrank ${LADDER[i - 1]}(${lo})`).toBeGreaterThan(lo);
    }
  });

  it('encodes every documented cross-component relationship', () => {
    // CollectionPlayer / DraftTile preview cover a standard modal (PublishedReelsPanel).
    expect(num(Z.PLAYER)).toBeGreaterThan(num(Z.MODAL));
    // A player's backdrop sits above the modal layer but below its own panel.
    expect(num(Z.OVERLAY_BACKDROP)).toBeGreaterThan(num(Z.MODAL));
    expect(num(Z.OVERLAY_BACKDROP)).toBeLessThan(num(Z.PLAYER));
    // The intro-card (nested) modal outranks the tile-portal layer — the T6600 fix.
    expect(num(Z.MODAL_ELEVATED)).toBeGreaterThan(num(Z.PLAYER));
    // The intro-card preroll outranks a nested modal but not an alert.
    expect(num(Z.INTRO)).toBeGreaterThan(num(Z.MODAL_ELEVATED));
    // LockedReasonModal / confirmations stay above the player and nested modals.
    expect(num(Z.ALERT)).toBeGreaterThan(num(Z.PLAYER));
    expect(num(Z.ALERT)).toBeGreaterThan(num(Z.MODAL_ELEVATED));
    expect(num(Z.ALERT)).toBeGreaterThan(num(Z.INTRO));
    // Toasts and system banners are top-most.
    expect(num(Z.TOAST)).toBeGreaterThan(num(Z.ALERT));
    // The share-playback dialog outranks the recap player (TOAST) it nests inside.
    expect(num(Z.SHARE)).toBeGreaterThan(num(Z.TOAST));
    expect(num(Z.SYSTEM)).toBeGreaterThan(num(Z.SHARE));
  });
});

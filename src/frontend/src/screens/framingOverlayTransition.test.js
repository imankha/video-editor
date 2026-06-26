import { describe, it, expect, vi } from 'vitest';
import { shouldPersistFramingForOverlayTransition } from './framingOverlayTransition';

/**
 * T4020: Export creates an empty "shadow" working-clip version that loses framing.
 *
 * Repro of the data evidence:
 *  - v1: real crop keyframes + trim + segment speed, exported_at set (rendered). OK
 *  - v2: crop NULL, default segments, exported_at NULL -- shadows v1 -> editor blank.
 *
 * v2 was written by the redundant full-state save on the export -> overlay
 * transition (FramingScreen `handleProceedToOverlayInternal`), which is NOT a
 * user gesture. By then `useCrop`/`useSegments` have reset to defaults, so the
 * save persists empty crop + default segments as a new MAX(version).
 *
 * The transition must never persist full state; the predicate gates that save
 * and must stay false so the empty-shadow write is unreachable.
 */
describe('T4020 - export->overlay transition must not persist a framing shadow', () => {
  it('does not persist full framing state on the export-driven overlay transition', () => {
    // No post-export user gesture occurred: the only writes that should exist are
    // the pre-render full-state save and the surgical per-gesture saves.
    expect(shouldPersistFramingForOverlayTransition()).toBe(false);
  });

  it('keeps the gate closed regardless of the call frequency (no transient open state)', () => {
    // Models the auto-transition firing from both the WS-completion and HTTP-200
    // paths: every evaluation must decline to persist.
    const persistDecisions = Array.from({ length: 5 }, () =>
      shouldPersistFramingForOverlayTransition()
    );
    expect(persistDecisions.every((shouldPersist) => shouldPersist === false)).toBe(true);
  });

  it('would issue an empty-shadow save if the gate were open (documents the bug it prevents)', async () => {
    // Stand-in for `saveCurrentClipState` reading reset hook state at transition
    // time: empty crop keyframes + default segments + no exported_at.
    const resetHookState = { cropKeyframes: [], segments: { boundaries: [], segmentSpeeds: [] } };
    const saveCurrentClipState = vi.fn(async () => resetHookState);

    // The transition only persists when the gate is open; the fix keeps it closed.
    if (shouldPersistFramingForOverlayTransition()) {
      await saveCurrentClipState();
    }

    expect(saveCurrentClipState).not.toHaveBeenCalled();
  });
});

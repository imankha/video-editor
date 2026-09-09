import { describe, it, expect, vi } from 'vitest';
import {
  shouldPersistFocusForOverlayTransition,
  shouldSkipFocusCompletionPreview,
} from './focusOverlayTransition';

/**
 * T4020: Export creates an empty "shadow" working-clip version that loses framing.
 *
 * Repro of the data evidence:
 *  - v1: real crop keyframes + trim + segment speed, exported_at set (rendered). OK
 *  - v2: crop NULL, default segments, exported_at NULL -- shadows v1 -> editor blank.
 *
 * v2 was written by the redundant full-state save on the export -> overlay
 * transition (FocusScreen `handleProceedToOverlayInternal`), which is NOT a
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
    expect(shouldPersistFocusForOverlayTransition()).toBe(false);
  });

  it('keeps the gate closed regardless of the call frequency (no transient open state)', () => {
    // Models the auto-transition firing from both the WS-completion and HTTP-200
    // paths: every evaluation must decline to persist.
    const persistDecisions = Array.from({ length: 5 }, () =>
      shouldPersistFocusForOverlayTransition()
    );
    expect(persistDecisions.every((shouldPersist) => shouldPersist === false)).toBe(true);
  });

  it('would issue an empty-shadow save if the gate were open (documents the bug it prevents)', async () => {
    // Stand-in for `saveCurrentClipState` reading reset hook state at transition
    // time: empty crop keyframes + default segments + no exported_at.
    const resetHookState = { cropKeyframes: [], segments: { boundaries: [], segmentSpeeds: [] } };
    const saveCurrentClipState = vi.fn(async () => resetHookState);

    // The transition only persists when the gate is open; the fix keeps it closed.
    if (shouldPersistFocusForOverlayTransition()) {
      await saveCurrentClipState();
    }

    expect(saveCurrentClipState).not.toHaveBeenCalled();
  });
});

/**
 * T9280: a completed Focus export must land the user on the preview-first
 * completion screen (FocusPublishActionBar) whenever they are still in Focus for
 * the exported project. The completion callback skips the preview only when the
 * user has deliberately switched to a DIFFERENT project.
 *
 * The bug: the old guard `exportedProjectId !== currentlyViewingProjectId`
 * treated a null/absent selection (a transient no-project blip on mobile — an
 * in-flight selection clear / app auto-navigation) the same as a deliberate
 * switch, silently skipping the preview and dropping the user on the Clips tab.
 */
describe('T9280 - shouldSkipFocusCompletionPreview', () => {
  it('skips the preview when the user is on a genuinely DIFFERENT project (criterion 3)', () => {
    expect(shouldSkipFocusCompletionPreview('proj-A', 'proj-B')).toBe(true);
  });

  it('shows the preview when the exported project is still the selected one', () => {
    expect(shouldSkipFocusCompletionPreview('proj-A', 'proj-A')).toBe(false);
  });

  it('shows the preview when selection is null (transient blip, NOT a different project) - the bug', () => {
    // This is the core regression: null must NOT be reinterpreted as "moved away".
    expect(shouldSkipFocusCompletionPreview('proj-A', null)).toBe(false);
  });

  it('shows the preview for every absent-selection form (undefined / empty string)', () => {
    expect(shouldSkipFocusCompletionPreview('proj-A', undefined)).toBe(false);
    expect(shouldSkipFocusCompletionPreview('proj-A', '')).toBe(false);
  });

  it('never skips when there is no exported project id', () => {
    expect(shouldSkipFocusCompletionPreview(null, 'proj-A')).toBe(false);
    expect(shouldSkipFocusCompletionPreview(undefined, 'proj-B')).toBe(false);
  });

  it('matches numeric project ids the same way (same id -> show, different -> skip)', () => {
    // selectedProjectId can be numeric (project.id); identity comparison must hold.
    expect(shouldSkipFocusCompletionPreview(42, 42)).toBe(false);
    expect(shouldSkipFocusCompletionPreview(42, 43)).toBe(true);
  });
});

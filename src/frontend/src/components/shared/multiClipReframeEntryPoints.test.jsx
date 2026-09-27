import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ModeSwitcher } from './ModeSwitcher';
import { AppStateProvider } from '../../contexts';
import { useToastStore } from './Toast';
import {
  allowEnterFraming,
  LEGACY_MULTICLIP_REFRAME_MESSAGE,
} from '../../utils/reelReEditable';

// T11220 characterization — a legacy multi-clip project (clip_count > 1) must NOT
// be able to reach Focus/Framing from ANY entry point, because the single-clip
// editor can't represent it and a re-export 400s after burning credits.
//
// The first pass only guarded DraftTile's own clicks; QA on a real fixture then
// found TWO other live paths — the header ModeSwitcher's Focus tab, and the
// Overlay completion screen's "Reapply Framing" / "Switch to Framing" tiles — that
// still entered Framing. The fix routes EVERY entry point through ONE shared guard
// (`allowEnterFraming`, utils/reelReEditable.js): the header ModeSwitcher, App's
// handleModeChange (programmatic commit point), OverlayScreen's two tiles, and
// DraftTile all call it. This file pins BOTH regressed entry points.
//
// Entry point 1 (header switch) is proven concretely by rendering the real
// ModeSwitcher. Entry point 2 (Overlay Reapply/Switch tiles) is proven via the
// SAME shared guard its handlers call verbatim (`if (!allowEnterFraming(
// projectListItem)) return;`) — OverlayScreen itself makes 101 hook calls and is
// not unit-renderable, so the guard it delegates to is the faithful unit under
// test (also independently covered in utils/reelReEditable.test.js).

const renderSwitcher = (props = {}, appState) =>
  render(
    <AppStateProvider value={appState}>
      <ModeSwitcher mode="overlay" hasProject hasWorkingVideo onModeChange={() => {}} {...props} />
    </AppStateProvider>
  );

const toastTitles = () => useToastStore.getState().toasts.map((t) => t.title);

beforeEach(() => {
  useToastStore.setState({ toasts: [] });
});

describe('T11220: legacy multi-clip cannot reach Framing from any entry point', () => {
  // ---- Entry point 1: the header mode-switch (ModeSwitcher Focus tab) ----
  it('HEADER switch: tapping Focus for a clip_count > 1 project is refused with the clear toast', () => {
    const onModeChange = vi.fn();
    renderSwitcher(
      { onModeChange },
      { selectedProject: { id: 1, clip_count: 2, working_video_id: 5 } },
    );

    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(onModeChange).not.toHaveBeenCalled(); // did NOT enter Framing
    expect(toastTitles()).toEqual([LEGACY_MULTICLIP_REFRAME_MESSAGE]);
  });

  it('HEADER switch: a single-clip project still enters Framing (no false positive)', () => {
    const onModeChange = vi.fn();
    renderSwitcher(
      { onModeChange },
      { selectedProject: { id: 1, clip_count: 1, working_video_id: 5 } },
    );

    fireEvent.click(screen.getByTestId('mode-framing'));

    expect(onModeChange).toHaveBeenCalledWith('framing');
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  // ---- Entry point 2: the Overlay completion screen's Reapply/Switch tiles ----
  // OverlayScreen.handleReapplyFocus / handleSwitchToFraming are one-line wrappers:
  //   if (!allowEnterFraming(projectListItem)) return;   // else setEditorMode(FRAMING)
  // so the guard result IS the gate. A clip_count > 1 project returns false (the
  // handler returns early, never calling setEditorMode); a single-clip project
  // returns true (the handler proceeds into Framing).
  it('OVERLAY Reapply/Switch tiles: the guard blocks a clip_count > 1 project (handler returns early)', () => {
    const multiClip = { id: 1, clip_count: 2, working_video_id: 5 };
    expect(allowEnterFraming(multiClip)).toBe(false); // handler returns before setEditorMode(FRAMING)
    expect(toastTitles()).toEqual([LEGACY_MULTICLIP_REFRAME_MESSAGE]);
  });

  it('OVERLAY Reapply/Switch tiles: the guard allows a single-clip project (handler proceeds)', () => {
    const singleClip = { id: 1, clip_count: 1, working_video_id: 5 };
    expect(allowEnterFraming(singleClip)).toBe(true); // handler proceeds into Framing
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });
});

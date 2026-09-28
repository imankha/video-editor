import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

// T11120: leaving the editor on an UNRATED play opens the "Rate this play" gate
// (rateGate state) instead of closing / switching / navigating; a RATED play
// leaves normally. Picking a rating persists {rating} through the normal write
// path, awaits the region write, then runs the stashed continuation. Dismissing
// writes nothing. Delete play always bypasses the gate.
//
// Drives the REAL AnnotateContainer hook (same harness as
// AnnotateContainer.createAtTap.test.jsx): `apiFetch` mocked so the create POST
// / update PUT hit the mock, `useAnnotateState` wrapped so `annotateGameId` is
// set without the full upload/load flow. handleAddClipFromButton (from NONE)
// creates the region AND opens the editor on it (EDITING) with NO rating — the
// exact unrated-play state the gate guards.

vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

vi.mock('../modes/annotate', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useAnnotateState: (...args) => ({
      ...actual.useAnnotateState(...args),
      annotateGameId: 42,
      annotateVideoMetadata: { duration: 120 },
    }),
  };
});

import apiFetch from '../utils/apiFetch';
import { AnnotateContainer } from './AnnotateContainer';
import { useAuthStore } from '../stores/authStore';
import { useQuestStore } from '../stores/questStore';
import { useToastStore } from '../components/shared/Toast';

const flush = () => new Promise((r) => setTimeout(r, 0));

function baseProps(overrides = {}) {
  return {
    videoRef: { current: null },
    currentTime: 10,
    duration: 120,
    isPlaying: false,
    togglePlay: vi.fn(),
    pause: vi.fn(),
    stepForward: vi.fn(),
    stepBackward: vi.fn(),
    seekBackward: vi.fn(),
    restart: vi.fn(),
    seek: vi.fn(),
    getGame: vi.fn(),
    loadGame: vi.fn(),
    fetchProjects: vi.fn(),
    setEditorMode: vi.fn(),
    onOpenReelInFocus: vi.fn(),
    ...overrides,
  };
}

const authOriginal = useAuthStore.getState();
const questOriginal = useQuestStore.getState();

// Mark a play from a clean (NONE) state: creates the region + backend row and
// leaves the editor EDITING on it, with NO rating. Returns the region id.
async function markUnratedPlay(result) {
  await act(async () => {
    result.current.handleAddClipFromButton();
  });
  await act(async () => { await flush(); });
  return result.current.clipRegions[0].id;
}

function putCallsWith(pred) {
  return apiFetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT' && pred(JSON.parse(opts.body)));
}

describe('AnnotateContainer — "Rate this play" gate (T11120)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false, success: true }) });
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({
      recordAchievement: vi.fn(),
      fetchProgress: vi.fn().mockResolvedValue(undefined),
    });
    window.matchMedia = (query) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    useToastStore.setState({ toasts: [] });
  });

  afterEach(() => {
    useAuthStore.setState(authOriginal, true);
    useQuestStore.setState(questOriginal, true);
    useToastStore.setState({ toasts: [] });
  });

  // ---- Route 1: closeWithCommit funnel (Done / X / Escape / keepMarkingCta) ----
  it('Route 1 (Done/X/Escape -> handleOverlayClose): an UNRATED play opens the gate instead of closing', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    expect(result.current.showAnnotateOverlay).toBe(true);
    expect(result.current.rateGate).toBeNull();

    act(() => { result.current.handleOverlayClose(); });

    expect(result.current.rateGate).toBeTruthy();
    expect(result.current.rateGate.regionId).toBe(id);
    expect(result.current.showAnnotateOverlay).toBe(true); // did NOT leave
  });

  it('Route 1: a RATED play leaves normally (no gate, editor closes)', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id, { rating: 4 }); });

    act(() => { result.current.handleOverlayClose(); });

    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(false);
  });

  // ---- Route 2: empty-timeline click -> closeOverlay ----
  it('Route 2 (empty timeline click): UNRATED play gates; RATED play closes', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);

    // Seek far outside the ~[4,12]s region -> no region at target -> would close.
    act(() => { result.current.handleTimelineSeek(60); });
    expect(result.current.rateGate?.regionId).toBe(id);
    expect(result.current.showAnnotateOverlay).toBe(true);

    // Rate it, dismiss the (test-only) leftover gate, then the same seek closes.
    act(() => { result.current.handleRateGateDismiss(); });
    await act(async () => { await result.current.updateClipRegion(id, { rating: 2 }); });
    act(() => { result.current.handleTimelineSeek(60); });
    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(false);
  });

  // ---- Route 4 (switch play) mechanism: switching to the SAME play never gates ----
  it('Route 4 (switch): selecting the SAME play being edited never gates', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    act(() => { result.current.handleSelectRegion(id); });
    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(true);
  });

  // ---- Shared guard (routes 4 & 5 delegate here) ----
  it('guardRateThenExit: gates + stashes the continuation on an unrated play; runs it immediately once rated', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);

    const proceed = vi.fn();
    let gated;
    act(() => { gated = result.current.guardRateThenExit(id, proceed); });
    expect(gated).toBe(true);
    expect(proceed).not.toHaveBeenCalled();
    expect(result.current.rateGate.regionId).toBe(id);

    act(() => { result.current.handleRateGateDismiss(); });
    await act(async () => { await result.current.updateClipRegion(id, { rating: 3 }); });

    const proceed2 = vi.fn();
    act(() => { gated = result.current.guardRateThenExit(id, proceed2); });
    expect(gated).toBe(false);
    expect(proceed2).toHaveBeenCalledTimes(1);
    expect(result.current.rateGate).toBeNull();
  });

  // ---- Picking a rating persists it and CONTINUES the original exit ----
  it('handleRateGatePick: persists {rating} via the normal write path, awaits it, then runs the continuation', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); }); // gated (proceed = closeOverlay)

    apiFetch.mockClear();
    await act(async () => { await result.current.handleRateGatePick(5); });

    // A PUT carrying rating:5 reached the network on this region's raw_clip.
    expect(putCallsWith((b) => b.rating === 5).length).toBe(1);
    // Gate cleared and the stashed exit ran (editor closed).
    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(false);
  });

  // ---- Dismissing the gate writes NOTHING ----
  it('handleRateGateDismiss ("Keep editing"/Escape): clears the gate, writes nothing, stays in the editor', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); });
    expect(result.current.rateGate).toBeTruthy();

    apiFetch.mockClear();
    act(() => { result.current.handleRateGateDismiss(); });

    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(true);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  // ---- Route 3: mobile fullscreen exit -> closeOverlay ----
  // isMobile: exiting fullscreen closes the editor (T9500), so it is an exit
  // that must gate on an unrated play WITHOUT dropping out of fullscreen behind
  // the modal (the fullscreen-aware continuation restores that on the pick).
  it('Route 3 (mobile fullscreen exit): exiting fullscreen on an UNRATED play gates; the pick then exits fullscreen and closes', async () => {
    // useIsMobile reads matchMedia's mobile query in a lazy initializer at mount,
    // so make it match BEFORE renderHook (beforeEach set it non-matching).
    window.matchMedia = (query) => ({
      matches: /max-width:\s*1023px/.test(query),
      media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    });
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);

    // Enter fullscreen while EDITING the unrated play (entering never gates).
    act(() => { result.current.handleToggleFullscreen(); });
    expect(result.current.annotateFullscreen).toBe(true);

    // Exit fullscreen -> gates: returns true, stays fullscreen, editor still open.
    let gated;
    act(() => { gated = result.current.handleToggleFullscreen(); });
    expect(gated).toBe(true);
    expect(result.current.rateGate?.regionId).toBe(id);
    expect(result.current.annotateFullscreen).toBe(true);  // did NOT drop out of fullscreen
    expect(result.current.showAnnotateOverlay).toBe(true);  // editor still open

    // Picking a rating persists it, then runs the fullscreen-aware continuation.
    apiFetch.mockClear();
    await act(async () => { await result.current.handleRateGatePick(3); });
    expect(putCallsWith((b) => b.rating === 3).length).toBe(1);
    expect(result.current.rateGate).toBeNull();
    expect(result.current.annotateFullscreen).toBe(false); // NOW exits fullscreen
    expect(result.current.showAnnotateOverlay).toBe(false); // and closes the editor
  });

  // ---- Route 4: switching to a DIFFERENT play -> the switch is an exit ----
  it('Route 4 (switch play): switching away from an UNRATED play gates; the pick persists it then completes the switch', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));

    // Play 1: create, RATE it, then leave it so it can serve as the switch TARGET.
    const id1 = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id1, { rating: 5 }); });
    act(() => { result.current.handleOverlayClose(); });        // rated -> closes to SELECTED
    act(() => { result.current.selectAnnotateRegion(null); });  // SELECTED -> NONE
    expect(result.current.showAnnotateOverlay).toBe(false);

    // Play 2: create it -> now EDITING a second, UNRATED play.
    await act(async () => { result.current.handleAddClipFromButton(); await flush(); });
    const id2 = result.current.clipRegions.find((r) => r.rating == null).id;
    expect(id2).not.toBe(id1);
    expect(result.current.annotateSelectedRegionId).toBe(id2);
    expect(result.current.showAnnotateOverlay).toBe(true);

    // Attempt to switch to play 1 -> gate on the unrated play 2; switch not done.
    apiFetch.mockClear();
    act(() => { result.current.handleSelectRegion(id1); });
    expect(result.current.rateGate?.regionId).toBe(id2);
    expect(result.current.annotateSelectedRegionId).toBe(id2);
    expect(result.current.showAnnotateOverlay).toBe(true);

    // Pick a rating -> ONE PUT carrying it on play 2, then the switch completes.
    await act(async () => { await result.current.handleRateGatePick(2); });
    expect(putCallsWith((b) => b.rating === 2).length).toBe(1);
    expect(result.current.rateGate).toBeNull();
    expect(result.current.annotateSelectedRegionId).toBe(id1); // switched to the target
    expect(result.current.showAnnotateOverlay).toBe(true);     // still EDITING (now play 1)
  });

  // ---- Race: a dismiss (or re-pick) while a pick's write is in-flight must NOT
  // later run the stashed continuation of the ABANDONED gate. ----
  it('dismissing while a pick write is in-flight does not run the stale continuation', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); }); // gate; proceed = closeOverlay
    expect(result.current.rateGate).toBeTruthy();

    // Suspend the pick's write so handleRateGatePick hangs on the write await
    // (before it would clear the gate and run the continuation).
    let releaseWrite;
    apiFetch.mockReset();
    apiFetch.mockImplementation(() => new Promise((res) => {
      releaseWrite = () => res({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, success: true }) });
    }));

    let pickPromise;
    await act(async () => {
      pickPromise = result.current.handleRateGatePick(3);
      await flush(); // let the write queue dispatch apiFetch (which now hangs)
    });
    expect(typeof releaseWrite).toBe('function'); // the write is genuinely in flight

    // User backs out with "Keep editing" while the write is still in flight.
    act(() => { result.current.handleRateGateDismiss(); });
    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(true);

    // The write resolves: the abandoned gate's continuation (closeOverlay) must
    // NOT fire — the user chose to stay in the editor.
    await act(async () => { releaseWrite(); await pickPromise; await flush(); });
    expect(result.current.showAnnotateOverlay).toBe(true);
  });

  // ---- Delete play always bypasses the gate ----
  it('Delete play bypasses the gate even on an unrated play', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    await act(async () => {
      result.current.handleDeletePlayFromEditor(id);
      await flush();
    });
    expect(result.current.rateGate).toBeNull();
    expect(result.current.clipRegions.length).toBe(0);
  });
});

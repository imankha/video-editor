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
    // T11130: pick a 1-4 rating so the continuation is the plain close (a
    // 5-star pick flows into the Highlight choice card instead — covered below).
    await act(async () => { await result.current.handleRateGatePick(3); });

    // A PUT carrying rating:3 reached the network on this region's raw_clip.
    expect(putCallsWith((b) => b.rating === 3).length).toBe(1);
    // Gate cleared and the stashed exit ran (editor closed).
    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(false);
  });

  // ---- Dismissing the gate writes NOTHING ----
  it('handleRateGateDismiss (Escape): clears the gate, writes nothing, stays in the editor', async () => {
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
    // T11130: rate it 4 (not 5) — a 5-star Done would open the Highlight choice
    // card instead of closing; this play is only setup for the switch target.
    const id1 = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id1, { rating: 4 }); });
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

    // User backs out with Escape while the write is still in flight.
    act(() => { result.current.handleRateGateDismiss(); });
    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(true);

    // The write resolves: the abandoned gate's continuation (closeOverlay) must
    // NOT fire — the user chose to stay in the editor.
    await act(async () => { releaseWrite(); await pickPromise; await flush(); });
    expect(result.current.showAnnotateOverlay).toBe(true);
  });

  // ---- Race: two quick picks while the write is in-flight run the continuation
  // ONCE. Rating rows aren't disabled mid-write and setRateGate(null) is batched
  // (rateGateRef only refreshes on render), so without a synchronous in-flight
  // guard BOTH picks pass the `rateGateRef.current !== gate` check and fire
  // proceed() twice (dup finishAnnotation POST / dup navigation). ----
  it('two picks while a pick write is in-flight run the continuation exactly once', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);

    // Open the gate with a SPY continuation so a double-fire is countable (a plain
    // closeOverlay is idempotent and would look identical on a second call).
    const proceed = vi.fn();
    act(() => { result.current.guardRateThenExit(id, proceed); });
    expect(result.current.rateGate?.regionId).toBe(id);

    // Suspend the rating write(s) so both picks hang on the write await together.
    // Collect EVERY dispatched write's resolver: without the guard the second pick
    // enqueues its own FIFO write behind the first (clipRegionsRef hasn't refreshed
    // yet), so draining all of them is what lets both continuations reach proceed().
    const resolvers = [];
    apiFetch.mockReset();
    apiFetch.mockImplementation(() => new Promise((res) => {
      resolvers.push(() => res({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, success: true }) }));
    }));

    // Two picks back-to-back, with a render between them, while the write hangs.
    let pick1, pick2;
    await act(async () => {
      pick1 = result.current.handleRateGatePick(4);
      await flush(); // pick1 dispatches its (now hanging) write; a render lands
      pick2 = result.current.handleRateGatePick(4);
      await flush();
    });
    expect(resolvers.length).toBeGreaterThan(0); // a write is genuinely in flight

    // Drain all in-flight writes (FIFO: releasing one may dispatch the next), then
    // let both picks settle. proceed() must fire EXACTLY once, never twice.
    await act(async () => {
      for (let i = 0; i < 6 && resolvers.length; i++) {
        resolvers.splice(0).forEach((r) => r());
        await flush();
      }
      await pick1; await pick2; await flush();
    });
    expect(proceed).toHaveBeenCalledTimes(1);
    expect(result.current.rateGate).toBeNull();
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

// T11130: Done on a Highlight-rated play not yet a highlight opens the in-place
// "Make this a highlight now?" choice card (highlightChoice state). Sequential
// with the T11120 rate gate — a play just rated Highlight in the gate flows into
// the card; the two never block at once. 1-4 stars just close (H3).
describe('AnnotateContainer — Done -> Highlight choice card (T11130)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false, success: true }) });
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({ recordAchievement: vi.fn(), fetchProgress: vi.fn().mockResolvedValue(undefined) });
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

  it('an already-rated-Highlight play (no project) opens the card on Done instead of closing', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id, { rating: 5 }); });

    act(() => { result.current.handleOverlayClose(); });

    expect(result.current.rateGate).toBeNull();                 // already rated -> no rate gate
    expect(result.current.highlightChoice?.regionId).toBe(id);  // the card opens
    expect(result.current.showAnnotateOverlay).toBe(true);      // editor stays open (mode-swap)
  });

  it('a play just rated Highlight IN THE GATE flows into the card (sequential, not both at once)', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);

    act(() => { result.current.handleOverlayClose(); });        // unrated -> rate gate
    expect(result.current.rateGate?.regionId).toBe(id);
    expect(result.current.highlightChoice).toBeNull();          // not both at once

    await act(async () => { await result.current.handleRateGatePick(5); });

    expect(result.current.rateGate).toBeNull();                 // gate cleared first
    expect(result.current.highlightChoice?.regionId).toBe(id);  // then the card opens
    expect(result.current.showAnnotateOverlay).toBe(true);
  });

  it('a 1-4 star Done closes with no card (H3)', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id, { rating: 4 }); });

    act(() => { result.current.handleOverlayClose(); });

    expect(result.current.highlightChoice).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(false);
  });

  it('Escape (dismiss) clears the card, writes nothing, stays in the editor', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id, { rating: 5 }); });
    act(() => { result.current.handleOverlayClose(); });
    expect(result.current.highlightChoice?.regionId).toBe(id);

    apiFetch.mockClear();
    act(() => { result.current.handleHighlightChoiceDismiss(); });

    expect(result.current.highlightChoice).toBeNull();
    expect(apiFetch).not.toHaveBeenCalled();
    expect(result.current.showAnnotateOverlay).toBe(true); // still EDITING
  });

  it('Make Highlight Now creates the project (createProject, silent) and navigates to Focus', async () => {
    const onOpenReelInFocus = vi.fn();
    const { result } = renderHook(() => AnnotateContainer(baseProps({ onOpenReelInFocus })));
    const id = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id, { rating: 5 }); });
    act(() => { result.current.handleOverlayClose(); });
    expect(result.current.highlightChoice?.regionId).toBe(id);

    // The create PUT returns a project id for the navigation.
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: true, project_id: 77, success: true }) });
    await act(async () => { await result.current.handleHighlightChoiceNow(); await flush(); });

    // createProject went out (silent -> no default reel-created toast).
    expect(putCallsWith((b) => b.create_project === true).length).toBe(1);
    expect(onOpenReelInFocus).toHaveBeenCalledWith(77);
    expect(result.current.highlightChoice).toBeNull();
    // No default "is now in Clips" toast on the silent Frame Now path.
    expect(useToastStore.getState().toasts.some((t) => /is now in Clips/i.test(t.title || ''))).toBe(false);
  });

  it('Keep Marking Plays creates the highlight, toasts the exact copy with no action, and closes the editor', async () => {
    const onOpenReelInFocus = vi.fn();
    const { result } = renderHook(() => AnnotateContainer(baseProps({ onOpenReelInFocus })));
    const id = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id, { rating: 5 }); });
    act(() => { result.current.handleOverlayClose(); });
    expect(result.current.highlightChoice?.regionId).toBe(id);

    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: true, project_id: 88, success: true }) });
    await act(async () => { await result.current.handleHighlightChoiceLater(); await flush(); });

    expect(putCallsWith((b) => b.create_project === true).length).toBe(1);
    // Does NOT navigate (Keep Marking Plays returns to marking plays).
    expect(onOpenReelInFocus).not.toHaveBeenCalled();
    // The card cleared and the editor closed.
    expect(result.current.highlightChoice).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(false);
    // Exactly the owner-written toast, no action button.
    const toasts = useToastStore.getState().toasts;
    const toast = toasts.find((t) => t.title === 'Highlight moved to Clips so you can edit it later');
    expect(toast).toBeTruthy();
    expect(toast.action).toBeUndefined();
  });

  it('double-tap on a create button fires exactly one create (synchronous ref guard)', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    await act(async () => { await result.current.updateClipRegion(id, { rating: 5 }); });
    act(() => { result.current.handleOverlayClose(); });
    expect(result.current.highlightChoice?.regionId).toBe(id);

    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: true, project_id: 99, success: true }) });
    // Two synchronous calls before the first settles — the in-flight ref blocks #2.
    await act(async () => {
      const a = result.current.handleHighlightChoiceNow();
      const b = result.current.handleHighlightChoiceNow();
      await Promise.all([a, b]);
      await flush();
    });
    expect(putCallsWith((b) => b.create_project === true).length).toBe(1);
  });
});

// T11400: picking a rating in the gate persists it + awaits the confirmed write
// before navigating (unchanged contract) — but the pick must get IMMEDIATE visual
// acknowledgement so it never feels unresponsive. `pendingRatingId` is set
// SYNCHRONOUSLY with the pick (before the await), drives the busy/selected state
// on RateThisPlayModal/RatingMeaningsList, and is cleared on success, abandon, or
// failure. The await-before-navigate + run-exactly-once guarantees are preserved.
describe('AnnotateContainer — rate-gate pick immediate feedback (T11400)', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, project_created: false, success: true }) });
    useAuthStore.setState({ isAuthenticated: true });
    useQuestStore.setState({ recordAchievement: vi.fn(), fetchProgress: vi.fn().mockResolvedValue(undefined) });
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

  it('(a) sets pendingRatingId synchronously on the pick — before the write resolves — and clears it after a confirmed write', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); }); // gate; proceed = closeOverlay
    expect(result.current.pendingRatingId).toBeNull();

    // Suspend the write so the pick hangs on the await — the pending state must
    // already be visible at this point (same render pass as the pick).
    let releaseWrite;
    apiFetch.mockReset();
    apiFetch.mockImplementation(() => new Promise((res) => {
      releaseWrite = () => res({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, success: true }) });
    }));

    let pickPromise;
    await act(async () => {
      pickPromise = result.current.handleRateGatePick(3);
      await flush(); // dispatch the (now hanging) write
    });
    // Immediate acknowledgement: the picked rating is pending while the write is
    // still in flight, and the gate is still mounted (nothing navigated yet).
    expect(result.current.pendingRatingId).toBe(3);
    expect(result.current.rateGate).toBeTruthy();
    expect(result.current.showAnnotateOverlay).toBe(true);

    // Write confirms -> pending clears and the stashed exit runs exactly once.
    await act(async () => { releaseWrite(); await pickPromise; await flush(); });
    expect(result.current.pendingRatingId).toBeNull();
    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(false);
  });

  it('(b) a second pick while the first write is in-flight does not change the pending rating (no-op)', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); });

    const resolvers = [];
    apiFetch.mockReset();
    apiFetch.mockImplementation(() => new Promise((res) => {
      resolvers.push(() => res({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, success: true }) }));
    }));

    let pick1, pick2;
    await act(async () => {
      pick1 = result.current.handleRateGatePick(4);
      await flush();
      pick2 = result.current.handleRateGatePick(2); // blocked by the in-flight guard
      await flush();
    });
    // The pending rating stays the FIRST pick's value; the second pick is a no-op.
    expect(result.current.pendingRatingId).toBe(4);

    await act(async () => {
      for (let i = 0; i < 6 && resolvers.length; i++) { resolvers.splice(0).forEach((r) => r()); await flush(); }
      await pick1; await pick2; await flush();
    });
    // Exactly one rating write landed (the first), carrying rating 4.
    expect(putCallsWith((b) => b.rating === 4).length).toBe(1);
    expect(putCallsWith((b) => b.rating === 2).length).toBe(0);
    expect(result.current.pendingRatingId).toBeNull();
  });

  it('(c) a failed write clears the pending state and leaves the gate open for retry', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); });

    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) });

    await act(async () => { await result.current.handleRateGatePick(3); await flush(); });

    // Failure restores an actionable surface: pending cleared, gate still open,
    // editor not navigated away.
    expect(result.current.pendingRatingId).toBeNull();
    expect(result.current.rateGate).toBeTruthy();
    expect(result.current.showAnnotateOverlay).toBe(true);
  });

  it('(d) dismissing while a pick write is in-flight clears the pending state', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); });

    let releaseWrite;
    apiFetch.mockReset();
    apiFetch.mockImplementation(() => new Promise((res) => {
      releaseWrite = () => res({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, success: true }) });
    }));

    let pickPromise;
    await act(async () => {
      pickPromise = result.current.handleRateGatePick(3);
      await flush();
    });
    expect(result.current.pendingRatingId).toBe(3);

    act(() => { result.current.handleRateGateDismiss(); });
    expect(result.current.pendingRatingId).toBeNull();
    expect(result.current.rateGate).toBeNull();

    // The abandoned write resolving must not run the stale continuation.
    await act(async () => { releaseWrite(); await pickPromise; await flush(); });
    expect(result.current.showAnnotateOverlay).toBe(true);
  });

  // NOTE (minor 4): on current master this case already passes EXCEPT for the
  // `pendingRatingId` assertion (that state doesn't exist pre-T11400) — so it is a
  // regression guard that the Brilliant -> Make-Highlight flow still works WITH the
  // immediate-feedback state, not independent proof of the downstream flow itself
  // (that belongs to the T11130 block above).
  it('(e) Brilliant (5) still flows into the Make Highlight card after the write confirms', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    const id = await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); });
    expect(result.current.rateGate?.regionId).toBe(id);

    await act(async () => { await result.current.handleRateGatePick(5); await flush(); });

    expect(result.current.pendingRatingId).toBeNull();
    expect(result.current.rateGate).toBeNull();
    expect(result.current.highlightChoice?.regionId).toBe(id); // downstream flow intact
    expect(result.current.showAnnotateOverlay).toBe(true);
  });

  // ---- MAJOR fix-round: re-picking the SAME rating after a failed write must retry ----
  // updateClipRegionWithSync applies the local state update BEFORE the write, so after
  // a failure the local state already equals the attempted rating. Without the
  // failed-key check, re-picking that same value is judged "clean", no retry is sent,
  // and settle() keeps reporting failure — the gate stays stuck (mobile has no Escape).
  it('(f) re-picking the SAME rating after a failed write sends exactly one retry, then the exit runs once', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); }); // gate; proceed = closeOverlay

    // First pick FAILS.
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) });
    await act(async () => { await result.current.handleRateGatePick(3); await flush(); });
    expect(putCallsWith((b) => b.rating === 3).length).toBe(1); // the failed attempt went out
    expect(result.current.rateGate).toBeTruthy();               // gate still open (stuck without the fix)
    expect(result.current.pendingRatingId).toBeNull();

    // Re-pick the SAME rating; now the write succeeds. Local state is already rating 3,
    // but the failed key forces the retry (the MAJOR fix).
    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, success: true }) });
    await act(async () => { await result.current.handleRateGatePick(3); await flush(); });

    expect(putCallsWith((b) => b.rating === 3).length).toBe(1); // exactly ONE retry PUT
    expect(result.current.rateGate).toBeNull();                 // gate cleared
    expect(result.current.showAnnotateOverlay).toBe(false);     // continuation ran (once)
    expect(result.current.pendingRatingId).toBeNull();
  });

  it('(g) after a failed write, picking a DIFFERENT rating still sends and completes (no regression)', async () => {
    const { result } = renderHook(() => AnnotateContainer(baseProps()));
    await markUnratedPlay(result);
    act(() => { result.current.handleOverlayClose(); });

    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({ success: false }) });
    await act(async () => { await result.current.handleRateGatePick(3); await flush(); });
    expect(result.current.rateGate).toBeTruthy();

    // A different value is never "clean" against local state, so it already retried
    // pre-fix — guard that the failed-key change didn't break it.
    apiFetch.mockClear();
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ raw_clip_id: 1, success: true }) });
    await act(async () => { await result.current.handleRateGatePick(4); await flush(); });

    expect(putCallsWith((b) => b.rating === 4).length).toBe(1);
    expect(result.current.rateGate).toBeNull();
    expect(result.current.showAnnotateOverlay).toBe(false);
  });
});

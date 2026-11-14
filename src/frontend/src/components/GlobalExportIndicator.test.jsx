import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GlobalExportIndicator, {
  getExportLabel,
  resolveEtaDisplay,
  etaSlotText,
  ETA_BUST_GRACE_MS,
  ETA_STALL_MS,
} from './GlobalExportIndicator';
import { useExportStore } from '../stores/exportStore';
import { EXPORT_PROGRESS } from '../config/displayNames';

// T8510: the indicator must never surface an internal id ("Project #N") and must
// stop showing a frozen time estimate once it has broken its own promise.

const NOW = new Date('2026-09-03T12:00:00Z').getTime();

/** A processing framing export, `elapsedSec` into its run at `percent`. */
function makeExport({
  exportId = 'export_1',
  projectId = 7,
  projectName = null,
  percent = 50,
  elapsedSec = 60,
  message = 'Upscaling...',
} = {}) {
  return {
    exportId,
    projectId,
    projectName,
    type: 'framing',
    status: 'processing',
    progress: { current: percent, total: 100, percent, message },
    startedAt: new Date(NOW - elapsedSec * 1000).toISOString(),
    completedAt: null,
    error: null,
    outputVideoId: null,
    outputFilename: null,
    gameId: null,
    gameName: null,
  };
}

/** T15950: a frame track whose last two windows both measured `msPerFrame` (settled). */
function settledTrack(frame, msPerFrame) {
  return { frame, at: NOW, rates: [msPerFrame, msPerFrame] };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  useExportStore.getState().reset();
  vi.useRealTimers();
  localStorage.clear();
});

describe('getExportLabel — no internal ids, ever (T8510)', () => {
  it('uses the project name when present', () => {
    expect(getExportLabel(makeExport({ projectName: 'Brilliant Goal' }))).toBe('Brilliant Goal');
  });

  it('falls back to "Your highlight" when the name is missing - never "Project #N"', () => {
    const label = getExportLabel(makeExport({ projectName: null, projectId: 1 }));
    expect(label).toBe('Your highlight');
    expect(label).not.toMatch(/Project #/);
  });

  it('annotate exports use the game name, falling back to "Play"', () => {
    const annotate = { ...makeExport(), type: 'annotate', gameName: 'Sat vs Rovers' };
    expect(getExportLabel(annotate)).toBe('Sat vs Rovers');
    expect(getExportLabel({ ...annotate, gameName: null })).toBe('Play');
  });
});

describe('resolveEtaDisplay — honest ETA, frame-rate based (T14860)', () => {
  it('returns null before any frame has been reported (frames not flowing yet)', () => {
    // T14860: the original bug -- percent=5 during "Getting your video ready" used to
    // extrapolate a "Less than a minute remaining" promise before rendering even started.
    const exp = makeExport({ percent: 5, elapsedSec: 2, message: 'Getting your video ready...' });
    expect(resolveEtaDisplay(exp, NOW, new Map(), new Map(), new Map())).toBeNull();
  });

  it('returns null on the very first frame sample (no rate yet)', () => {
    const exp = makeExport({ percent: 10, elapsedSec: 10, message: 'AI upscaling frame 20/150' });
    const frameTracks = new Map([[exp.exportId, { frame: 20, at: NOW, rates: [] }]]);
    expect(resolveEtaDisplay(exp, NOW, new Map(), new Map(), frameTracks)).toBeNull();
  });

  it('returns a live estimate from the measured per-frame rate once frames advance', () => {
    // 500ms/frame; 50 remaining -> 25s + 30s fixed tail = 55s = "About 1 minute".
    const exp = makeExport({ percent: 60, elapsedSec: 60, message: 'AI upscaling frame 100/150' });
    const frameTracks = new Map([[exp.exportId, settledTrack(100, 500)]]);
    const display = resolveEtaDisplay(exp, NOW, new Map(), new Map(), frameTracks);
    expect(display.stale).toBe(false);
    expect(display.formatted).toBe('About 1 minute');
  });

  it('goes stale once the promised deadline is exceeded by the grace period', () => {
    const exp = makeExport({ percent: 95, elapsedSec: 60, message: 'AI upscaling frame 140/150' });
    const frameTracks = new Map([[exp.exportId, settledTrack(140, 1250)]]);
    const deadlines = new Map([[exp.exportId, NOW - ETA_BUST_GRACE_MS - 1000]]);
    const display = resolveEtaDisplay(exp, NOW, deadlines, new Map(), frameTracks);
    expect(display.stale).toBe(true);
    // T9540: the raw engineering message is now mapped to honest N37 copy.
    // T9860 (3.3): upscaling now maps to its own "Sharpening the picture" phase, not Rendering.
    expect(display.fallbackText).toBe('Sharpening the picture');
  });

  it('stays live inside the 15s grace window past the deadline', () => {
    const exp = makeExport({ percent: 95, elapsedSec: 60, message: 'AI upscaling frame 140/150' });
    const frameTracks = new Map([[exp.exportId, settledTrack(140, 1250)]]);
    const deadlines = new Map([[exp.exportId, NOW - ETA_BUST_GRACE_MS + 5000]]);
    expect(resolveEtaDisplay(exp, NOW, deadlines, new Map(), frameTracks).stale).toBe(false);
  });

  it('never trusts a near-done ("about 1 minute") estimate while frames have been frozen for >30s', () => {
    // frame === totalFrames -> 0 remaining frames -> the estimate is just the fixed
    // post-upscale tail (30s = "About 1 minute"), the sub-minute case the stall rule guards.
    const exp = makeExport({ percent: 95, elapsedSec: 60, message: 'AI upscaling frame 150/150' });
    const frameTracks = new Map([[exp.exportId, settledTrack(140, 1250)]]);
    const tracks = new Map([[exp.exportId, { percent: 95, changedAt: NOW - ETA_STALL_MS - 1000 }]]);
    const display = resolveEtaDisplay(exp, NOW, new Map(), tracks, frameTracks);
    expect(display.stale).toBe(true);
  });

  it('a multi-minute estimate is NOT hidden by the stall rule (only sub-minute ones)', () => {
    const exp = makeExport({ percent: 30, elapsedSec: 300, message: 'AI upscaling frame 60/150' });
    const frameTracks = new Map([[exp.exportId, settledTrack(60, 5000)]]);
    const tracks = new Map([[exp.exportId, { percent: 30, changedAt: NOW - ETA_STALL_MS - 1000 }]]);
    expect(resolveEtaDisplay(exp, NOW, new Map(), tracks, frameTracks).stale).toBe(false);
  });

  it('returns null while a frame rate has not been observed, even late into the job', () => {
    const exp = makeExport({ percent: 95, elapsedSec: 60, message: '' });
    const deadlines = new Map([[exp.exportId, NOW - ETA_BUST_GRACE_MS - 1000]]);
    expect(resolveEtaDisplay(exp, NOW, deadlines, new Map(), new Map())).toBeNull();
  });

  it('T15530: clamps a live estimate so it never climbs back up once a lower number has shown', () => {
    // The averaged per-frame rate is measured from the FIRST frame sample to the
    // current one -- if the instantaneous rate slows down later in the job, the raw
    // recomputed remaining-time can read HIGHER than an earlier call's, even though
    // more frames have completed and less time is actually left (the task's own
    // repro: "4, 3, 2, 3, 2 minutes (non-monotonic)"). minSecondsTracks clamps the
    // displayed value to the lowest one ever shown for this export.
    const frameTracks = new Map([['export_m', settledTrack(60, 400)]]);
    const minSecondsTracks = new Map();

    // 400ms/frame at frame 60 of 200 -> 140 * 0.4s + 30s tail = 86s -> "About 1 minute".
    vi.advanceTimersByTime(20000);
    const expA = makeExport({ exportId: 'export_m', percent: 30, elapsedSec: 20, message: 'AI upscaling frame 60/200' });
    const displayA = resolveEtaDisplay(expA, Date.now(), new Map(), new Map(), frameTracks, minSecondsTracks);
    expect(displayA.formatted).toBe('About 1 minute');

    // 60s in (40s later), only 10 more frames done (60 -> 70) and both windows now
    // measure 1s/frame -- the raw extrapolation alone would read "About 3 minutes".
    frameTracks.set('export_m', settledTrack(70, 1000));
    vi.advanceTimersByTime(40000);
    const expB = makeExport({ exportId: 'export_m', percent: 35, elapsedSec: 60, message: 'AI upscaling frame 70/200' });
    const displayB = resolveEtaDisplay(expB, Date.now(), new Map(), new Map(), frameTracks, minSecondsTracks);
    expect(displayB.formatted).toBe('About 1 minute');
  });
});

describe('GlobalExportIndicator — live estimate stays within 1.5x of actual remaining time (T15530 AC3)', () => {
  // A slow early window (GPU warm-up) followed by a faster steady pace. Averaging that
  // window in, or showing it alone, overshoots the actual remaining time by >1.5x.
  // T15950: no estimate shows until two consecutive frame windows agree, so the slow
  // window is never shown and never blended in. The component's effect records each
  // sample after the render that shows it, so every reading waits one 1s tick.
  function sample(exportId, percent, frame, total) {
    act(() => {
      useExportStore.setState({
        activeExports: {
          [exportId]: makeExport({ exportId, percent, elapsedSec: 0, message: `AI upscaling frame ${frame}/${total}` }),
        },
      });
    });
  }
  function tick(ms) {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  }

  it('does not overshoot the actual remaining time by more than 1.5x after a slow start speeds up', () => {
    sample('export_acc', 20, 10, 200);
    render(<GlobalExportIndicator />);

    // 25s in: 10 frames in 25s (slow, 2.5s/frame). Alone, this window read "About 8
    // minutes" before T15950 against ~110s actually left; it is not shown.
    tick(25000);
    sample('export_acc', 25, 20, 200);
    tick(1000);
    expect(document.body.textContent).toContain(EXPORT_PROGRESS.ETA_VARIES);

    // 10s later: 20 frames in 10s (500ms/frame). The windows disagree 5x; averaging from
    // the first sample would read "About 4 minutes" (2.18x the ~110s left). Still withheld.
    tick(9000);
    sample('export_acc', 35, 40, 200);
    tick(1000);
    expect(document.body.textContent).toContain(EXPORT_PROGRESS.ETA_VARIES);
    expect(document.body.textContent).not.toContain('About 4 minutes');

    // 10s later, 500ms/frame again: 140 frames * 500ms + 30s tail = 100s -> "About 2 minutes".
    tick(9000);
    sample('export_acc', 45, 60, 200);
    tick(1000);
    expect(document.body.textContent).toContain('About 2 minutes remaining');
  });

  it('does not overshoot the actual remaining time by more than 1.5x WITHIN the first 20s of an anchor (T15530 AC3 fix round 2)', () => {
    // A slow-then-fast transition inside the first 20s: frame 2 at t=0, frame 4 at t=5s
    // (2500ms/frame), then the true 500ms/frame pace. Averaging from frame 2 read "About
    // 4 minutes" at frame 10 against ~125s actually left (1.92x).
    sample('export_early', 5, 2, 200);
    render(<GlobalExportIndicator />);
    tick(5000);
    sample('export_early', 8, 4, 200);
    tick(1000);
    expect(document.body.textContent).toContain(EXPORT_PROGRESS.ETA_VARIES);

    // t=8s, frame 10: 6 frames in 3s (500ms/frame) disagrees with the slow window.
    tick(2000);
    sample('export_early', 15, 10, 200);
    tick(1000);
    expect(document.body.textContent).not.toContain('About 4 minutes');
    expect(document.body.textContent).toContain(EXPORT_PROGRESS.ETA_VARIES);

    // t=11s, frame 16 at 500ms/frame again: 184 * 500ms + 30s = 122s -> "About 2 minutes".
    tick(2000);
    sample('export_early', 18, 16, 200);
    tick(1000);
    expect(document.body.textContent).toContain('About 2 minutes remaining');
  });
});

describe('GlobalExportIndicator — progress text never goes blank, even in the reported silent window (T15530 AC1)', () => {
  it('keeps real stage text visible through sparse/empty progress messages all the way to completion', () => {
    useExportStore.setState({
      activeExports: {
        export_silent: makeExport({
          exportId: 'export_silent', percent: 12, elapsedSec: 0, message: 'AI upscaling frame 10/160',
        }),
      },
    });
    render(<GlobalExportIndicator />);
    expect(document.body.textContent.trim()).not.toBe('');

    // The task's own repro: 90-110s with no text, phase/message both empty (the
    // "Detecting players" / post-upscale tail that doesn't report its own phase).
    act(() => {
      vi.advanceTimersByTime(90000);
    });
    act(() => {
      useExportStore.setState({
        activeExports: {
          export_silent: makeExport({ exportId: 'export_silent', percent: 90, elapsedSec: 90, message: '' }),
        },
      });
    });
    // progressLine() must never go blank -- falls back to 'Processing...' when both
    // phase and message are empty, never an empty/whitespace-only render.
    expect(document.body.textContent).toContain('Processing...');

    // Right up to completion (still PROCESSING, not yet COMPLETE) -- text must still
    // be present, not blank.
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    act(() => {
      useExportStore.setState({
        activeExports: {
          export_silent: makeExport({ exportId: 'export_silent', percent: 99, elapsedSec: 105, message: '' }),
        },
      });
    });
    expect(document.body.textContent).toContain('Processing...');
  });
});

describe('etaSlotText — honest estimate slot, never blank/frozen (T9900)', () => {
  it('shows a real remaining time when the estimate is trustworthy', () => {
    expect(etaSlotText({ stale: false, formatted: 'About 1 minute' })).toBe('About 1 minute remaining');
  });

  it('falls back to "Time remaining varies." when the estimate broke its promise', () => {
    expect(etaSlotText({ stale: true, formatted: 'Less than a minute' })).toBe(EXPORT_PROGRESS.ETA_VARIES);
  });

  it('falls back to "Time remaining varies." when there is no estimate at all', () => {
    expect(etaSlotText(null)).toBe(EXPORT_PROGRESS.ETA_VARIES);
  });
});

describe('GlobalExportIndicator — persistent stage + estimate stay readable (T9900, AC2)', () => {
  it('shows the honest STAGE line and a non-truncating estimate in the persistent mini-view', () => {
    // A just-started export (percent < 5) has no live ETA — the slot must still read
    // honestly rather than sit blank, and the stage must be visible after the toast dismisses.
    useExportStore.setState({
      activeExports: {
        export_r: makeExport({ exportId: 'export_r', percent: 2, elapsedSec: 5, message: 'AI upscaling frame 10/180' }),
      },
    });
    render(<GlobalExportIndicator />);
    // Stage copy is present (Sharpening the picture), plus the "unavailable estimate" fallback.
    expect(document.body.textContent).toContain('Sharpening the picture');
    expect(document.body.textContent).toContain(EXPORT_PROGRESS.ETA_VARIES);
    // The old fixed-width clamp that clipped the estimate at 699px/200% zoom is gone.
    expect(document.body.querySelector('.max-w-\\[180px\\]')).toBeNull();
  });
});

describe('GlobalExportIndicator — rendered labels and stale-ETA switch (T8510)', () => {
  it('renders "Your highlight" (never "Project #N") for a record with no project name', () => {
    useExportStore.setState({
      activeExports: { export_1: makeExport({ projectName: null, projectId: 1 }) },
    });
    render(<GlobalExportIndicator />);
    expect(screen.getAllByText(/Your highlight/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Project #/);
  });

  it('renders the reel name carried by startExport from the first frame', () => {
    useExportStore.getState().startExport('export_2', 7, 'framing', 'Brilliant Goal');
    render(<GlobalExportIndicator />);
    expect(screen.getAllByText(/Brilliant Goal/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Project #/);
  });

  // T11280 (round 12, AC6): the pending-export card opens with exportStore's DEFAULT
  // progress message, which carries no `phase` and so is rendered VERBATIM by
  // exportProgressLabel's raw-message fallback. It must not leak the word "export" --
  // AC6 renames the product's action to "generate". A proof verifier caught this live
  // runtime gap by calling the real render path; seven prior static code reviews missed it
  // because the leak only exists once startExport runs and the label passes the message
  // through. This fails on the pre-fix head ("Starting export...") and passes after
  // ("Starting generation..."), locking it permanently.
  it('opens the pending export card without leaking the word "export" (T11280 AC6)', () => {
    useExportStore.getState().startExport('export_pending', 7, 'framing', 'Brilliant Goal');
    render(<GlobalExportIndicator />);
    expect(document.body.textContent).toMatch(/Getting your video ready/i);
    expect(document.body.textContent).not.toMatch(/export/i);
  });

  it('switches a busted frame-rate estimate to "Time remaining varies." within the grace window (T14860)', () => {
    useExportStore.setState({
      activeExports: {
        export_3: makeExport({ exportId: 'export_3', percent: 5, elapsedSec: 2, message: 'AI upscaling frame 10/160' }),
      },
    });
    render(<GlobalExportIndicator />);
    // First frame sample alone gives no rate yet.
    expect(document.body.textContent).toContain(EXPORT_PROGRESS.ETA_VARIES);

    // Two windows at 400ms/frame (10 -> 60 -> 110 of 160, 20s each; T15950 waits for two
    // agreeing windows): 50 frames * 400ms + 30s tail = 50s = "About 1 minute". The
    // component records each sample after the render that shows it, hence the 1s ticks.
    for (const [frame, percent] of [[60, 40], [110, 70]]) {
      act(() => {
        vi.advanceTimersByTime(19000);
      });
      act(() => {
        useExportStore.setState({
          activeExports: {
            export_3: makeExport({ exportId: 'export_3', percent, elapsedSec: 0, message: `AI upscaling frame ${frame}/160` }),
          },
        });
      });
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(document.body.textContent).toContain('About 1 minute remaining');
    expect(document.body.textContent).not.toContain(EXPORT_PROGRESS.ETA_VARIES);

    // Advance past the promised 50s deadline + 15s grace with no further frame update -> stale.
    act(() => {
      vi.advanceTimersByTime(70000);
    });
    expect(document.body.textContent).toContain(EXPORT_PROGRESS.ETA_VARIES);
    expect(document.body.textContent).toContain('Sharpening the picture');
  });
});

describe('GlobalExportIndicator — over-budget rejection popup (T11330)', () => {
  /** An ERRORED framing export carrying the T11320 guard's structured rejection. */
  function makeBudgetRejectedExport({ exportId = 'export_big', projectName = 'Brilliant Goal' } = {}) {
    return {
      exportId,
      projectId: 7,
      projectName,
      type: 'framing',
      status: 'error',
      progress: { current: 0, total: 100, percent: 0, message: '' },
      startedAt: new Date(NOW - 5000).toISOString(),
      completedAt: new Date(NOW).toISOString(),
      error: 'This export needs an estimated 4200s of GPU time, over the 2880s safe limit.',
      retryable: false,
      budgetRejection: {
        code: 'export_too_large',
        estimated_gpu_seconds: 4200.0,
        budget_seconds: 2880.0,
        biggest_contributors: [
          { clip_index: 3, clip_name: 'Big Dunk', crop_width: 1920, crop_height: 1080, estimated_gpu_seconds: 600.0 },
        ],
      },
      outputVideoId: null,
      outputFilename: null,
      gameId: null,
      gameName: null,
    };
  }

  it('shows the explanatory popup even though the rejected export is not "processing"', () => {
    // The whole point: no processing exports, yet the popup for the errored one must appear.
    useExportStore.setState({ activeExports: { export_big: makeBudgetRejectedExport() } });
    render(<GlobalExportIndicator />);
    expect(screen.getByTestId('export-too-large-modal')).toBeTruthy();
    expect(document.body.textContent).toContain('Big Dunk');
    expect(document.body.textContent).toContain('1920x1080 box');
  });

  it('dismisses the popup on "Got it" and does not resurrect it', () => {
    useExportStore.setState({ activeExports: { export_big: makeBudgetRejectedExport() } });
    render(<GlobalExportIndicator />);
    act(() => {
      screen.getByTestId('export-too-large-dismiss').click();
    });
    expect(screen.queryByTestId('export-too-large-modal')).toBeNull();
  });

  it('does not show the popup for an ordinary (non-guard) export failure', () => {
    const plain = makeBudgetRejectedExport({ exportId: 'export_plain' });
    plain.budgetRejection = null;
    useExportStore.setState({ activeExports: { export_plain: plain } });
    render(<GlobalExportIndicator />);
    expect(screen.queryByTestId('export-too-large-modal')).toBeNull();
  });
});

describe('completion toast suppressed for the project open in Focus (T11970)', () => {
  it('no toast when a framing export completes for the project currently open in Focus', async () => {
    const { toast } = await import('./shared');
    const { useProjectsStore } = await import('../stores/projectsStore');
    const { useEditorStore } = await import('../stores/editorStore');
    const { EDITOR_MODES } = await import('../stores/editorStore');
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => {});
    useProjectsStore.setState({ selectedProjectId: 7 });
    useEditorStore.setState({ editorMode: EDITOR_MODES.FRAMING });
    render(<GlobalExportIndicator />);
    act(() => {
      useExportStore.setState({
        activeExports: {
          export_1: { ...makeExport({ projectId: 7 }), status: 'complete', completedAt: new Date(NOW).toISOString() },
        },
      });
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('completion toast still fires outside the open Focus project (T11970)', () => {
  async function completeWith({ selectedProjectId, editorMode, exportId }) {
    const { toast } = await import('./shared');
    const { useProjectsStore } = await import('../stores/projectsStore');
    const { useEditorStore } = await import('../stores/editorStore');
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => {});
    useProjectsStore.setState({ selectedProjectId });
    useEditorStore.setState({ editorMode });
    render(<GlobalExportIndicator />);
    act(() => {
      useExportStore.setState({
        activeExports: {
          [exportId]: { ...makeExport({ exportId, projectId: 7 }), status: 'complete', completedAt: new Date(NOW).toISOString() },
        },
      });
    });
    return spy;
  }

  it('toasts when Focus has a different project open', async () => {
    const { EDITOR_MODES } = await import('../stores/editorStore');
    const spy = await completeWith({ selectedProjectId: 8, exportId: 'export_pos_a', editorMode: EDITOR_MODES.FRAMING });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('toasts when the same project is open but not in Focus', async () => {
    const { EDITOR_MODES } = await import('../stores/editorStore');
    const spy = await completeWith({ selectedProjectId: 7, exportId: 'export_pos_b', editorMode: EDITOR_MODES.PROJECT_MANAGER });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
});

describe('GlobalExportIndicator — a dismissed completion toast stays dismissed after reload (T15740)', () => {
  it('does not re-toast an export the user already dismissed, on a fresh mount', async () => {
    const { toast } = await import('./shared');
    const { rememberDismissedExportToast } = await import('../utils/dismissedExportToasts');
    rememberDismissedExportToast('export_dismissed_1');
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => {});

    render(<GlobalExportIndicator />);
    act(() => {
      useExportStore.setState({
        activeExports: {
          export_dismissed_1: {
            ...makeExport({ exportId: 'export_dismissed_1', projectId: 50 }),
            status: 'complete',
            completedAt: new Date(NOW).toISOString(),
          },
        },
      });
    });

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('passes an onDismiss that persists the export id, so a later fresh mount skips it', async () => {
    const { toast } = await import('./shared');
    const { readDismissedExportToastIds } = await import('../utils/dismissedExportToasts');
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => {});

    render(<GlobalExportIndicator />);
    act(() => {
      useExportStore.setState({
        activeExports: {
          export_dismissed_2: {
            ...makeExport({ exportId: 'export_dismissed_2', projectId: 51 }),
            status: 'complete',
            completedAt: new Date(NOW).toISOString(),
          },
        },
      });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const options = spy.mock.calls[0][1];
    expect(typeof options.onDismiss).toBe('function');
    options.onDismiss();
    expect(readDismissedExportToastIds().has('export_dismissed_2')).toBe(true);
    spy.mockRestore();
  });
});

// T11510 (D5): the post-export toast used to send the raw video file on
// mobile under a "Share" label for an UNPUBLISHED draft -- the one surface
// where no link exists yet and no "Publish and get link" review has
// happened. Coarse pointers now get no share action on this toast at all;
// fine pointers are unchanged (Copy link).
describe('GlobalExportIndicator — completion toast share action (T11510 D5)', () => {
  const originalMatchMedia = window.matchMedia;

  function mockPointer({ coarse }) {
    window.matchMedia = vi.fn((query) => ({
      matches: query.includes('pointer: coarse') ? coarse : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
  }

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it('coarse pointer: the completion toast carries NO action (no share, no file-send)', async () => {
    mockPointer({ coarse: true });
    const { toast } = await import('./shared');
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => {});

    render(<GlobalExportIndicator />);
    act(() => {
      useExportStore.setState({
        activeExports: {
          export_mobile: {
            ...makeExport({ exportId: 'export_mobile', projectId: 60 }),
            status: 'complete',
            completedAt: new Date(NOW).toISOString(),
            outputVideoId: 123,
          },
        },
      });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const options = spy.mock.calls[0][1];
    expect(options.action).toBeUndefined();
    spy.mockRestore();
  });

  it('fine pointer: the completion toast keeps the unchanged Copy link action', async () => {
    mockPointer({ coarse: false });
    const { toast } = await import('./shared');
    const spy = vi.spyOn(toast, 'success').mockImplementation(() => {});

    render(<GlobalExportIndicator />);
    act(() => {
      useExportStore.setState({
        activeExports: {
          export_desktop: {
            ...makeExport({ exportId: 'export_desktop', projectId: 61 }),
            status: 'complete',
            completedAt: new Date(NOW).toISOString(),
            outputVideoId: 456,
          },
        },
      });
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const options = spy.mock.calls[0][1];
    expect(options.action).toBeDefined();
    expect(options.action.label).toBe('Copy link');
    spy.mockRestore();
  });
});

describe('GlobalExportIndicator — docks above the editor action band below lg (T14230)', () => {
  // Real-browser geometry proof: e2e/T14230-verify.mjs. This pins the slot classes it measured.
  it('offsets by --cta-bar-h below lg and keeps the bottom-4/right-4 slot on desktop', () => {
    useExportStore.setState({
      activeExports: { export_1: makeExport({ projectName: 'Saturday vs Riptide' }) },
    });
    render(<GlobalExportIndicator />);
    const slot = screen.getByTestId('global-export-indicator').className.split(/\s+/);
    expect(slot).toContain('max-lg:bottom-[calc(var(--cta-bar-h,0px)+1rem)]');
    expect(slot).toContain('bottom-4');
    expect(slot).toContain('right-4');
  });
});

describe('GlobalExportIndicator — first shown estimate within 1.5x of actual remaining (T15950)', () => {
  // The task's repro: model load ends, frames start flowing, and the FIRST measured
  // window is an unrepresentative warm-up (15 frames in 14s) before the steady pace
  // (400ms/frame) settles in. The backend reports every 15 frames. Before the fix the
  // estimate was shown from that one warm-up window ("About 4 minutes" against ~98s
  // actually left). Every reading the user sees, from the first estimate shown, must be
  // within 1.5x of the real remaining time either way. Readings stop once under a minute
  // is left: "About 1 minute" is the copy's floor, not an estimate.
  it('T15950:C1 every shown estimate stays within 1.5x of actual remaining after a slow warm-up window', () => {
    const TOTAL = 200;
    const PACE_MS = 400;
    const WARMUP_END_S = 14; // frame 30 reached at t=14s, after 15 frames in 14s
    const frameAt = (frame) => (frame === 15 ? 0 : WARMUP_END_S + ((frame - 30) * PACE_MS) / 1000);
    const jobEndS = frameAt(TOTAL) + 30; // + the post-upscale tail
    const show = (frame) => act(() => {
      useExportStore.setState({
        activeExports: {
          export_t15950: makeExport({
            exportId: 'export_t15950', percent: 10 + frame / 4, elapsedSec: 0,
            message: `AI upscaling frame ${frame}/${TOTAL}`,
          }),
        },
      });
    });
    const shownSeconds = () => {
      const match = /About (\d+) minutes? remaining/.exec(document.body.textContent);
      return match ? parseInt(match[1], 10) * 60 : null;
    };

    show(15);
    render(<GlobalExportIndicator />);
    const readings = [];
    let t = 0;
    for (let frame = 30; frame <= TOTAL; frame += 15) {
      const at = frameAt(frame);
      act(() => { vi.advanceTimersByTime((at - t) * 1000); });
      t = at;
      show(frame);
      const nextAt = frameAt(Math.min(frame + 15, TOTAL));
      // Read what the user sees right after the sample and on every 1s tick until the next.
      for (;;) {
        const remaining = jobEndS - t;
        if (remaining < 60) break;
        const shown = shownSeconds();
        if (shown != null) readings.push({ t, shown, remaining });
        if (t + 1 >= nextAt) break;
        act(() => { vi.advanceTimersByTime(1000); });
        t += 1;
      }
      if (jobEndS - t < 60) break;
    }

    expect(readings.length).toBeGreaterThan(0);
    for (const { t: at, shown, remaining } of readings) {
      expect(shown / remaining, `t=${at}s shown ${shown}s vs ${remaining}s left`).toBeLessThanOrEqual(1.5);
      expect(remaining / shown, `t=${at}s shown ${shown}s vs ${remaining}s left`).toBeLessThanOrEqual(1.5);
    }
  });
});

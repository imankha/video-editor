import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SourceBar from './SourceBar';
import FixTimingStrip, { formatMoved } from './FixTimingStrip';
import { SecondCameraTip, PlacedAtEndPrompt } from './SyncPrompts';
import { syncTargetFor, wallTimeAt } from './syncCameras';
import { ANNOTATE } from '../../config/displayNames';

// T17700: "Line up" was renamed Sync and redesigned (docs/plans/tasks/T17700-design.md,
// owner ruling 2026-11-18): Sync only where a second camera covers the moment, plain
// words before the tap, a drag/nudge panel phrased in what the parent SEES, Done the
// only save, X undoes.

const overlap = [
  { sequence: 1, name: 'Main camera', kind: 'main', virtualStart: 0, virtualEnd: 600, placedAtEnd: false, coversPlayhead: true },
  { sequence: 2, name: "Mom's phone", kind: 'angle', virtualStart: 100, virtualEnd: 300, placedAtEnd: false, coversPlayhead: true },
];
const sequential = [
  { sequence: 1, name: 'Game video', kind: 'main', virtualStart: 0, virtualEnd: 5000, placedAtEnd: false, coversPlayhead: false },
  { sequence: 2, name: 'video (6)', kind: 'main', virtualStart: 5000, virtualEnd: 5011, placedAtEnd: true, coversPlayhead: true },
];

describe('T17700:C2 the parent can tell what Sync does before tapping', () => {
  beforeEach(() => localStorage.clear());

  it('T17700:C2 Sync shows on the main camera when a second camera covers the moment, naming both', () => {
    const onFixTiming = vi.fn();
    render(<SourceBar videos={overlap} activeSequence={1} index={1} count={2} onFixTiming={onFixTiming} />);
    const btn = screen.getByTestId('source-bar-fix-timing');
    expect(btn.textContent).toBe('Sync cameras'); // " cameras" is hidden below lg
    expect(btn.querySelector('.lg\\:inline').textContent).toBe(' cameras');
    expect(btn.getAttribute('aria-label')).toBe("Sync Mom's phone with Main camera");
    expect(btn.getAttribute('title')).toBe('Make both cameras show the same moment');
    fireEvent.click(btn);
    expect(onFixTiming).toHaveBeenCalledWith(2);
  });

  it('T17700:C2 no Sync for back-to-back videos (moving one changes nothing)', () => {
    render(<SourceBar videos={sequential} activeSequence={2} index={2} count={2} onFixTiming={vi.fn()} />);
    expect(screen.queryByTestId('source-bar-fix-timing')).toBeNull();
  });

  it('T17700:C2 the first-time tip says what Sync is for, and stays dismissed on this device', () => {
    const { unmount } = render(<SecondCameraTip />);
    expect(screen.getByTestId('sync-tip').textContent).toContain(
      "This game has a second camera. If the two don't show the same moment, tap Sync.",
    );
    fireEvent.click(screen.getByTestId('sync-tip-dismiss'));
    expect(screen.queryByTestId('sync-tip')).toBeNull();
    unmount();
    render(<SecondCameraTip />);
    expect(screen.queryByTestId('sync-tip')).toBeNull();
  });

  it('T17700:C2 a video we placed at the end asks one plain question instead', () => {
    const onSameTime = vi.fn();
    render(<PlacedAtEndPrompt gameId={9} sequence={2} name="video (6)" onSameTime={onSameTime} />);
    expect(screen.getByTestId('placed-at-end-prompt').textContent).toContain(
      "We put video (6) after the other videos because we couldn't tell when it was filmed. Filmed at the same time as another video?",
    );
    fireEvent.click(screen.getByRole('button', { name: 'Same time' }));
    expect(onSameTime).toHaveBeenCalledWith(2);
  });

  it('T17700:C2 "It comes after" is remembered on this device only, per video', () => {
    const { unmount } = render(<PlacedAtEndPrompt gameId={9} sequence={2} name="video (6)" onSameTime={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'It comes after' }));
    expect(screen.queryByTestId('placed-at-end-prompt')).toBeNull();
    unmount();
    const again = render(<PlacedAtEndPrompt gameId={9} sequence={2} name="video (6)" onSameTime={vi.fn()} />);
    expect(screen.queryByTestId('placed-at-end-prompt')).toBeNull();
    again.unmount();
    render(<PlacedAtEndPrompt gameId={9} sequence={3} name="video (7)" onSameTime={vi.fn()} />);
    expect(screen.getByTestId('placed-at-end-prompt')).toBeTruthy();
  });

  it('T17700:C2 no parent-facing copy says "line up" or asks the parent to listen', () => {
    const strings = Object.values(ANNOTATE).flatMap((v) => {
      if (typeof v === 'string') return [v];
      if (typeof v === 'function') {
        try { return [String(v('X', 'Y', 'Z'))]; } catch { return []; }
      }
      return [];
    });
    expect(strings.filter((s) => /line (it )?up/i.test(s))).toEqual([]);
    const syncCopy = [ANNOTATE.SYNC_TIP, ANNOTATE.SYNC_INSTRUCTION, ANNOTATE.SYNC_DONE_HINT, ANNOTATE.SYNC_COMPARE_CAPTION];
    expect(syncCopy.filter((s) => /listen|hear|sound|whistle/i.test(s))).toEqual([]);
  });
});

describe('T17700:C3 the sync panel: drag/nudge, Done the only save, X cancels', () => {
  const setup = (overrides = {}) => {
    const props = {
      step: 'sync',
      angleName: "Mom's phone",
      mainName: 'Main camera',
      moved: 0,
      canCompare: true,
      onNudge: vi.fn(),
      onPlayAngle: vi.fn(),
      onPlayMain: vi.fn(),
      onPlace: vi.fn(),
      onReset: vi.fn(),
      onDone: vi.fn(),
      onCancel: vi.fn(),
      ...overrides,
    };
    render(<FixTimingStrip {...props} />);
    return props;
  };

  it('T17700:C3 header names both cameras and the instruction is what the parent sees', () => {
    setup();
    expect(screen.getByRole('heading').textContent).toBe("Sync Mom's phone with Main camera");
    expect(screen.getByTestId('fix-timing-strip').textContent).toContain(
      'Move it earlier or later until both cameras show the same moment.',
    );
  });

  it('T17700:C3 Earlier / Later in 10s, 1s and 0.1s steps never save', () => {
    const props = setup();
    for (const id of ['earlier-10', 'earlier-1', 'earlier-0.1', 'later-0.1', 'later-1', 'later-10']) {
      fireEvent.click(screen.getByTestId(`fix-timing-${id}`));
    }
    expect(props.onNudge.mock.calls).toEqual([[-10], [-1], [-0.1], [0.1], [1], [10]]);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('T17700:C3 the readout says earlier / later in words', () => {
    expect(formatMoved(0)).toBe('Not moved');
    expect(formatMoved(-3.4)).toBe('Moved 3.4s earlier');
    expect(formatMoved(0.1 + 0.1 + 0.1)).toBe('Moved 0.3s later');
  });

  it('T17700:C3 Done saves once; X and Esc cancel without saving', () => {
    const props = setup();
    fireEvent.click(screen.getByTestId('fix-timing-done'));
    expect(props.onDone).toHaveBeenCalledTimes(1);
    const x = screen.getByTestId('fix-timing-cancel');
    expect(x.getAttribute('aria-label')).toBe('Cancel and undo moves (Esc)');
    fireEvent.click(x);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(props.onCancel).toHaveBeenCalledTimes(2);
    expect(props.onDone).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('fix-timing-reset').textContent).toBe('Undo moves');
  });

  it('T17700:C3 compare buttons are disabled with a reason when the playhead is outside the shared part', () => {
    setup({ canCompare: false });
    expect(screen.getByTestId('fix-timing-play-angle').disabled).toBe(true);
    expect(screen.getByTestId('fix-timing-play-main').disabled).toBe(true);
    expect(screen.getByText('Move the playhead to a moment both cameras filmed.')).toBeTruthy();
  });

  it('T17700:C3 the place step asks where the video starts and writes only on Starts here', () => {
    const props = setup({ step: 'place', angleName: 'video (6)' });
    expect(screen.getByRole('heading').textContent).toBe('Where does video (6) start?');
    expect(screen.queryByTestId('fix-timing-earlier-1')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Starts here' }));
    expect(props.onPlace).toHaveBeenCalledTimes(1);
    expect(props.onDone).not.toHaveBeenCalled();
  });

  it('T17700:C3 after a rough placement the strip says X keeps it there', () => {
    setup({ placed: true });
    expect(screen.getByText('X keeps it where you started it.')).toBeTruthy();
  });
});

describe('T17700 syncCameras helpers', () => {
  it('syncTargetFor: the active camera, else the camera covering the playhead, else none', () => {
    expect(syncTargetFor(overlap, 2)?.sequence).toBe(2);
    expect(syncTargetFor(overlap, 1)?.sequence).toBe(2);
    expect(syncTargetFor(overlap.map((v) => ({ ...v, coversPlayhead: v.kind === 'main' })), 1)).toBeNull();
    expect(syncTargetFor(sequential, 2)).toBeNull();
  });

  it('wallTimeAt: the game time under the playhead on the main video covering it', () => {
    const gameVideos = [
      { sequence: 1, offset_seconds: 0 },
      { sequence: 2, offset_seconds: 5000 },
    ];
    expect(wallTimeAt(1234, sequential, gameVideos)).toEqual({ sequence: 1, wall: 1234 });
    expect(wallTimeAt(5005, sequential, gameVideos)).toEqual({ sequence: 2, wall: 5005 });
  });
});

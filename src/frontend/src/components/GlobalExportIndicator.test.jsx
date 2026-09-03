import { render, screen, act, cleanup } from '@testing-library/react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import GlobalExportIndicator, {
  getExportLabel,
  resolveEtaDisplay,
  ETA_BUST_GRACE_MS,
  ETA_STALL_MS,
} from './GlobalExportIndicator';
import { useExportStore } from '../stores/exportStore';

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

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  useExportStore.getState().reset();
  vi.useRealTimers();
});

describe('getExportLabel — no internal ids, ever (T8510)', () => {
  it('uses the project name when present', () => {
    expect(getExportLabel(makeExport({ projectName: 'Brilliant Goal' }))).toBe('Brilliant Goal');
  });

  it('falls back to "Your reel" when the name is missing — never "Project #N"', () => {
    const label = getExportLabel(makeExport({ projectName: null, projectId: 1 }));
    expect(label).toBe('Your reel');
    expect(label).not.toMatch(/Project #/);
  });

  it('annotate exports use the game name, falling back to "Annotation"', () => {
    const annotate = { ...makeExport(), type: 'annotate', gameName: 'Sat vs Rovers' };
    expect(getExportLabel(annotate)).toBe('Sat vs Rovers');
    expect(getExportLabel({ ...annotate, gameName: null })).toBe('Annotation');
  });
});

describe('resolveEtaDisplay — honest ETA (T8510)', () => {
  it('returns the live estimate while the promise holds', () => {
    const exp = makeExport({ percent: 50, elapsedSec: 60 });
    const display = resolveEtaDisplay(exp, NOW, new Map(), new Map());
    expect(display.stale).toBe(false);
    expect(display.formatted).toBe('About 1 minute');
  });

  it('goes stale once the promised deadline is exceeded by the grace period', () => {
    const exp = makeExport({ percent: 95, elapsedSec: 60, message: 'Upscaling...' });
    const deadlines = new Map([[exp.exportId, NOW - ETA_BUST_GRACE_MS - 1000]]);
    const display = resolveEtaDisplay(exp, NOW, deadlines, new Map());
    expect(display.stale).toBe(true);
    expect(display.fallbackText).toBe('Upscaling...');
  });

  it('stays live inside the 15s grace window past the deadline', () => {
    const exp = makeExport({ percent: 95, elapsedSec: 60 });
    const deadlines = new Map([[exp.exportId, NOW - ETA_BUST_GRACE_MS + 5000]]);
    expect(resolveEtaDisplay(exp, NOW, deadlines, new Map()).stale).toBe(false);
  });

  it('never shows "Less than a minute" while percent has been frozen for >30s', () => {
    // percent 95 after 60s -> remaining ~3s -> "Less than a minute"
    const exp = makeExport({ percent: 95, elapsedSec: 60 });
    const tracks = new Map([[exp.exportId, { percent: 95, changedAt: NOW - ETA_STALL_MS - 1000 }]]);
    const display = resolveEtaDisplay(exp, NOW, new Map(), tracks);
    expect(display.stale).toBe(true);
  });

  it('a multi-minute estimate is NOT hidden by the stall rule (only sub-minute ones)', () => {
    // percent 30 after 300s -> remaining 700s -> "About 12 minutes"
    const exp = makeExport({ percent: 30, elapsedSec: 300 });
    const tracks = new Map([[exp.exportId, { percent: 30, changedAt: NOW - ETA_STALL_MS - 1000 }]]);
    expect(resolveEtaDisplay(exp, NOW, new Map(), tracks).stale).toBe(false);
  });

  it('falls back to "Still working..." when no stage message is available', () => {
    const exp = makeExport({ percent: 95, elapsedSec: 60, message: '' });
    const deadlines = new Map([[exp.exportId, NOW - ETA_BUST_GRACE_MS - 1000]]);
    expect(resolveEtaDisplay(exp, NOW, deadlines, new Map()).fallbackText).toBe('Still working...');
  });

  it('returns null when there is not enough data to estimate (percent < 5)', () => {
    const exp = makeExport({ percent: 3, elapsedSec: 60 });
    expect(resolveEtaDisplay(exp, NOW, new Map(), new Map())).toBeNull();
  });
});

describe('GlobalExportIndicator — rendered labels and stale-ETA switch (T8510)', () => {
  it('renders "Your reel" (never "Project #N") for a record with no project name', () => {
    useExportStore.setState({
      activeExports: { export_1: makeExport({ projectName: null, projectId: 1 }) },
    });
    render(<GlobalExportIndicator />);
    expect(screen.getAllByText(/Your reel/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Project #/);
  });

  it('renders the reel name carried by startExport from the first frame', () => {
    useExportStore.getState().startExport('export_2', 7, 'framing', 'Brilliant Goal');
    render(<GlobalExportIndicator />);
    expect(screen.getAllByText(/Brilliant Goal/).length).toBeGreaterThan(0);
    expect(document.body.textContent).not.toMatch(/Project #/);
  });

  it('switches a busted "Less than a minute" to the stage message within the grace window', () => {
    // percent 95 after 60s -> promised ~3s remaining; the export then stalls.
    useExportStore.setState({
      activeExports: {
        export_3: makeExport({ exportId: 'export_3', percent: 95, elapsedSec: 60, message: 'Upscaling...' }),
      },
    });
    render(<GlobalExportIndicator />);
    expect(document.body.textContent).toContain('Less than a minute');

    // Advance past deadline (+~3s) + 15s grace; the 1s ticker re-evaluates.
    act(() => {
      vi.advanceTimersByTime(20000);
    });
    expect(document.body.textContent).not.toContain('Less than a minute');
    expect(document.body.textContent).toContain('Upscaling...');
  });
});

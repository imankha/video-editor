import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

// T14370: the "Report a problem" ring buffer would have lost this exact bug.
// It captured only error/warn/info (the Mark play diagnostics are console.log),
// and 200 entries of routine [VIDEO] / [SLOW FETCH] warnings evicted the one
// error line that mattered.

vi.mock('./apiFetch', () => ({ default: vi.fn(() => Promise.resolve({})) }));

import { installClientLogger, getClientLogs, clearClientLogs } from './clientLogger';

beforeAll(() => {
  // Keep the test output quiet: the logger calls through to whatever console
  // method it wrapped, so stub them BEFORE installing.
  for (const m of ['log', 'info', 'warn', 'error']) vi.spyOn(console, m).mockImplementation(() => {});
  installClientLogger();
});

beforeEach(() => clearClientLogs());

describe('T14370 - clientLogger keeps what a bug report needs', () => {
  it('captures console.log lines', () => {
    console.log('[CreateClip] Stored region:', 'abc', 'actual:', 1, '-', 2);
    const hit = getClientLogs().find((l) => l.message.startsWith('[CreateClip] Stored region: abc'));
    expect(hit).toBeTruthy();
    expect(hit.level).toBe('log');
  });

  it('an error survives a flood of routine warnings', () => {
    console.error('[MarkPlay] addClipRegion returned null', { gameId: 3 });
    for (let i = 0; i < 1000; i++) console.warn('[VIDEO] Suspend', i);
    const logs = getClientLogs();
    expect(logs.some((l) => l.level === 'error' && l.message.includes('[MarkPlay]'))).toBe(true);
    // The routine noise is still bounded.
    expect(logs.length).toBeLessThan(1000);
  });

  it('returns entries in time order across both rings', () => {
    console.log('first');
    console.error('second');
    console.warn('third');
    const msgs = getClientLogs().map((l) => l.message);
    expect(msgs.indexOf('first')).toBeLessThan(msgs.indexOf('second'));
    expect(msgs.indexOf('second')).toBeLessThan(msgs.indexOf('third'));
  });
});

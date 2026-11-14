import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startLoadTrace } from './loadTrace';

/** T16050:C1/C2/C3 - the shared [LOAD] instrumentation helper. */

describe('startLoadTrace', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('T16050:C1 logs one [LOAD] waiting-for line naming the needs on start', () => {
    startLoadTrace('Frame', { projectId: 42 }, ['highlight', 'plays', 'video']);

    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith(
      '[LOAD] Frame waiting for highlight, plays, video projectId=42'
    );
  });

  it('T16050:C1 logs arrived/failed/empty lines with elapsed milliseconds as each need resolves', () => {
    const trace = startLoadTrace('Frame', { projectId: 42 }, ['highlight', 'plays', 'video']);
    console.info.mockClear();

    vi.advanceTimersByTime(50);
    trace.arrived('highlight', { name: 'My highlight' });
    expect(console.info).toHaveBeenLastCalledWith(
      expect.stringMatching(/^\[LOAD\] Frame highlight arrived in \d+ms \{"name":"My highlight"\}$/)
    );

    vi.advanceTimersByTime(30);
    trace.empty('plays');
    expect(console.info).toHaveBeenLastCalledWith(
      expect.stringMatching(/^\[LOAD\] Frame plays empty in \d+ms$/)
    );

    vi.advanceTimersByTime(10);
    trace.failed('video', new Error('boom'));
    expect(console.info).toHaveBeenLastCalledWith(
      expect.stringMatching(/^\[LOAD\] Frame video failed in \d+ms: boom$/)
    );
  });

  it('T16050:C2 warns once with the still-outstanding needs after 10s', () => {
    const trace = startLoadTrace('Frame', { projectId: 42 }, ['highlight', 'plays', 'video']);
    trace.arrived('highlight');

    // Not before 10s (T16120: a warning at 1s also passed the old version of this test).
    vi.advanceTimersByTime(9999);
    expect(console.warn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[LOAD] Frame still waiting after 10000ms for: plays, video projectId=42'
    );

    // One warning, not one every 10s while still stuck.
    vi.advanceTimersByTime(30000);
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it('T16050:C2 does not warn once every need already resolved before 10s', () => {
    const trace = startLoadTrace('Frame', { projectId: 42 }, ['highlight']);
    trace.arrived('highlight');

    vi.advanceTimersByTime(10000);

    expect(console.warn).not.toHaveBeenCalled();
  });

  it('T16050:C3 logs a console.error naming the empty input when settled with nothing to show', () => {
    const trace = startLoadTrace('Frame', { projectId: 42 }, ['highlight', 'plays', 'video']);
    trace.arrived('highlight');
    trace.empty('plays');

    trace.settled({ emptyNeed: 'plays' });

    expect(console.error).toHaveBeenCalledWith(
      '[LOAD] Frame settled with nothing to show: plays empty projectId=42'
    );
    // the 10s stuck-warning must not ALSO fire once settled
    vi.advanceTimersByTime(10000);
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('settled() without an emptyNeed logs a plain settle line and settled() is idempotent', () => {
    const trace = startLoadTrace('Frame', { projectId: 42 }, ['highlight']);
    trace.arrived('highlight');
    console.info.mockClear();

    trace.settled();
    trace.settled();

    expect(console.info).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledWith(
      expect.stringMatching(/^\[LOAD\] Frame settled in \d+ms projectId=42$/)
    );
    expect(console.error).not.toHaveBeenCalled();
  });
});

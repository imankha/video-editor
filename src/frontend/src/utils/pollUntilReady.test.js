import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollUntilReady } from './pollUntilReady';

describe('pollUntilReady (T15220)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onReady with the value as soon as check() turns truthy, and stops polling', () => {
    let ref = null;
    const onReady = vi.fn();
    const onTimeout = vi.fn();
    pollUntilReady({ check: () => ref, onReady, onTimeout, intervalMs: 200, deadlineMs: 2000 });

    vi.advanceTimersByTime(600);
    expect(onReady).not.toHaveBeenCalled();

    ref = { triggerExport: () => 'fired' };
    vi.advanceTimersByTime(200);
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onReady).toHaveBeenCalledWith(ref);

    // The deadline must not fire after a ready value already resolved it.
    vi.advanceTimersByTime(5000);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('calls onTimeout (never onReady) if check() never turns truthy before the deadline', () => {
    const onReady = vi.fn();
    const onTimeout = vi.fn();
    pollUntilReady({ check: () => null, onReady, onTimeout, intervalMs: 200, deadlineMs: 2000 });

    vi.advanceTimersByTime(2000);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();

    // Polling must have stopped -- no further onReady/onTimeout calls after the deadline.
    vi.advanceTimersByTime(5000);
    expect(onReady).not.toHaveBeenCalled();
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('cancel() stops both the poll and the deadline', () => {
    const onReady = vi.fn();
    const onTimeout = vi.fn();
    const cancel = pollUntilReady({ check: () => true, onReady, onTimeout, intervalMs: 200, deadlineMs: 2000 });
    cancel();

    vi.advanceTimersByTime(5000);
    expect(onReady).not.toHaveBeenCalled();
    expect(onTimeout).not.toHaveBeenCalled();
  });
});

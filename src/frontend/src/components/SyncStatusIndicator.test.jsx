import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useSyncStore } from '../stores/syncStore';

// The indicator waits SHOW_DELAY_MS (3s) before painting, so drive timers.
function paint() {
  render(<SyncStatusIndicator />);
  act(() => vi.advanceTimersByTime(3100));
}

describe('SyncStatusIndicator (T5870)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSyncStore.setState({ syncState: 'ok', isRetrying: false, isOffline: false });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows nothing while syncState is ok', () => {
    paint();
    expect(screen.queryByText(/backup pending|could not save/i)).toBeNull();
  });

  it('pending -> quiet copy, NO Retry button', () => {
    useSyncStore.setState({ syncState: 'pending' });
    paint();
    expect(screen.getByText(/backup pending/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('failed -> alarm copy WITH a working Retry button', () => {
    const retry = vi.fn().mockResolvedValue(true);
    useSyncStore.setState({ syncState: 'failed', retrySyncToR2: retry });
    paint();
    expect(screen.getByText(/could not save to the cloud/i)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('conflict -> alarm copy mentioning a newer version, WITH Retry', () => {
    useSyncStore.setState({ syncState: 'conflict' });
    paint();
    expect(screen.getByText(/newer version of your work/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});

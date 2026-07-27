import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act, fireEvent, cleanup } from '@testing-library/react';
import { SyncStatusIndicator } from './SyncStatusIndicator';
import { useSyncStore } from '../stores/syncStore';

// The indicator waits SHOW_DELAY_MS (3s) before painting, so drive timers.
// Unmounts any prior render first -- a test that calls paint() more than once
// (e.g. to assert two different states in sequence) would otherwise see BOTH
// renders' DOM at once and getByText would throw "multiple elements found".
function paint() {
  cleanup();
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
    // T6010: failed is now gated on write-attempt too -- this session has one.
    useSyncStore.setState({ syncState: 'failed', retrySyncToR2: retry, hasAttemptedWrite: true });
    paint();
    expect(screen.getByText(/could not save to the cloud/i)).toBeTruthy();
    const btn = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(btn);
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('conflict -> alarm copy mentioning a newer version, WITH Retry', () => {
    useSyncStore.setState({ syncState: 'conflict', hasAttemptedWrite: true });
    paint();
    expect(screen.getByText(/newer version of your work/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });
});

// T5960: a sticky .sync_conflict marker outlives the session whose write was
// refused and attaches to whatever session loads next -- including a read-only
// one. The alarm must stay SILENT until THIS session has attempted a write.
describe('SyncStatusIndicator (T5960 conflict gated on write-attempt)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSyncStore.setState({
      syncState: 'ok',
      isRetrying: false,
      isOffline: false,
      hasAttemptedWrite: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('conflict header seen, ZERO writes this session -> renders nothing', () => {
    useSyncStore.setState({ syncState: 'conflict', hasAttemptedWrite: false });
    paint();
    // RED without fix: the indicator painted the alarm on any conflict header,
    // so a passive reader inherited someone else's refusal.
    expect(screen.queryByText(/could not save to the cloud/i)).toBeNull();
    expect(screen.queryByText(/newer version of your work/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('conflict header seen, AFTER a write this session -> alarm + Retry', () => {
    useSyncStore.setState({ syncState: 'conflict', hasAttemptedWrite: true });
    paint();
    expect(screen.getByText(/could not save to the cloud/i)).toBeTruthy();
    expect(screen.getByText(/newer version of your work/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('a write mid-session flips a held-silent conflict into the alarm', () => {
    useSyncStore.setState({ syncState: 'conflict', hasAttemptedWrite: false });
    render(<SyncStatusIndicator />);
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.queryByText(/could not save to the cloud/i)).toBeNull();

    // The session now issues its first write.
    act(() => useSyncStore.getState().markWriteAttempted());
    act(() => vi.advanceTimersByTime(3100));
    expect(screen.getByText(/could not save to the cloud/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

});

// T6010: `failed` is backed by the same sticky-marker idiom as `conflict` and has
// the identical staleness property. Extend the write-attempt gate to cover it too.
describe('SyncStatusIndicator (T6010 failed gated on write-attempt)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useSyncStore.setState({
      syncState: 'ok',
      isRetrying: false,
      isOffline: false,
      hasAttemptedWrite: false,
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('failed header seen, ZERO writes this session -> renders nothing', () => {
    useSyncStore.setState({ syncState: 'failed', hasAttemptedWrite: false });
    paint();
    // RED without fix: `failed` alarmed unconditionally, so a passive reader
    // inherited a previous session's un-retried failure.
    expect(screen.queryByText(/could not save to the cloud/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('failed header seen, AFTER a write this session -> alarm + Retry', () => {
    useSyncStore.setState({ syncState: 'failed', hasAttemptedWrite: true });
    paint();
    expect(screen.getByText(/could not save to the cloud/i)).toBeTruthy();
    expect(screen.getByText(/didn't reach the cloud/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /retry/i })).toBeTruthy();
  });

  it('conflict gating is unchanged (regression pin, T5960)', () => {
    useSyncStore.setState({ syncState: 'conflict', hasAttemptedWrite: false });
    paint();
    expect(screen.queryByText(/could not save to the cloud/i)).toBeNull();

    useSyncStore.setState({ syncState: 'conflict', hasAttemptedWrite: true });
    paint();
    expect(screen.getByText(/could not save to the cloud/i)).toBeTruthy();
  });

  it('pending still renders its quiet banner regardless of write-attempt (not swallowed)', () => {
    useSyncStore.setState({ syncState: 'pending', hasAttemptedWrite: false });
    paint();
    expect(screen.getByText(/backup pending/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

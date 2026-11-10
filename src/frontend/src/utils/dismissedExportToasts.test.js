import { describe, it, expect, afterEach } from 'vitest';
import { readDismissedExportToastIds, rememberDismissedExportToast } from './dismissedExportToasts';

afterEach(() => localStorage.clear());

describe('dismissedExportToasts (T15740)', () => {
  it('round-trips a dismissed id through localStorage', () => {
    expect(readDismissedExportToastIds().has('exp_1')).toBe(false);
    rememberDismissedExportToast('exp_1');
    expect(readDismissedExportToastIds().has('exp_1')).toBe(true);
  });

  it('caps remembered ids to the most recent 50', () => {
    for (let i = 0; i < 60; i++) rememberDismissedExportToast(`exp_${i}`);
    const ids = readDismissedExportToastIds();
    expect(ids.size).toBe(50);
    expect(ids.has('exp_0')).toBe(false);
    expect(ids.has('exp_59')).toBe(true);
  });
});

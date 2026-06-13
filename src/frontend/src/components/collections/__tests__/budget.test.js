import { describe, it, expect } from 'vitest';
import {
  budgetCap,
  defaultBudget,
  snapToStep,
  sumDuration,
  selectWithinBudget,
} from '../budget';

describe('budget', () => {
  it('cap is the full duration, floored at 30s (no 5m cap)', () => {
    expect(budgetCap(270)).toBe(270);
    expect(budgetCap(600)).toBe(600); // > 5m still reachable
    expect(budgetCap(10)).toBe(30);   // eligible floor
  });

  it('defaults to all clips (the cap)', () => {
    expect(defaultBudget(270)).toBe(270);
  });

  it('snaps to 15s steps within [30, cap]; cap always reachable', () => {
    expect(snapToStep(52, 270)).toBe(45);
    expect(snapToStep(53, 270)).toBe(60);
    expect(snapToStep(10, 270)).toBe(30);   // floor
    expect(snapToStep(272, 270)).toBe(270);  // >= cap -> cap (even if not a 15s multiple)
    expect(snapToStep(265, 272)).toBe(270);
    expect(snapToStep(272, 272)).toBe(272);  // exact cap reachable
  });

  it('selects greedy-with-skip and never returns empty', () => {
    const reels = [
      { id: 1, duration: 20 },
      { id: 2, duration: 15 },
      { id: 3, duration: 40 },
      { id: 4, duration: 10 },
    ];
    // budget 30: take 20 (used 20), skip 15 (would be 35), skip 40, take 10 (used 30)
    expect(selectWithinBudget(reels, 30).map((r) => r.id)).toEqual([1, 4]);

    // budget below the first reel -> fall back to the first reel (never empty)
    expect(selectWithinBudget([{ id: 9, duration: 40 }], 30).map((r) => r.id)).toEqual([9]);

    // null-duration reels are skipped
    expect(selectWithinBudget([{ id: 1, duration: null }, { id: 2, duration: 10 }], 60)
      .map((r) => r.id)).toEqual([2]);
  });

  it('sums durations treating null as 0', () => {
    expect(sumDuration([{ duration: 20 }, { duration: null }, { duration: 10 }])).toBe(30);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCreditStore } from './creditStore';

describe('creditStore', () => {
  beforeEach(() => {
    useCreditStore.setState({
      balance: 0,
      loaded: false,
    });
  });

  describe('canAffordExport (T9750: round-half-up)', () => {
    it('returns true when balance >= round-half-up(videoSeconds)', () => {
      useCreditStore.setState({ balance: 26 });
      // 25.5 rounds up to 26
      expect(useCreditStore.getState().canAffordExport(25.5)).toBe(true);
    });

    it('returns false when balance < round-half-up(videoSeconds)', () => {
      useCreditStore.setState({ balance: 10 });
      expect(useCreditStore.getState().canAffordExport(25.5)).toBe(false);
    });

    it('handles exact balance match', () => {
      useCreditStore.setState({ balance: 30 });
      expect(useCreditStore.getState().canAffordExport(30)).toBe(true);
    });

    it('rounds a fractional second DOWN when below .5 (was ceil, now nearest)', () => {
      useCreditStore.setState({ balance: 30 });
      // 30.1s now rounds to 30 credits (round-half-up), so 30 balance affords it
      expect(useCreditStore.getState().canAffordExport(30.1)).toBe(true);
    });

    it('rounds a fractional second UP when at/above .5', () => {
      useCreditStore.setState({ balance: 30 });
      // 30.5s rounds up to 31 credits, so 30 balance does NOT afford it
      expect(useCreditStore.getState().canAffordExport(30.5)).toBe(false);
    });
  });

  describe('getRequiredCredits (T9750: round-half-up, 1-credit floor)', () => {
    it('rounds to the nearest integer, half up', () => {
      expect(useCreditStore.getState().getRequiredCredits(10.1)).toBe(10);
      expect(useCreditStore.getState().getRequiredCredits(10.0)).toBe(10);
      expect(useCreditStore.getState().getRequiredCredits(6.5)).toBe(7);
      expect(useCreditStore.getState().getRequiredCredits(6.49)).toBe(6);
      expect(useCreditStore.getState().getRequiredCredits(6.027)).toBe(6);
    });

    it('floors any positive sub-1s duration to 1 credit, never 0', () => {
      expect(useCreditStore.getState().getRequiredCredits(0.3)).toBe(1);
      expect(useCreditStore.getState().getRequiredCredits(0.5)).toBe(1);
    });

    it('returns 0 for zero/negative duration', () => {
      expect(useCreditStore.getState().getRequiredCredits(0)).toBe(0);
      expect(useCreditStore.getState().getRequiredCredits(-5)).toBe(0);
    });
  });

  describe('setBalance', () => {
    it('updates balance', () => {
      useCreditStore.getState().setBalance(42);
      expect(useCreditStore.getState().balance).toBe(42);
    });
  });

  describe('fetchCredits', () => {
    it('updates store from API response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ balance: 75 }),
      });

      await useCreditStore.getState().fetchCredits();

      const state = useCreditStore.getState();
      expect(state.balance).toBe(75);
      expect(state.loaded).toBe(true);
    });

    it('handles fetch failure gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      await useCreditStore.getState().fetchCredits();

      expect(useCreditStore.getState().balance).toBe(0);
      expect(useCreditStore.getState().loaded).toBe(false);
    });
  });
});

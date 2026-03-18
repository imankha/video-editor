import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useCreditStore } from './creditStore';

describe('creditStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useCreditStore.setState({
      balance: 0,
      firstFramingUsed: true,
      firstAnnotateUsed: true,
      loaded: false,
    });
  });

  describe('canAffordExport', () => {
    it('returns true when balance >= ceil(videoSeconds)', () => {
      useCreditStore.setState({ balance: 30, firstFramingUsed: true });
      expect(useCreditStore.getState().canAffordExport(25.5)).toBe(true);
    });

    it('returns false when balance < ceil(videoSeconds)', () => {
      useCreditStore.setState({ balance: 10, firstFramingUsed: true });
      expect(useCreditStore.getState().canAffordExport(25.5)).toBe(false);
    });

    it('returns true when first framing not used (free)', () => {
      useCreditStore.setState({ balance: 0, firstFramingUsed: false });
      expect(useCreditStore.getState().canAffordExport(100)).toBe(true);
    });

    it('handles exact balance match', () => {
      useCreditStore.setState({ balance: 30, firstFramingUsed: true });
      expect(useCreditStore.getState().canAffordExport(30)).toBe(true);
    });

    it('rounds up fractional seconds', () => {
      useCreditStore.setState({ balance: 30, firstFramingUsed: true });
      // 30.1 seconds requires 31 credits
      expect(useCreditStore.getState().canAffordExport(30.1)).toBe(false);
    });
  });

  describe('getRequiredCredits', () => {
    it('rounds up to nearest integer', () => {
      expect(useCreditStore.getState().getRequiredCredits(10.1)).toBe(11);
      expect(useCreditStore.getState().getRequiredCredits(10.0)).toBe(10);
      expect(useCreditStore.getState().getRequiredCredits(0.5)).toBe(1);
    });
  });

  describe('setBalance', () => {
    it('updates balance', () => {
      useCreditStore.getState().setBalance(42);
      expect(useCreditStore.getState().balance).toBe(42);
    });
  });

  describe('markFirstFramingUsed', () => {
    it('sets firstFramingUsed to true', () => {
      useCreditStore.setState({ firstFramingUsed: false });
      useCreditStore.getState().markFirstFramingUsed();
      expect(useCreditStore.getState().firstFramingUsed).toBe(true);
    });
  });

  describe('markFirstAnnotateUsed', () => {
    it('sets firstAnnotateUsed to true', () => {
      useCreditStore.setState({ firstAnnotateUsed: false });
      useCreditStore.getState().markFirstAnnotateUsed();
      expect(useCreditStore.getState().firstAnnotateUsed).toBe(true);
    });
  });

  describe('fetchCredits', () => {
    it('updates store from API response', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          balance: 75,
          first_framing_used: true,
          first_annotate_used: false,
        }),
      });

      await useCreditStore.getState().fetchCredits();

      const state = useCreditStore.getState();
      expect(state.balance).toBe(75);
      expect(state.firstFramingUsed).toBe(true);
      expect(state.firstAnnotateUsed).toBe(false);
      expect(state.loaded).toBe(true);
    });

    it('handles fetch failure gracefully', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('network error'));

      await useCreditStore.getState().fetchCredits();

      // Should not crash, state unchanged
      expect(useCreditStore.getState().balance).toBe(0);
      expect(useCreditStore.getState().loaded).toBe(false);
    });
  });
});

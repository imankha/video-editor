import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPendingGame,
  hasPendingGame,
  consumePendingGame,
  setPendingProject,
  clearPendingProject,
  consumePendingProject,
  setPendingGameReference,
  peekPendingGameReference,
  consumePendingGameReference,
} from './pendingNavigation';

describe('pendingNavigation', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('pending game', () => {
    it('round-trips game id and seek time', () => {
      setPendingGame(42, 12.5);
      expect(hasPendingGame()).toBe(true);
      expect(consumePendingGame()).toEqual({ gameId: 42, seekTime: 12.5, sourceClipId: null });
    });

    it('omits seek time when not provided', () => {
      setPendingGame(7);
      expect(consumePendingGame()).toEqual({ gameId: 7, seekTime: null, sourceClipId: null });
    });

    it('round-trips the source clip id (T3960)', () => {
      setPendingGame(42, 12.5, 99);
      expect(consumePendingGame()).toEqual({ gameId: 42, seekTime: 12.5, sourceClipId: 99 });
    });

    it('carries source clip id without a seek time', () => {
      setPendingGame(42, null, 99);
      expect(consumePendingGame()).toEqual({ gameId: 42, seekTime: null, sourceClipId: 99 });
    });

    it('omits source clip id when not provided', () => {
      setPendingGame(42, 12.5);
      expect(consumePendingGame().sourceClipId).toBeNull();
    });

    it('consume clears the source clip breadcrumb', () => {
      setPendingGame(42, 12.5, 99);
      consumePendingGame();
      expect(consumePendingGame()).toBeNull();
      setPendingGame(7);
      expect(consumePendingGame()).toEqual({ gameId: 7, seekTime: null, sourceClipId: null });
    });

    it('consume clears the breadcrumb', () => {
      setPendingGame(42, 12.5);
      consumePendingGame();
      expect(hasPendingGame()).toBe(false);
      expect(consumePendingGame()).toBeNull();
    });

    it('returns null when nothing is pending', () => {
      expect(hasPendingGame()).toBe(false);
      expect(consumePendingGame()).toBeNull();
    });
  });

  describe('pending project', () => {
    it('round-trips project id, mode, and clip index', () => {
      setPendingProject(99, { mode: 'overlay', clipIndex: 2 });
      expect(consumePendingProject()).toEqual({ projectId: 99, mode: 'overlay', clipIndex: 2 });
    });

    it('supports id-only breadcrumbs (mode decided at load time)', () => {
      setPendingProject(99);
      expect(consumePendingProject()).toEqual({ projectId: 99, mode: null, clipIndex: null });
    });

    it('clipIndex 0 survives the round-trip', () => {
      setPendingProject(99, { mode: 'framing', clipIndex: 0 });
      expect(consumePendingProject()).toEqual({ projectId: 99, mode: 'framing', clipIndex: 0 });
    });

    it('consume clears the breadcrumb', () => {
      setPendingProject(99, { mode: 'overlay' });
      consumePendingProject();
      expect(consumePendingProject()).toBeNull();
    });

    it('clearPendingProject removes all keys', () => {
      setPendingProject(99, { mode: 'overlay', clipIndex: 1 });
      clearPendingProject();
      expect(consumePendingProject()).toBeNull();
    });

    it('a new selection overwrites a previous breadcrumb completely', () => {
      setPendingProject(99, { mode: 'overlay', clipIndex: 1 });
      clearPendingProject();
      setPendingProject(100);
      expect(consumePendingProject()).toEqual({ projectId: 100, mode: null, clipIndex: null });
    });

    it('game and project breadcrumbs are independent', () => {
      setPendingGame(1);
      setPendingProject(2, { mode: 'overlay' });
      expect(consumePendingProject()).toEqual({ projectId: 2, mode: 'overlay', clipIndex: null });
      expect(hasPendingGame()).toBe(true);
    });
  });

  describe('pending game reference (T5820)', () => {
    it('round-trips profile id, owning-game id, and owning-profile name', () => {
      setPendingGameReference({
        sourceProfileId: 'prof-A',
        sourceGameId: 501,
        sourceProfileName: 'Default',
      });
      expect(peekPendingGameReference()).toEqual({
        sourceProfileId: 'prof-A',
        sourceGameId: 501,
        sourceProfileName: 'Default',
      });
    });

    it('peek does NOT clear (the consume gate re-checks until the target settles)', () => {
      setPendingGameReference({ sourceProfileId: 'prof-A', sourceGameId: 501, sourceProfileName: 'N' });
      peekPendingGameReference();
      expect(peekPendingGameReference()).not.toBeNull();
    });

    it('consume reads then clears — consumed-once semantics', () => {
      setPendingGameReference({ sourceProfileId: 'prof-A', sourceGameId: 501, sourceProfileName: 'N' });
      expect(consumePendingGameReference()).toEqual({
        sourceProfileId: 'prof-A', sourceGameId: 501, sourceProfileName: 'N',
      });
      expect(peekPendingGameReference()).toBeNull();
      expect(consumePendingGameReference()).toBeNull();
    });

    it('supports a missing owning-game id (defensive — the backend always projects one for a reference)', () => {
      setPendingGameReference({ sourceProfileId: 'prof-A', sourceProfileName: 'N' });
      expect(peekPendingGameReference()).toEqual({
        sourceProfileId: 'prof-A', sourceGameId: null, sourceProfileName: 'N',
      });
    });

    it('returns null when nothing is pending', () => {
      expect(peekPendingGameReference()).toBeNull();
      expect(consumePendingGameReference()).toBeNull();
    });

    it('is independent of the annotate pending-game breadcrumb', () => {
      setPendingGame(42, 12.5);
      setPendingGameReference({ sourceProfileId: 'prof-A', sourceGameId: 501, sourceProfileName: 'N' });
      consumePendingGameReference();
      // The annotate breadcrumb is untouched by consuming the reference one.
      expect(hasPendingGame()).toBe(true);
      expect(consumePendingGame()).toEqual({ gameId: 42, seekTime: 12.5, sourceClipId: null });
    });
  });
});

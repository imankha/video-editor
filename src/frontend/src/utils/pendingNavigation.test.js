import { describe, it, expect, beforeEach } from 'vitest';
import {
  setPendingGame,
  hasPendingGame,
  consumePendingGame,
  setPendingProject,
  clearPendingProject,
  consumePendingProject,
} from './pendingNavigation';

describe('pendingNavigation', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('pending game', () => {
    it('round-trips game id and seek time', () => {
      setPendingGame(42, 12.5);
      expect(hasPendingGame()).toBe(true);
      expect(consumePendingGame()).toEqual({ gameId: 42, seekTime: 12.5 });
    });

    it('omits seek time when not provided', () => {
      setPendingGame(7);
      expect(consumePendingGame()).toEqual({ gameId: 7, seekTime: null });
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
});

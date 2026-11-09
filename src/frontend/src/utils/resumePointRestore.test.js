import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEditorStore } from '../stores/editorStore';
import { useGamesDataStore } from '../stores/gamesDataStore';
import { useProjectsStore } from '../stores/projectsStore';
import { restoreFromResumePoint, isFreshResumePoint } from './resumePointRestore';

vi.mock('./resumePoint', () => ({ deleteResumePoint: vi.fn() }));
vi.mock('./deepLinkRecovery', () => ({ showNotHereNotice: vi.fn() }));

import { deleteResumePoint } from './resumePoint';
import { showNotHereNotice } from './deepLinkRecovery';

// T14980: cold-load restore of the server-held resume point. Read-only -- it must never
// write anything but a DELETE when the target is gone, and never fire for anything other
// than the bare `/` arrival the caller already gated on.

const FRESH_LEFT_AT = () => new Date(Date.now() - 1000).toISOString();
const STALE_LEFT_AT = () => new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();

describe('isFreshResumePoint', () => {
  it('rejects a point with no path or left_at', () => {
    expect(isFreshResumePoint(null)).toBe(false);
    expect(isFreshResumePoint({ left_at: FRESH_LEFT_AT() })).toBe(false);
    expect(isFreshResumePoint({ path: '/focus/p/1' })).toBe(false);
  });

  it('rejects a point older than 30 days', () => {
    expect(isFreshResumePoint({ path: '/focus/p/1', left_at: STALE_LEFT_AT() })).toBe(false);
  });

  it('accepts a fresh point', () => {
    expect(isFreshResumePoint({ path: '/focus/p/1', left_at: FRESH_LEFT_AT() })).toBe(true);
  });
});

describe('restoreFromResumePoint', () => {
  let setEditorMode;
  let selectProject;

  beforeEach(() => {
    setEditorMode = vi.fn();
    selectProject = vi.fn();
    useEditorStore.setState({ setEditorMode });
    useGamesDataStore.setState({ games: [{ id: 42 }] });
    useProjectsStore.setState({ projects: [{ id: 7 }], selectProject });
    deleteResumePoint.mockClear();
    showNotHereNotice.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it('does nothing for a stale point', () => {
    restoreFromResumePoint({ path: '/focus/p/7', screen: 'framing', left_at: STALE_LEFT_AT() });
    expect(setEditorMode).not.toHaveBeenCalled();
  });

  it('opens an existing project at its mode', () => {
    restoreFromResumePoint({ path: '/focus/p/7', screen: 'framing', left_at: FRESH_LEFT_AT() });
    expect(selectProject).toHaveBeenCalledWith(7);
    expect(setEditorMode).toHaveBeenCalledWith('framing', { projectId: 7, seekTime: null });
    expect(deleteResumePoint).not.toHaveBeenCalled();
  });

  it('restores a Focus point at its recorded playhead (T15340)', () => {
    restoreFromResumePoint({ path: '/focus/p/7', screen: 'framing', left_at: FRESH_LEFT_AT(), t: 37 });
    expect(setEditorMode).toHaveBeenCalledWith('framing', { projectId: 7, seekTime: 37 });
  });

  it('restores an Overlay point at its recorded playhead (T15340)', () => {
    restoreFromResumePoint({ path: '/overlay/p/7', screen: 'overlay', left_at: FRESH_LEFT_AT(), t: 12 });
    expect(setEditorMode).toHaveBeenCalledWith('overlay', { projectId: 7, seekTime: 12 });
  });

  it('lands on Home and clears the point when the project is gone', () => {
    restoreFromResumePoint({ path: '/focus/p/999', screen: 'framing', left_at: FRESH_LEFT_AT() });
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(selectProject).not.toHaveBeenCalled();
    expect(deleteResumePoint).toHaveBeenCalled();
    expect(showNotHereNotice).toHaveBeenCalledWith('project');
  });

  it('opens an existing game in Annotate', () => {
    restoreFromResumePoint({ path: '/annotate/g/42', screen: 'annotate', left_at: FRESH_LEFT_AT() });
    expect(setEditorMode).toHaveBeenCalledWith('annotate');
    expect(deleteResumePoint).not.toHaveBeenCalled();
  });

  it('lands on Home and clears the point when the game is gone', () => {
    restoreFromResumePoint({ path: '/annotate/g/999', screen: 'annotate', left_at: FRESH_LEFT_AT() });
    expect(setEditorMode).not.toHaveBeenCalled();
    expect(deleteResumePoint).toHaveBeenCalled();
    expect(showNotHereNotice).toHaveBeenCalledWith('game');
  });

  it('restores a bare Home point without touching projects/games', () => {
    restoreFromResumePoint({ path: '/home', screen: 'project-manager', left_at: FRESH_LEFT_AT() });
    expect(setEditorMode).toHaveBeenCalledWith('project-manager');
    expect(deleteResumePoint).not.toHaveBeenCalled();
  });
});

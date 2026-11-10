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
  it('rejects a point with no path', () => {
    expect(isFreshResumePoint(null)).toBe(false);
    expect(isFreshResumePoint({ left_at: FRESH_LEFT_AT() })).toBe(false);
  });

  it('rejects a point older than 30 days (left_at present)', () => {
    expect(isFreshResumePoint({ path: '/focus/p/1', left_at: STALE_LEFT_AT() })).toBe(false);
  });

  // T15360: a gesture write (navigation, or the last write before a suppressed
  // sign-out beacon) always carries left_at: null. The server already dropped
  // anything older than RESUME_MAX_AGE_DAYS before handing the point back (its
  // own `updated_at` column), so a missing left_at must NOT be treated as
  // "absent" -- that was the bug: no stored point was ever restorable.
  it('trusts the server age filter when left_at is absent', () => {
    expect(isFreshResumePoint({ path: '/focus/p/1' })).toBe(true);
    expect(isFreshResumePoint({ path: '/focus/p/1', left_at: null })).toBe(true);
  });

  it('accepts a fresh point', () => {
    expect(isFreshResumePoint({ path: '/focus/p/1', left_at: FRESH_LEFT_AT() })).toBe(true);
  });
});

describe('restoreFromResumePoint', () => {
  let setEditorMode;
  let selectProject;
  let loadProject;

  beforeEach(() => {
    setEditorMode = vi.fn();
    selectProject = vi.fn().mockResolvedValue({ id: 7 });
    loadProject = vi.fn().mockResolvedValue({ mode: 'framing' });
    useEditorStore.setState({ setEditorMode });
    useGamesDataStore.setState({ games: [{ id: 42 }] });
    useProjectsStore.setState({ projects: [{ id: 7 }], selectProject });
    deleteResumePoint.mockClear();
    showNotHereNotice.mockClear();
  });

  afterEach(() => vi.restoreAllMocks());

  it('does nothing for a stale point', () => {
    restoreFromResumePoint({ path: '/focus/p/7', screen: 'framing', left_at: STALE_LEFT_AT() }, { loadProject });
    expect(setEditorMode).not.toHaveBeenCalled();
  });

  it('opens an existing project at its mode', () => {
    restoreFromResumePoint({ path: '/focus/p/7', screen: 'framing', left_at: FRESH_LEFT_AT() }, { loadProject });
    expect(selectProject).toHaveBeenCalledWith(7);
    expect(setEditorMode).toHaveBeenCalledWith('framing', { projectId: 7, seekTime: null });
    expect(deleteResumePoint).not.toHaveBeenCalled();
  });

  it('restores a Focus point at its recorded playhead (T15340)', () => {
    restoreFromResumePoint({ path: '/focus/p/7', screen: 'framing', left_at: FRESH_LEFT_AT(), t: 37 }, { loadProject });
    expect(setEditorMode).toHaveBeenCalledWith('framing', { projectId: 7, seekTime: 37 });
  });

  it('restores an Overlay point at its recorded playhead (T15340)', () => {
    restoreFromResumePoint({ path: '/overlay/p/7', screen: 'overlay', left_at: FRESH_LEFT_AT(), t: 12 }, { loadProject });
    expect(setEditorMode).toHaveBeenCalledWith('overlay', { projectId: 7, seekTime: 12 });
  });

  // T15410: selectProject() alone only fetches the project record -- it never populates
  // projectDataStore's clips/working video, which is what FocusScreen/OverlayScreen actually
  // render from. Without loadProject, the restored editor hangs on "Loading..." (same gap
  // T15220 fixed for the payment-return path).
  it('loads the project data, not just the record, after selecting it (T15410)', async () => {
    restoreFromResumePoint({ path: '/focus/p/7', screen: 'framing', left_at: FRESH_LEFT_AT() }, { loadProject });
    await vi.waitFor(() => expect(loadProject).toHaveBeenCalledWith({ id: 7 }, { mode: 'framing' }));
  });

  it('updates the mode if loadProject resolves a different one (e.g. overlay redirected to framing)', async () => {
    loadProject.mockResolvedValue({ mode: 'framing' });
    restoreFromResumePoint({ path: '/overlay/p/7', screen: 'overlay', left_at: FRESH_LEFT_AT() }, { loadProject });
    await vi.waitFor(() => expect(loadProject).toHaveBeenCalledWith({ id: 7 }, { mode: 'overlay' }));
    expect(setEditorMode).toHaveBeenCalledWith('framing', { projectId: 7 });
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

  // T15360: both writers store path = pathname + search (e.g. '/annotate/g/42?profile=9fa7378c&t=5').
  // modeFromPath/parseEditorPath must still resolve mode and id off the pathname alone.
  it('restores a game point whose stored path carries a query string', () => {
    restoreFromResumePoint({ path: '/annotate/g/42?profile=9fa7378c', screen: 'annotate', left_at: FRESH_LEFT_AT() });
    expect(setEditorMode).toHaveBeenCalledWith('annotate');
    expect(deleteResumePoint).not.toHaveBeenCalled();
  });

  it('restores a project point whose stored path carries a query string, with t read from it', () => {
    restoreFromResumePoint({ path: '/focus/p/7?profile=9fa7378c&t=5', screen: 'framing', left_at: FRESH_LEFT_AT() }, { loadProject });
    expect(setEditorMode).toHaveBeenCalledWith('framing', { projectId: 7, seekTime: 5 });
  });
});

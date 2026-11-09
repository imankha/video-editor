import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEditorStore, resolveEditorScreen, APP_SCREENS, EDITOR_MODES, modeFromPath, parseEditorPath, dropSeekParam, HOME_TAB_PATHS } from './editorStore';
import { useProjectsStore } from './projectsStore';
import { setPendingGame, peekPendingGame, consumePendingProject } from '../utils/pendingNavigation';
import { reinstallProfileHeader } from '../utils/sessionInit';
import { useProfileStore } from './profileStore';

describe('editorStore', () => {
  // Reset store before each test
  beforeEach(() => {
    useEditorStore.setState({
      editorMode: 'framing',
      modeSwitchDialog: { isOpen: false, pendingMode: null },
      selectedLayer: 'playhead',
    });
  });

  describe('editorMode', () => {
    it('starts in framing mode', () => {
      expect(useEditorStore.getState().editorMode).toBe('framing');
    });

    it('setEditorMode changes the mode', () => {
      useEditorStore.getState().setEditorMode('overlay');
      expect(useEditorStore.getState().editorMode).toBe('overlay');
    });

    it('setEditorMode to annotate works', () => {
      useEditorStore.getState().setEditorMode('annotate');
      expect(useEditorStore.getState().editorMode).toBe('annotate');
    });
  });

  describe('modeSwitchDialog', () => {
    it('starts closed with no pending mode', () => {
      const { modeSwitchDialog } = useEditorStore.getState();
      expect(modeSwitchDialog.isOpen).toBe(false);
      expect(modeSwitchDialog.pendingMode).toBe(null);
    });

    it('openModeSwitchDialog opens dialog with pending mode', () => {
      useEditorStore.getState().openModeSwitchDialog('overlay');
      const { modeSwitchDialog } = useEditorStore.getState();
      expect(modeSwitchDialog.isOpen).toBe(true);
      expect(modeSwitchDialog.pendingMode).toBe('overlay');
    });

    it('closeModeSwitchDialog closes without changing mode', () => {
      useEditorStore.getState().openModeSwitchDialog('overlay');
      useEditorStore.getState().closeModeSwitchDialog();

      const { modeSwitchDialog, editorMode } = useEditorStore.getState();
      expect(modeSwitchDialog.isOpen).toBe(false);
      expect(modeSwitchDialog.pendingMode).toBe(null);
      expect(editorMode).toBe('framing'); // Mode unchanged
    });

    it('confirmModeSwitch changes mode and closes dialog', () => {
      useEditorStore.getState().openModeSwitchDialog('annotate');
      useEditorStore.getState().confirmModeSwitch();

      const { modeSwitchDialog, editorMode } = useEditorStore.getState();
      expect(modeSwitchDialog.isOpen).toBe(false);
      expect(modeSwitchDialog.pendingMode).toBe(null);
      expect(editorMode).toBe('annotate');
    });

    it('confirmModeSwitch does nothing if no pending mode', () => {
      useEditorStore.getState().confirmModeSwitch();
      expect(useEditorStore.getState().editorMode).toBe('framing');
    });
  });

  describe('selectedLayer', () => {
    it('starts with playhead selected', () => {
      expect(useEditorStore.getState().selectedLayer).toBe('playhead');
    });

    it('setSelectedLayer changes layer', () => {
      useEditorStore.getState().setSelectedLayer('crop');
      expect(useEditorStore.getState().selectedLayer).toBe('crop');
    });

    it('can select highlight layer', () => {
      useEditorStore.getState().setSelectedLayer('highlight');
      expect(useEditorStore.getState().selectedLayer).toBe('highlight');
    });
  });

  describe('modeFromPath (T5677)', () => {
    it('maps known editor paths to their mode', () => {
      expect(modeFromPath('/focus')).toBe(EDITOR_MODES.FRAMING);
      expect(modeFromPath('/overlay')).toBe(EDITOR_MODES.OVERLAY);
      expect(modeFromPath('/annotate')).toBe(EDITOR_MODES.ANNOTATE);
      expect(modeFromPath('/admin')).toBe(EDITOR_MODES.ADMIN);
    });

    it('redirects the legacy /framing path to the Focus mode (T7700)', () => {
      // The Framing step was renamed Focus and its route moved to /focus; old
      // bookmarks/history to /framing must still resolve, not fall through to null.
      expect(modeFromPath('/framing')).toBe(EDITOR_MODES.FRAMING);
    });

    it('maps /home and its tab sub-routes to the project manager', () => {
      expect(modeFromPath('/home')).toBe(EDITOR_MODES.PROJECT_MANAGER);
      expect(modeFromPath('/home/games')).toBe(EDITOR_MODES.PROJECT_MANAGER);
      expect(modeFromPath('/home/reels')).toBe(EDITOR_MODES.PROJECT_MANAGER);
    });

    it('returns null for unknown routes and bare root (caller lands them home)', () => {
      // The store default turns this null into PROJECT_MANAGER, never an editor —
      // an unknown URL must never fall through to /framing (the original bug).
      expect(modeFromPath('/gallery')).toBe(null);
      expect(modeFromPath('/')).toBe(null);
      expect(modeFromPath('/does-not-exist')).toBe(null);
    });
  });

  describe('HOME_TAB_PATHS (T5677 / T8555)', () => {
    it('lists the deep-linkable home tab sub-routes preserved during URL canonicalization', () => {
      expect(HOME_TAB_PATHS).toContain('/home/games');
      expect(HOME_TAB_PATHS).toContain('/home/reels');
      // T8555: the Published home tab must also survive cold-load canonicalization.
      expect(HOME_TAB_PATHS).toContain('/home/published');
      // Bare /home is NOT in the list — it is already canonical and needs no preserving.
      expect(HOME_TAB_PATHS).not.toContain('/home');
      // The retired Highlights tab URL must be gone.
      expect(HOME_TAB_PATHS).not.toContain('/home/highlights');
      // T11230: the In Progress Reels tab was removed, so its deep-link path is no
      // longer preserved -- an old /home/reels-in-progress link now names no tab and
      // falls through to Home (R6).
      expect(HOME_TAB_PATHS).not.toContain('/home/reels-in-progress');
    });
  });

  describe('resolveEditorScreen', () => {
    let warn, error;
    beforeEach(() => {
      warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      error = vi.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('routes PROJECT_MANAGER home even when a project is still selected (the blank-screen bug)', () => {
      expect(resolveEditorScreen(EDITOR_MODES.PROJECT_MANAGER, true)).toBe(APP_SCREENS.HOME);
      expect(resolveEditorScreen(EDITOR_MODES.PROJECT_MANAGER, false)).toBe(APP_SCREENS.HOME);
      expect(warn).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
    });

    it('routes FRAMING/OVERLAY to the editor when a project is selected', () => {
      expect(resolveEditorScreen(EDITOR_MODES.FRAMING, true)).toBe(APP_SCREENS.EDITOR);
      expect(resolveEditorScreen(EDITOR_MODES.OVERLAY, true)).toBe(APP_SCREENS.EDITOR);
      expect(warn).not.toHaveBeenCalled();
    });

    it('routes FRAMING/OVERLAY home and warns when no project is selected', () => {
      expect(resolveEditorScreen(EDITOR_MODES.OVERLAY, false)).toBe(APP_SCREENS.HOME);
      expect(warn).toHaveBeenCalled();
    });

    it('routes ANNOTATE to the editor with or without a project', () => {
      expect(resolveEditorScreen(EDITOR_MODES.ANNOTATE, false)).toBe(APP_SCREENS.EDITOR);
      expect(resolveEditorScreen(EDITOR_MODES.ANNOTATE, true)).toBe(APP_SCREENS.EDITOR);
    });

    it('routes any unhandled mode home and logs an error', () => {
      expect(resolveEditorScreen('totally-unknown-mode', true)).toBe(APP_SCREENS.HOME);
      expect(error).toHaveBeenCalled();
    });
  });

  describe('goToProjectManager', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('clears the selection and switches to project-manager mode atomically', () => {
      useProjectsStore.setState({ selectedProjectId: 45, selectedProject: { id: 45 } });
      useEditorStore.setState({ editorMode: 'overlay' });

      useEditorStore.getState().goToProjectManager();

      expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.PROJECT_MANAGER);
      expect(useProjectsStore.getState().selectedProjectId).toBe(null);
      expect(useProjectsStore.getState().selectedProject).toBe(null);
    });
  });

  describe('mode helpers', () => {
    it('isFramingMode returns true in framing mode', () => {
      expect(useEditorStore.getState().isFramingMode()).toBe(true);
      expect(useEditorStore.getState().isOverlayMode()).toBe(false);
      expect(useEditorStore.getState().isAnnotateMode()).toBe(false);
    });

    it('isOverlayMode returns true in overlay mode', () => {
      useEditorStore.getState().setEditorMode('overlay');
      expect(useEditorStore.getState().isFramingMode()).toBe(false);
      expect(useEditorStore.getState().isOverlayMode()).toBe(true);
      expect(useEditorStore.getState().isAnnotateMode()).toBe(false);
    });

    it('isAnnotateMode returns true in annotate mode', () => {
      useEditorStore.getState().setEditorMode('annotate');
      expect(useEditorStore.getState().isFramingMode()).toBe(false);
      expect(useEditorStore.getState().isOverlayMode()).toBe(false);
      expect(useEditorStore.getState().isAnnotateMode()).toBe(true);
    });
  });

  // T14970: canonical editor URLs
  describe('deep-linkable paths (T14970)', () => {
    afterEach(() => {
      useProjectsStore.setState({ selectedProjectId: null, selectedProject: null });
      sessionStorage.clear();
      window.history.replaceState({}, '', '/home');
    });

    it('modeFromPath resolves the object sub-paths by prefix', () => {
      expect(modeFromPath('/annotate/g/12')).toBe(EDITOR_MODES.ANNOTATE);
      expect(modeFromPath('/focus/p/7')).toBe(EDITOR_MODES.FRAMING);
      expect(modeFromPath('/overlay/p/7')).toBe(EDITOR_MODES.OVERLAY);
    });

    it('modeFromPath rejects a malformed object path instead of guessing a mode', () => {
      expect(modeFromPath('/annotate/g/abc')).toBeNull();
      expect(modeFromPath('/focus/p/')).toBeNull();
      expect(modeFromPath('/overlay/g/7')).toBeNull();
    });

    it('parseEditorPath reads the ids as numbers and the seek time', () => {
      expect(parseEditorPath('/annotate/g/12', '?t=90.5')).toEqual({ gameId: 12, projectId: null, seekTime: 90.5, profileId: null });
      expect(parseEditorPath('/focus/p/7', '')).toEqual({ gameId: null, projectId: 7, seekTime: null, profileId: null });
      expect(parseEditorPath('/overlay/p/7', '?profile=aaaaaaaa')).toEqual({ gameId: null, projectId: 7, seekTime: null, profileId: 'aaaaaaaa' });
    });

    // T15340: Focus/Overlay carry `?t=` the same way Annotate does.
    it('parseEditorPath reads the seek time on focus/overlay project paths too', () => {
      expect(parseEditorPath('/focus/p/7', '?t=37')).toEqual({ gameId: null, projectId: 7, seekTime: 37, profileId: null });
      expect(parseEditorPath('/overlay/p/7', '?t=12')).toEqual({ gameId: null, projectId: 7, seekTime: 12, profileId: null });
    });

    it('parseEditorPath ignores an unusable seek time and bare paths carry no object', () => {
      expect(parseEditorPath('/annotate/g/12', '?t=soon').seekTime).toBeNull();
      expect(parseEditorPath('/annotate/g/12', '?t=-4').seekTime).toBeNull();
      expect(parseEditorPath('/annotate', '')).toEqual({ gameId: null, projectId: null, seekTime: null, profileId: null });
    });

    it('opening a game writes its id into the path', () => {
      setPendingGame(12);
      useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
      expect(window.location.pathname).toBe('/annotate/g/12');
    });

    it('an explicit game id wins and a finished load does not drop the id from the path', () => {
      useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE, { gameId: 12 });
      expect(window.location.pathname).toBe('/annotate/g/12');
      useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
      expect(window.location.pathname).toBe('/annotate/g/12');
    });

    it('switching modes on an open play keeps the play in the path', () => {
      useProjectsStore.setState({ selectedProjectId: 7 });
      useEditorStore.getState().setEditorMode(EDITOR_MODES.FRAMING);
      expect(window.location.pathname).toBe('/focus/p/7');
      useEditorStore.getState().setEditorMode(EDITOR_MODES.OVERLAY);
      expect(window.location.pathname).toBe('/overlay/p/7');
    });

    it('a mode with nothing open stays on the bare path', () => {
      useEditorStore.getState().setEditorMode(EDITOR_MODES.FRAMING);
      expect(window.location.pathname).toBe('/focus');
    });

    // T15340: a resume point's seekTime lands in the path the same way Annotate's does,
    // and sticks across a mode switch on the SAME project (Focus -> Overlay handoff).
    it('an explicit seekTime writes `t` into a project path and survives a mode switch on the same project', () => {
      useProjectsStore.setState({ selectedProjectId: 7 });
      useEditorStore.getState().setEditorMode(EDITOR_MODES.FRAMING, { projectId: 7, seekTime: 37 });
      expect(window.location.pathname + window.location.search).toBe('/focus/p/7?t=37');
      useEditorStore.getState().setEditorMode(EDITOR_MODES.OVERLAY);
      expect(window.location.pathname + window.location.search).toBe('/overlay/p/7?t=37');
    });

    it('dropSeekParam strips `t` without adding a history entry', () => {
      window.history.replaceState({}, '', '/focus/p/7?t=37');
      const before = window.history.length;
      dropSeekParam();
      expect(window.location.pathname + window.location.search).toBe('/focus/p/7');
      expect(window.history.length).toBe(before);
    });

    it('bindAnnotateGamePath replaces the bare path without adding history', () => {
      useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
      const before = window.history.length;
      useEditorStore.getState().bindAnnotateGamePath(31);
      expect(window.location.pathname).toBe('/annotate/g/31');
      expect(window.history.length).toBe(before);
    });

    it('redirectToGamesTab asks a mounted Home to change tab, because the tab is local state', () => {
      const before = useEditorStore.getState().gamesTabRequest;
      useEditorStore.getState().redirectToGamesTab();
      expect(useEditorStore.getState().gamesTabRequest).toBe(before + 1);
    });

    it('redirectToGamesTab lands on the Games tab', () => {
      useEditorStore.getState().setEditorMode(EDITOR_MODES.FRAMING);
      useEditorStore.getState().redirectToGamesTab();
      expect(window.location.pathname).toBe('/home/games');
      expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.PROJECT_MANAGER);
    });

    it('back between two plays in the same mode reopens the play in the path', () => {
      useProjectsStore.setState({ selectedProjectId: 8 });
      useEditorStore.setState({ editorMode: EDITOR_MODES.FRAMING });
      const seq = useEditorStore.getState().urlNavigationSeq;
      window.history.pushState({}, '', '/focus/p/7');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(useProjectsStore.getState().selectedProjectId).toBeNull();
      expect(consumePendingProject()).toEqual({ projectId: 7, mode: EDITOR_MODES.FRAMING });
      expect(useEditorStore.getState().urlNavigationSeq).toBe(seq + 1);
    });

    it('popstate to the play already open does nothing', () => {
      useProjectsStore.setState({ selectedProjectId: 7 });
      useEditorStore.setState({ editorMode: EDITOR_MODES.FRAMING });
      const seq = useEditorStore.getState().urlNavigationSeq;
      window.history.pushState({}, '', '/focus/p/7');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(useProjectsStore.getState().selectedProjectId).toBe(7);
      expect(useEditorStore.getState().urlNavigationSeq).toBe(seq);
    });

    it('back between two games reloads the game in the path', () => {
      useEditorStore.setState({ editorMode: EDITOR_MODES.ANNOTATE, activeAnnotateGameId: 5 });
      const seq = useEditorStore.getState().urlNavigationSeq;
      window.history.pushState({}, '', '/annotate/g/6');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(peekPendingGame()?.gameId).toBe(6);
      expect(useEditorStore.getState().urlNavigationSeq).toBe(seq + 1);
      expect(useEditorStore.getState().takeUrlOpenGame(6)).toBe(true);
    });

    it('back into Annotate from another mode reopens the game even if it was the last one bound', () => {
      useEditorStore.setState({ editorMode: EDITOR_MODES.FRAMING, activeAnnotateGameId: 6 });
      window.history.pushState({}, '', '/annotate/g/6');
      window.dispatchEvent(new PopStateEvent('popstate'));
      expect(peekPendingGame()?.gameId).toBe(6);
      expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.ANNOTATE);
    });

    describe('with a profile in the URL', () => {
      const ownerProfile = 'aaaaaaaa';
      const otherProfile = 'bbbbbbbb';
      const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

      beforeEach(() => reinstallProfileHeader(ownerProfile));
      afterEach(() => reinstallProfileHeader(null));

      it('every written editor URL names the current profile', () => {
        setPendingGame(12);
        useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE);
        expect(window.location.pathname + window.location.search).toBe(`/annotate/g/12?profile=${ownerProfile}`);

        useProjectsStore.setState({ selectedProjectId: 7 });
        useEditorStore.getState().setEditorMode(EDITOR_MODES.OVERLAY);
        expect(window.location.pathname + window.location.search).toBe(`/overlay/p/7?profile=${ownerProfile}`);
      });

      it('home paths stay bare', () => {
        useEditorStore.getState().setEditorMode(EDITOR_MODES.PROJECT_MANAGER);
        expect(window.location.search).toBe('');
      });

      it('upgrades an old bookmark in place, without a history entry', () => {
        window.history.replaceState({}, '', '/annotate/g/12');
        const before = window.history.length;
        useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE, { gameId: 12 });
        expect(window.location.search).toBe(`?profile=${ownerProfile}`);
        expect(window.history.length).toBe(before);
      });

      it('keeps ?t= while the same game stays open', () => {
        window.history.replaceState({}, '', `/annotate/g/12?profile=${ownerProfile}&t=60`);
        useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE, { gameId: 12 });
        expect(window.location.search).toBe(`?profile=${ownerProfile}&t=60`);
      });

      it('writes an explicit seek time, and does not carry one to another game', () => {
        useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE, { gameId: 12, seekTime: 60 });
        expect(window.location.search).toBe(`?profile=${ownerProfile}&t=60`);
        useEditorStore.getState().setEditorMode(EDITOR_MODES.ANNOTATE, { gameId: 13 });
        expect(window.location.search).toBe(`?profile=${ownerProfile}`);
      });

      it('back to the same id in another profile adopts that profile before opening', async () => {
        const order = [];
        const adoptTabProfile = vi.fn(async () => {
          order.push(`adopted, pending=${peekPendingGame()?.gameId ?? 'none'}`);
          return true;
        });
        useProfileStore.setState({ adoptTabProfile });
        useEditorStore.setState({ editorMode: EDITOR_MODES.ANNOTATE, activeAnnotateGameId: 5 });

        window.history.pushState({}, '', `/annotate/g/5?profile=${otherProfile}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
        await flush();

        expect(adoptTabProfile).toHaveBeenCalledWith(otherProfile);
        expect(order).toEqual(['adopted, pending=none']);
        expect(peekPendingGame()?.gameId).toBe(5);
        expect(useEditorStore.getState().editorMode).toBe(EDITOR_MODES.ANNOTATE);
      });

      it('never opens the object when the entry names a profile that is gone', async () => {
        useProfileStore.setState({ adoptTabProfile: vi.fn(async () => false) });
        useEditorStore.setState({ editorMode: EDITOR_MODES.ANNOTATE, activeAnnotateGameId: 5 });

        window.history.pushState({}, '', `/annotate/g/6?profile=${otherProfile}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
        await flush();

        expect(peekPendingGame()).toBeNull();
        expect(window.location.pathname).toBe('/home/games');
        expect(useEditorStore.getState().urlLandingNotice).toEqual({ kind: 'game', unavailable: false });
      });

      it('rejectUrlProfile drops what the URL queued and lands on Games', () => {
        setPendingGame(12);
        useEditorStore.setState({ urlOpenGameId: 12 });
        useEditorStore.getState().rejectUrlProfile({ kind: 'game', unavailable: true });
        expect(peekPendingGame()).toBeNull();
        expect(window.location.pathname).toBe('/home/games');
        expect(useEditorStore.getState().urlOpenGameId).toBeNull();
        expect(useEditorStore.getState().takeUrlLandingNotice()).toEqual({ kind: 'game', unavailable: true });
        expect(useEditorStore.getState().takeUrlLandingNotice()).toBeNull();
      });
    });

    it('takeUrlOpenGame answers once and only for the named game', () => {
      useEditorStore.setState({ urlOpenGameId: 6 });
      expect(useEditorStore.getState().takeUrlOpenGame(9)).toBe(false);
      expect(useEditorStore.getState().takeUrlOpenGame(6)).toBe(true);
      expect(useEditorStore.getState().takeUrlOpenGame(6)).toBe(false);
    });
  });
});

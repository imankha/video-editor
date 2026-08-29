import { render, screen, fireEvent, act, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// jsdom lacks matchMedia. DraftTile's reveal mechanism runs through the REAL
// useIsCoarsePointer hook (T5910), which reads `(pointer: coarse)` — so we stub
// matchMedia and let each test flip the pointer type. This exercises the actual
// width-vs-input-type decision instead of mocking the hook away (a width-only or
// hook-mocked test cannot catch the narrow-desktop-fine-pointer bug).
let coarsePointer = false;
beforeEach(() => {
  coarsePointer = false;
  window.matchMedia = (query) => ({
    matches: query.includes('pointer: coarse') ? coarsePointer : false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

// Stub MediaPlayer: the preview tests care about WHERE the modal mounts (portal)
// and that it unmounts on close — not the player internals (which pull in
// window.matchMedia via VideoControls, absent in jsdom). The stub echoes its src
// so we can locate the mounted player.
vi.mock('./MediaPlayer', () => ({
  MediaPlayer: ({ src }) => <video data-testid="preview-video" src={src} />,
}));

// DraftTile reads several stores; stub the minimal surface it touches.
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('../stores/projectsStore', () => {
  const state = { fetchProjects: vi.fn(), renameProject: vi.fn(), selectedProjectId: null };
  const useProjectsStore = (sel) => sel(state);
  useProjectsStore.getState = () => state;
  return { useProjectsStore };
});
vi.mock('../stores/syncStore', () => {
  const state = { isOffline: false };
  const useSyncStore = (sel) => sel(state);
  useSyncStore.getState = () => state;
  return { useSyncStore };
});
vi.mock('../stores/exportStore', () => {
  const state = { activeExports: {} };
  const useExportStore = (sel) => sel(state);
  useExportStore.getState = () => state;
  return { useExportStore };
});
vi.mock('../stores/galleryStore', () => {
  const api = { fetchCount: vi.fn(), notifyCollectionsChanged: vi.fn(), open: vi.fn() };
  const useGalleryStore = () => api;
  useGalleryStore.getState = () => api;
  return { useGalleryStore };
});
vi.mock('../stores/questStore', () => {
  const api = { recordAchievement: vi.fn() };
  const useQuestStore = () => api;
  useQuestStore.getState = () => api;
  return { useQuestStore };
});
// T7940: DraftTile appends the current profile's id to the poster URL so a
// URL-keyed cache can't cross-serve same-numbered drafts across accounts.
vi.mock('../stores/profileStore', () => ({
  useCurrentProfile: () => ({ id: 'p1', sport: 'soccer' }),
}));

import { DraftTile } from './DraftTile';
import { useProjectsStore } from '../stores/projectsStore';

const baseProject = {
  id: 7,
  name: 'Brilliant Dribble',
  aspect_ratio: '9:16',
  clip_count: 1,
  clips_in_progress: 1,
  clips_exported: 0,
  has_working_video: false,
  has_final_video: false,
  is_published: false,
  is_auto_created: false,
  game_ids: [],
};

function renderTile(overrides = {}, handlers = {}) {
  const onSelect = handlers.onSelect || vi.fn();
  const onSelectWithMode = handlers.onSelectWithMode || vi.fn();
  const result = render(
    <DraftTile
      project={{ ...baseProject, ...overrides }}
      onSelect={onSelect}
      onSelectWithMode={onSelectWithMode}
      onDelete={vi.fn()}
    />
  );
  return { ...result, onSelect, onSelectWithMode };
}

describe('DraftTile (T5672)', () => {
  afterEach(() => {
    useProjectsStore.getState().selectedProjectId = null;
  });
  it('renders a lazy poster img pointing at the T5671 endpoint', () => {
    const { container } = renderTile();
    const img = container.querySelector('img[loading="lazy"]');
    expect(img).toBeTruthy();
    // T7940: URL carries the owner's profile_id as a cache-correctness token.
    expect(img.getAttribute('src')).toMatch(/\/api\/projects\/7\/poster\.jpg\?profile_id=p1$/);
  });

  it('shows a shimmer skeleton while the poster loads, then hides it on load', () => {
    const { container } = renderTile();
    // shimmer skeleton present initially (not the flat gray / branded fallback)
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
    fireEvent.load(container.querySelector('img'));
    expect(container.querySelector('.skeleton-shimmer')).toBeNull();
  });

  it('fades the poster in on load (opacity-0 while loading -> opacity-100 loaded)', () => {
    const { container } = renderTile();
    const img = container.querySelector('img');
    expect(img.className).toMatch(/transition-opacity/);
    expect(img.className).toMatch(/opacity-0/);
    fireEvent.load(img);
    expect(container.querySelector('img').className).toMatch(/opacity-100/);
  });

  it('shows the branded fallback ONLY after a real poster error, never before', () => {
    const { container } = renderTile();
    // While loading: shimmer, no branded fallback gradient
    expect(container.querySelector('.skeleton-shimmer')).toBeTruthy();
    expect(container.querySelector('.from-cyan-900')).toBeNull();
    fireEvent.error(container.querySelector('img'));
    // After error: branded fallback gradient, no shimmer, no img
    expect(container.querySelector('.from-cyan-900')).toBeTruthy();
    expect(container.querySelector('.skeleton-shimmer')).toBeNull();
    expect(container.querySelector('img')).toBeNull();
  });

  it('renders the branded reel-name fallback (no img) when the poster 404s', () => {
    const { container } = renderTile();
    fireEvent.error(container.querySelector('img'));
    // img is gone; the reel name still shows (fallback overlay + scrim both carry it)
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getAllByText('Brilliant Dribble').length).toBeGreaterThan(0);
  });

  it('shows a status chip reflecting framing-in-progress', () => {
    renderTile({ clips_in_progress: 1 });
    expect(screen.getByText('Focus')).toBeTruthy();
  });

  it('shows a Done status chip for a completed reel', () => {
    renderTile({ has_final_video: true, is_published: true });
    expect(screen.getByText('Done')).toBeTruthy();
  });

  // Re-pinned from the old badge-shape test (T6180). Old contract: a single 10px
  // corner <button> labelled "Ready" that published. New contract: "Ready" is a
  // NON-interactive status badge, and a DISTINCT emphasized primary button names the
  // verb ("Move to My Reels") and publishes on click.
  it('makes "Ready" a non-interactive badge and a distinct primary button the publish verb (T6180)', () => {
    renderTile({ has_final_video: true, final_video_id: 99, is_published: false });
    // "Ready" is a status, not a control — no button carries that accessible name.
    expect(screen.queryByRole('button', { name: /^ready$/i })).toBeNull();
    expect(screen.getByText('Ready')).toBeTruthy();
    // The primary action reads as an action and names the destination verb.
    const primary = screen.getByRole('button', { name: 'Move to My Reels' });
    expect(primary).toBeTruthy();
    expect(primary.textContent).toMatch(/move to my reels/i);
  });

  it('publishes via the primary button click (records the moved_to_my_reels quest step)', async () => {
    const apiFetch = (await import('../utils/apiFetch')).default;
    apiFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ archived: true, final_video_id: 99 }),
    });
    const { useQuestStore } = await import('../stores/questStore');
    renderTile({ has_final_video: true, final_video_id: 99, is_published: false });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move to My Reels' }));
    });
    expect(apiFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/downloads\/publish\/7$/),
      expect.objectContaining({ method: 'POST' })
    );
    expect(useQuestStore.getState().recordAchievement).toHaveBeenCalledWith('moved_to_my_reels');
  });

  it('has no primary "Move to My Reels" action once the reel is published', () => {
    renderTile({ has_final_video: true, final_video_id: 99, is_published: true });
    expect(screen.queryByRole('button', { name: /move to my reels/i })).toBeNull();
  });

  // T6180 — the five secondary actions collapse behind a kebab in the ready state,
  // and two-click delete must survive inside it (a menu that closed on the first
  // click would swallow the confirm).
  it('exposes the secondary actions behind a kebab; two-click delete keeps the menu open (T6180)', () => {
    const onDelete = vi.fn();
    render(
      <DraftTile
        project={{ ...baseProject, has_final_video: true, final_video_id: 99, is_published: false }}
        onSelect={vi.fn()}
        onSelectWithMode={vi.fn()}
        onDelete={onDelete}
      />
    );
    // Open the kebab (fine pointer -> portaled popover).
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    // Secondary actions are reachable inside it.
    expect(screen.getByRole('button', { name: /rename/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open in focus/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /open in overlay/i })).toBeTruthy();
    // First delete click ARMS the confirm without deleting or closing the menu.
    const del = screen.getByRole('button', { name: /delete reel/i });
    fireEvent.click(del);
    expect(onDelete).not.toHaveBeenCalled();
    const confirm = screen.getByRole('button', { name: /click again to confirm/i });
    expect(confirm).toBeTruthy();
    // Second click deletes.
    fireEvent.click(confirm);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  // T6890 — the rename pencil sits beside the name in the bottom scrim (was stacked
  // in the top-right hover rail with unrelated actions). It is discoverable at rest
  // (no hover / no kebab open needed) and starts the existing inline rename.
  it('T6890: renders the rename pencil beside the name and starts inline rename', () => {
    const { container } = renderTile();
    const renameBtn = screen.getByRole('button', { name: 'Rename reel' });
    // It lives in the bottom scrim next to the name, NOT inside the hover action rail.
    const rail = container.querySelector('[data-testid="tile-actions"]');
    expect(rail.contains(renameBtn)).toBe(false);
    fireEvent.click(renameBtn);
    // The inline rename input appears, seeded with the current name.
    expect(screen.getByDisplayValue('Brilliant Dribble')).toBeTruthy();
  });

  it('T6890: the hover action rail no longer carries a rename button', () => {
    const { container } = renderTile();
    const rail = container.querySelector('[data-testid="tile-actions"]');
    const railRenameBtn = within(rail).queryByRole('button', { name: 'Rename reel' });
    expect(railRenameBtn).toBeNull();
  });

  it('previews on body tap in the ready state (the tile is no longer inert) (T6180)', () => {
    const { container } = renderTile({ has_final_video: true, final_video_id: 99, is_published: false });
    fireEvent.click(container.querySelector('[data-testid="project-card"]'));
    expect(screen.getByTestId('preview-video')).toBeTruthy();
  });

  it('drops the progress strip and the "Done" status chip in the ready state (Q1/Q2)', () => {
    renderTile({ has_final_video: true, final_video_id: 99, is_published: false });
    // Q1: no "Done" status chip competing with the "Ready" badge.
    expect(screen.queryByText('Done')).toBeNull();
    // Q2: the bottom band is the action bar, not the segmented progress strip.
    expect(screen.getByTestId('ready-actions')).toBeTruthy();
  });

  it('renders the game-time overlay when the draft carries a game start time', () => {
    // formatGameClock expects a seconds value; 705s -> 11'45"
    renderTile({ clip_game_start_time: 705 });
    expect(screen.getByText(/11'45/)).toBeTruthy();
  });

  it('renders a clip-count chip when the draft has more than 1 clip', () => {
    renderTile({ clip_count: 3 });
    const chip = screen.getByText('3').closest('span');
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('title')).toBe('Contains 3 clips');
    expect(chip.getAttribute('aria-label')).toBe('Contains 3 clips');
    // Layers icon should be present (rendered via Lucide)
    expect(chip.querySelector('svg')).toBeTruthy();
  });

  it('does not show a clip-count chip for a single-clip draft', () => {
    renderTile({ clip_count: 1 });
    expect(screen.queryByText('1')).toBeNull();
    expect(screen.queryByTitle(/Contains \d+ clips/)).toBeNull();
  });

  it('renders a portrait 9:16 tile shape once real framing (crop keyframes) exists', () => {
    // baseProject is In Framing (clips_in_progress: 1); the portrait shell only
    // applies once a crop has actually been committed (has_crop_keyframes) — an
    // un-cropped In-Framing draft renders landscape (T6900), a Not-Started draft
    // is landscape regardless of target ratio (T6800). If the fixture's counters
    // ever change, this test changes meaning.
    const { container } = renderTile({ aspect_ratio: '9:16', has_crop_keyframes: true });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-\[9\/16\]/);
    expect(tile.className).not.toMatch(/aspect-video/);
  });

  it('renders a landscape 16:9 tile shape (mirrors ReelTile, not letterboxed into portrait)', () => {
    // has_crop_keyframes so it's landscape by TARGET ratio, not by the unframed
    // source-aspect fallback (T6900) — this pins the 16:9 target shell itself.
    const { container } = renderTile({ aspect_ratio: '16:9', has_crop_keyframes: true });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-video/);
    expect(tile.className).not.toMatch(/aspect-\[9\/16\]/);
  });

  // T6800 — a Not-Started draft renders at SOURCE aspect (landscape), because
  // nothing has been framed yet and its poster is a source-aspect frame; the
  // target ratio only shapes the tile once framing has begun.
  it('renders a Not-Started draft landscape even when the target ratio is 9:16 (T6800)', () => {
    const { container } = renderTile({ aspect_ratio: '9:16', clips_in_progress: 0 });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-video/);
    expect(tile.className).not.toMatch(/aspect-\[9\/16\]/);
  });

  it('keeps the portrait shell once real framing (crop keyframes) exists on a 9:16 draft (T6800/T6900)', () => {
    const { container } = renderTile({ aspect_ratio: '9:16', clips_in_progress: 0, clips_exported: 1, has_crop_keyframes: true });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-\[9\/16\]/);
  });

  // T6900 — a draft that has ENTERED the Framing screen (clips extracted/exported)
  // but has NOT had any crop keyframes committed yet still renders at SOURCE aspect
  // (landscape), not the target 9:16. "Entered framing" is not "framed".
  it('renders an In-Framing-but-uncropped 9:16 draft landscape (clips in progress, no crop) (T6900)', () => {
    const { container } = renderTile({ aspect_ratio: '9:16', clips_in_progress: 1, has_crop_keyframes: false });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-video/);
    expect(tile.className).not.toMatch(/aspect-\[9\/16\]/);
  });

  it('renders an exported-but-uncropped 9:16 draft landscape (clips exported, no crop) (T6900)', () => {
    const { container } = renderTile({ aspect_ratio: '9:16', clips_in_progress: 0, clips_exported: 1, has_crop_keyframes: false });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-video/);
    expect(tile.className).not.toMatch(/aspect-\[9\/16\]/);
  });

  it('switches an In-Framing 9:16 draft to the portrait shell the moment crop keyframes exist (T6900)', () => {
    const { container } = renderTile({ aspect_ratio: '9:16', clips_in_progress: 1, has_crop_keyframes: true });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-\[9\/16\]/);
    expect(tile.className).not.toMatch(/aspect-video/);
  });

  // T6900 regression — once a draft is FRAMED (past In-Framing: a working or
  // final video exists), the source-aspect override no longer applies and the
  // tile takes its TARGET ratio. These pin In-Overlay and Ready explicitly, and
  // deliberately OMIT has_crop_keyframes to prove it is irrelevant here: the
  // has_working_video / has_final_video stage wins regardless of the crop signal.
  it('renders an In-Overlay 9:16 draft at the portrait target shell (crop signal irrelevant) (T6900)', () => {
    const { container } = renderTile({ aspect_ratio: '9:16', has_working_video: true, clips_in_progress: 0 });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-\[9\/16\]/);
    expect(tile.className).not.toMatch(/aspect-video/);
  });

  it('renders a Ready 9:16 draft at the portrait target shell (crop signal irrelevant) (T6900)', () => {
    const { container } = renderTile({ aspect_ratio: '9:16', has_final_video: true, final_video_id: 99, is_published: true, clips_in_progress: 0 });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-\[9\/16\]/);
    expect(tile.className).not.toMatch(/aspect-video/);
  });

  it('renders a 16:9-target In-Overlay draft landscape by TARGET ratio, not the source fallback (T6900)', () => {
    // aspect_ratio is 16:9 so aspect-video is correct; has_working_video makes
    // rendersSourceAspect false, so this asserts the target-ratio path, not the
    // unframed source-aspect fallback (has_crop_keyframes intentionally absent).
    const { container } = renderTile({ aspect_ratio: '16:9', has_working_video: true, clips_in_progress: 0 });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-video/);
    expect(tile.className).not.toMatch(/aspect-\[9\/16\]/);
  });

  it('renders a 16:9-target Ready draft landscape by TARGET ratio, not the source fallback (T6900)', () => {
    const { container } = renderTile({ aspect_ratio: '16:9', has_final_video: true, final_video_id: 99, is_published: true, clips_in_progress: 0 });
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.className).toMatch(/aspect-video/);
    expect(tile.className).not.toMatch(/aspect-\[9\/16\]/);
  });

  // Item 3 — selected/active + currently-loaded accent ring
  it('is keyboard-focusable and exposes a focus-visible ring (item 3)', () => {
    const { container } = renderTile();
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.getAttribute('tabindex')).toBe('0');
    expect(tile.getAttribute('role')).toBe('button');
    expect(tile.className).toMatch(/focus-visible:ring-2/);
  });

  it('gives the CURRENTLY-LOADED draft a persistent accent ring (item 3)', () => {
    useProjectsStore.getState().selectedProjectId = baseProject.id;
    const { container } = renderTile();
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.getAttribute('aria-current')).toBe('true');
    expect(tile.className).toMatch(/ring-cyan-400/);
    expect(tile.className).toMatch(/border-cyan-400/);
  });

  it('does not accent a draft that is not the loaded project (item 3)', () => {
    useProjectsStore.getState().selectedProjectId = 999; // a different project
    const { container } = renderTile();
    const tile = container.querySelector('[data-testid="project-card"]');
    expect(tile.getAttribute('aria-current')).toBeNull();
    expect(tile.className).toMatch(/border-gray-700/);
  });

  it('activates via Enter key like a button (item 3)', () => {
    // A not-yet-started draft opens via onSelect (the default earliest stage).
    const onSelect = vi.fn();
    const { container } = renderTile(
      { clips_in_progress: 0, clips_exported: 0 },
      { onSelect }
    );
    const tile = container.querySelector('[data-testid="project-card"]');
    fireEvent.keyDown(tile, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  // Item 6 — click opens the furthest stage reached
  it('routes an overlay-started draft (working video) to Overlay on click (item 6)', () => {
    const onSelectWithMode = vi.fn();
    const { container } = renderTile(
      { has_working_video: true, clips_in_progress: 0 },
      { onSelectWithMode }
    );
    fireEvent.click(container.querySelector('[data-testid="project-card"]'));
    expect(onSelectWithMode).toHaveBeenCalledWith({ mode: 'overlay' });
  });

  it('routes a framing-started draft (no working video) to Framing clip 0 on click (item 6)', () => {
    const onSelectWithMode = vi.fn();
    const { container } = renderTile(
      { has_working_video: false, clips_in_progress: 1 },
      { onSelectWithMode }
    );
    fireEvent.click(container.querySelector('[data-testid="project-card"]'));
    expect(onSelectWithMode).toHaveBeenCalledWith({ mode: 'framing', clipIndex: 0 });
  });

  it('routes a not-yet-started draft to the default open (earliest stage) on click (item 6)', () => {
    const onSelect = vi.fn();
    const onSelectWithMode = vi.fn();
    const { container } = renderTile(
      { has_working_video: false, clips_in_progress: 0, clips_exported: 0 },
      { onSelect, onSelectWithMode }
    );
    fireEvent.click(container.querySelector('[data-testid="project-card"]'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelectWithMode).not.toHaveBeenCalled();
  });

  // T5910 — the reveal MECHANISM is gated on POINTER TYPE, not viewport width.
  // A narrow desktop window (fine pointer) must reveal actions on HOVER; only a
  // coarse (touch) pointer takes the long-press branch. The regression was that
  // useIsMobile (width-OR-touch) sent a narrow desktop into the touch-only
  // long-press branch, leaving a mouse user with no way to reveal the actions.
  describe('T5910 reveal mechanism gated on pointer type', () => {
    const actionsEl = (container) => container.querySelector('[data-testid="tile-actions"]');

    it('FINE pointer (any width): actions use the group-hover reveal, NOT the long-press branch', () => {
      coarsePointer = false; // a mouse — even at a narrow desktop width
      const { container } = renderTile();
      const actions = actionsEl(container);
      // Hover branch: reveals via group-hover/tile:*, so a mouse hover works.
      expect(actions.className).toMatch(/group-hover\/tile:opacity-100/);
      expect(actions.className).toMatch(/group-hover\/tile:pointer-events-auto/);
    });

    it('COARSE pointer: actions take the long-press branch (hidden until revealed, no group-hover)', () => {
      coarsePointer = true; // a touch device
      const { container } = renderTile();
      const actions = actionsEl(container);
      // Long-press branch: hidden until actionsRevealed, and NOT hover-driven.
      expect(actions.className).toMatch(/opacity-0/);
      expect(actions.className).toMatch(/pointer-events-none/);
      expect(actions.className).not.toMatch(/group-hover\/tile/);
    });

    it('COARSE pointer: a ~500ms long-press reveals the actions (opacity-100 pointer-events-auto)', () => {
      coarsePointer = true;
      vi.useFakeTimers();
      try {
        const { container } = renderTile();
        const card = container.querySelector('[data-testid="project-card"]');
        // Long-press: touchstart then the 500ms timer fires -> actionsRevealed.
        fireEvent.touchStart(card);
        act(() => { vi.advanceTimersByTime(500); });
        const actions = actionsEl(container);
        expect(actions.className).toMatch(/opacity-100/);
        expect(actions.className).toMatch(/pointer-events-auto/);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // T5900 — preview modal must PORTAL out of the tile subtree. The tile applies a
  // hover transform/filter, which makes it the containing block for any fixed
  // descendant; a modal rendered inline would size its video against the tile box
  // (video overflows the panel, defect A) and leave the purple scrub bar burned on
  // the tile (defect B). Portaling to document.body is the mechanism that prevents
  // both — asserted here in a layout-free way (real geometry is the Playwright QA
  // spec T5900-reel-preview-overflow.qa.spec.js).
  describe('T5900 preview modal containment', () => {
    const completed = { has_final_video: true, final_video_id: 99, is_published: false };

    it('renders the preview modal OUTSIDE the tile subtree (portaled to body), not inline', () => {
      const { container } = renderTile(completed);
      fireEvent.click(screen.getByTitle('Preview video'));
      const card = container.querySelector('[data-testid="project-card"]');
      const player = screen.getByTestId('preview-video');
      expect(player.getAttribute('src')).toMatch(/\/api\/downloads\/99\/stream$/);
      // The player is in the document but NOT a descendant of the tile card.
      expect(document.body.contains(player)).toBe(true);
      expect(card.contains(player)).toBe(false);
    });

    it('portals the modal out of the tile for a LANDSCAPE source too (aspect-independent)', () => {
      const { container } = renderTile({ ...completed, aspect_ratio: '16:9' });
      fireEvent.click(screen.getByTitle('Preview video'));
      const card = container.querySelector('[data-testid="project-card"]');
      expect(card.contains(screen.getByTestId('preview-video'))).toBe(false);
    });

    it('unmounts the modal (no player, no scrub chrome) after close via the X button', () => {
      renderTile(completed);
      fireEvent.click(screen.getByTitle('Preview video'));
      expect(screen.queryByTestId('preview-video')).toBeTruthy();
      // Close button is the only iconOnly ghost button inside the portaled modal.
      const closeBtn = screen.getAllByRole('button').find((b) => b.closest('.fixed'));
      fireEvent.click(closeBtn);
      expect(screen.queryByTestId('preview-video')).toBeNull();
      // No leftover fixed modal chrome anywhere in the document.
      expect(document.querySelector('.fixed.inset-4')).toBeNull();
    });
  });
});

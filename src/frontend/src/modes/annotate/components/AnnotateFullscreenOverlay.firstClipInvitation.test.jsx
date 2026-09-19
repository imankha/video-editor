import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T9580 (N41): after the first eligible saved play the editor shows a
// PERSISTENT two-choice invitation at the FOCUS stage — primary "Frame this
// clip" (the stage CTA) + secondary "Keep marking plays" (a dismiss wired to
// closeWithCommit, a pure state transition with NO seek, so the playhead is
// preserved). The secondary is a FOCUS-only affordance: once a clip has a
// working video the single stage CTA suffices.
//
// T10610: the old `focusPending` prop is GONE (design doc § E row 5). The
// pending/in-flight state during the 5-star nudge's create call is now the
// component's OWN `clipCreating` state, surfaced through PlayProgressBadges'
// clip badge (`progress.clip === 'pending'`) — there is no separate disabled
// CTA button or `clip-preparing-note` testid anymore.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

beforeEach(() => {
  mockViewport(false); // desktop strip
  useProjectsStore.setState({ projects: [] });
});
afterEach(() => {
  cleanup();
  useProjectsStore.setState({ projects: [] });
});

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 30,
    videoDuration: 6000,
    onUpdateClip: vi.fn(() => Promise.resolve({ saveOk: true })),
    onClose: vi.fn(),
    onSeek: vi.fn(),
    videoController: {},
    onDeleteClip: vi.fn(),
    ...overrides,
  };
}

const editClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true,
  name: 'My cool play', notes: '', tagged_teammates: [],
};

describe('AnnotateFullscreenOverlay — first-clip invitation (T9580 / N41)', () => {
  it('FOCUS stage shows "Frame this clip" primary + "Keep marking plays" secondary', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps()}
        layout="strip"
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    expect(screen.getByRole('button', { name: 'Frame' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep marking plays' })).toBeTruthy();
  });

  it('"Keep marking plays" dismisses via closeWithCommit (playhead preserved — no onSeek)', () => {
    const onClose = vi.fn();
    const onSeek = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onClose, onSeek })}
        layout="strip"
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep marking plays' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('while the 5-star nudge create call is in flight (clipCreating), the clip badge shows pending and the invitation is not shown yet (no autoProjectId)', async () => {
    let resolveCreate;
    const createPromise = new Promise((res) => { resolveCreate = res; });
    const onUpdateClip = vi.fn(() => createPromise);
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onUpdateClip })}
        layout="strip"
        existingClip={{ ...editClip, rating: 5, autoProjectId: null }}
      />
    );
    // The clip badge is the 5-star nudge — click it to fire the create call.
    fireEvent.click(screen.getByTestId('badge-clip'));
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { createProject: true });
    // In flight: clipCreating is true, PlayProgressBadges reflects it as pending.
    expect(screen.getByTestId('badge-clip').dataset.state).toBe('pending');
    // No project id has landed yet, so the FOCUS-stage invitation is not shown.
    expect(screen.queryByRole('button', { name: 'Frame' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep marking plays' })).toBeNull();

    resolveCreate({ saveOk: true, projectId: 42 });
    await waitFor(() => expect(screen.getByTestId('badge-clip').dataset.state).not.toBe('pending'));
  });

  it('a later stage (Spotlight) shows NO "Keep marking plays" — the single stage CTA suffices', () => {
    useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: false, is_published: false }] });
    render(
      <AnnotateFullscreenOverlay
        {...baseProps()}
        layout="strip"
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    expect(screen.getByRole('button', { name: 'Apply Spotlight' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep marking plays' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Frame' })).toBeNull();
  });
});

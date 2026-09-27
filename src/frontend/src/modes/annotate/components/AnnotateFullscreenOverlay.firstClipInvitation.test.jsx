import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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

  // T11150 (Play editor hierarchy): the T10410 clip badge's 5-star create-clip
  // nudge/pending flow is retired along with the whole progress-badges row —
  // clip creation now lives entirely on the main Annotate screen (T11130
  // scope). The invitation-not-shown-until-autoProjectId-lands behavior it
  // pinned is still covered structurally: no autoProjectId -> no stage CTA
  // (see "renders NO stage CTA for a project-less play" in
  // AnnotateFullscreenOverlay.portraitStrip.test.jsx and the stripLayout
  // suite's project-required assertions).

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

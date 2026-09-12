import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T9580 (N41): after the first eligible saved play the editor stays open (T9330)
// and shows a PERSISTENT two-choice invitation at the FOCUS stage — primary
// "Frame this clip" (the reworded FOCUS-stage CTA) + secondary "Keep marking
// plays" (a dismiss wired to onClose -> closeOverlay, which is a pure state
// transition with NO seek, so the playhead is preserved). The secondary is a
// FOCUS-only affordance: once a clip has a working video the single stage CTA
// suffices. Reuse (repeated clicks open the SAME project, never a duplicate) is
// covered by getClipStage/autoProjectId and the stayOpen suite; this file guards
// the invitation wording, its dismiss, and its FOCUS-only gating.

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

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onCreateClip: () => {},
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'inline_desktop',
  layout: 'strip',
};

const editClip = { id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true, name: 'My cool play' };

describe('AnnotateFullscreenOverlay — first-clip invitation (T9580 / N41)', () => {
  it('FOCUS stage shows "Frame this clip" primary + "Keep marking plays" secondary', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    expect(screen.getByRole('button', { name: 'Frame this clip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep marking plays' })).toBeTruthy();
  });

  it('"Keep marking plays" dismisses via onClose (playhead preserved — no onSeek)', () => {
    const onClose = vi.fn();
    const onSeek = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        onClose={onClose}
        onSeek={onSeek}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Keep marking plays' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSeek).not.toHaveBeenCalled();
  });

  it('during the create-in-flight window (focusPending, no autoProjectId) the invitation shows a DISABLED "Frame this clip" + "Keep marking plays"', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: null }}
        focusPending
      />
    );
    const primary = screen.getByRole('button', { name: 'Frame this clip' });
    expect(primary.disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Keep marking plays' })).toBeTruthy();
  });

  it('a later stage (Spotlight) shows NO "Keep marking plays" — the single stage CTA suffices', () => {
    useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: false, is_published: false }] });
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    expect(screen.getByRole('button', { name: 'Apply Spotlight' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Keep marking plays' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Frame this clip' })).toBeNull();
  });

  it('create mode (no existing clip) shows neither invitation button', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={null} />);
    expect(screen.queryByRole('button', { name: 'Frame this clip' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep marking plays' })).toBeNull();
  });
});

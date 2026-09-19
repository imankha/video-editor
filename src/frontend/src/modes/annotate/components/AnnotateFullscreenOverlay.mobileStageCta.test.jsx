import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T9330 (design §2.6): the MOBILE edit sheet (layout="inline") must carry the
// SAME stage-aware CTA as the desktop strip — Frame this clip / Apply Spotlight /
// View Final / View Published — so editing a clip-with-a-project on a phone has a
// path into Focus/Spotlight/the finished video.
//
// T10610: the T8730 "dirty check" confirm dialog ("Save this play first?") is
// DELETED — there is nothing to be dirty about anymore (every field commits
// on its own gesture). The stage CTA now just awaits onAwaitWrites(id) before
// navigating (design doc § C.4), same as the desktop strip
// (see AnnotateFullscreenOverlay.frameOrdering.test.jsx). There is also no
// more create mode, so the old "create mode shows no stage CTA" test is gone.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

beforeEach(() => mockViewport(true)); // mobile — the inline sheet surface
afterEach(() => useProjectsStore.setState({ projects: [] }));

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onUpdateClip: () => Promise.resolve({ saveOk: true }),
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  onDeleteClip: () => {},
  layout: 'inline',
};

const editClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], notes: '',
  name: 'My cool play', my_athlete: true, tagged_teammates: [],
};

describe('AnnotateFullscreenOverlay mobile inline sheet — stage CTA (T9330 §2.6)', () => {
  it('edit mode with a fresh-draft project renders "Frame this clip" in the mobile sheet', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
      />
    );
    expect(screen.getByRole('button', { name: 'Frame' })).toBeTruthy();
  });

  it('reflects the linked project stage (Spotlight) on mobile too', () => {
    useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: false, is_published: false }] });
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    expect(screen.queryByRole('button', { name: 'Frame' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply Spotlight' })).toBeTruthy();
  });

  it('clicking the stage CTA awaits onAwaitWrites and navigates when it resolves true', async () => {
    const onAwaitWrites = vi.fn(() => Promise.resolve(true));
    const onOpenInFocus = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
        onAwaitWrites={onAwaitWrites}
        onOpenInFocus={onOpenInFocus}
      />
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Frame' }));
    expect(onAwaitWrites).toHaveBeenCalledWith('c1');
    expect(screen.queryByText('Save this play first?')).toBeNull();
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });

  it('a pending/failed write chain (onAwaitWrites resolves false) blocks navigation with no dialog', async () => {
    const onAwaitWrites = vi.fn(() => Promise.resolve(false));
    const onOpenInFocus = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
        onAwaitWrites={onAwaitWrites}
        onOpenInFocus={onOpenInFocus}
      />
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Frame' }));
    expect(onAwaitWrites).toHaveBeenCalledWith('c1');
    expect(screen.queryByText('Save this play first?')).toBeNull();
    expect(onOpenInFocus).not.toHaveBeenCalled();
  });
});

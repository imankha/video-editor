import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T10610 § C.4 / design doc § E row 4: replaces the retired
// .focusPrompt.test.jsx. There is no more "Save this play first?" confirm
// dialog (focusConfirmDialog) — the stage CTA now awaits onAwaitWrites(id)
// before navigating. A false resolution means "do not navigate", full stop:
// no dialog of any kind appears, the persistent Retry/error state (already
// on screen via SaveStatusBadge) is the only feedback.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

const editClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true,
  name: 'My cool play', notes: '', tagged_teammates: [], autoProjectId: 42,
};

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 30,
    videoDuration: 6000,
    existingClip: editClip,
    onUpdateClip: vi.fn(() => Promise.resolve({ saveOk: true })),
    onClose: vi.fn(),
    onSeek: vi.fn(),
    videoController: {},
    onDeleteClip: vi.fn(),
    ...overrides,
  };
}

function findStageButton() {
  return screen.getAllByRole('button').find((b) => /Frame|Apply|View/.test(b.textContent));
}

describe('AnnotateFullscreenOverlay — stage CTA awaits pending writes, no confirm dialog (T10610 § C.4)', () => {
  it('strip layout: onAwaitWrites resolving false blocks navigation and shows no dialog', async () => {
    mockViewport(false);
    const onAwaitWrites = vi.fn(() => Promise.resolve(false));
    const onOpenInFocus = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onAwaitWrites, onOpenInFocus })}
        layout="strip"
      />
    );
    const stageButton = findStageButton();
    expect(stageButton).toBeTruthy();
    await fireEvent.click(stageButton);
    expect(onAwaitWrites).toHaveBeenCalledWith('c1');
    expect(onOpenInFocus).not.toHaveBeenCalled();
    expect(screen.queryByText(/Save this play first/i)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('strip layout: onAwaitWrites resolving true navigates normally', async () => {
    mockViewport(false);
    const onAwaitWrites = vi.fn(() => Promise.resolve(true));
    const onOpenInFocus = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onAwaitWrites, onOpenInFocus })}
        layout="strip"
      />
    );
    await fireEvent.click(findStageButton());
    expect(onAwaitWrites).toHaveBeenCalledWith('c1');
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });

  it('mobile inline layout: same stage CTA, false resolution blocks navigation with no dialog', async () => {
    mockViewport(true); // mobile
    const onAwaitWrites = vi.fn(() => Promise.resolve(false));
    const onOpenInFocus = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onAwaitWrites, onOpenInFocus })}
        layout="inline"
      />
    );
    const stageButton = findStageButton();
    expect(stageButton).toBeTruthy();
    await fireEvent.click(stageButton);
    expect(onAwaitWrites).toHaveBeenCalledWith('c1');
    expect(onOpenInFocus).not.toHaveBeenCalled();
    expect(screen.queryByText(/Save this play first/i)).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('mobile inline layout: onAwaitWrites resolving true navigates normally', async () => {
    mockViewport(true);
    const onAwaitWrites = vi.fn(() => Promise.resolve(true));
    const onOpenInFocus = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onAwaitWrites, onOpenInFocus })}
        layout="inline"
      />
    );
    await fireEvent.click(findStageButton());
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });

  it('the overlay-mode stage action (Spotlight) also awaits before navigating', async () => {
    mockViewport(false);
    useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: false, is_published: false }] });
    const onAwaitWrites = vi.fn(() => Promise.resolve(false));
    const onOpenInOverlay = vi.fn();
    const spotlightClip = { ...editClip, reelSourceStartTime: 0, reelSourceEndTime: 10 };
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ onAwaitWrites, onOpenInOverlay, existingClip: spotlightClip })}
        layout="strip"
      />
    );
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Spotlight' }));
    expect(onAwaitWrites).toHaveBeenCalledWith('c1');
    expect(onOpenInOverlay).not.toHaveBeenCalled();
    useProjectsStore.setState({ projects: [] });
  });
});

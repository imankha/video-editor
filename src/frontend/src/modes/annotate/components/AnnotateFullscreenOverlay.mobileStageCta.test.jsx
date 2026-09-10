import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T9330 (design §2.6): the MOBILE edit sheet (layout="inline") must carry the
// SAME stage-aware CTA as the desktop strip — Apply AI Focus / Apply Spotlight /
// View Final / View Published — so editing a clip-with-a-project on a phone has a
// path into Focus/Spotlight/the finished video. A live-verification gap found the
// mobile sheet only rendered Update/Cancel. Edit mode only: mobile CREATE still
// closes on save (Save/Cancel) and needs no stage CTA.

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
  onCreateClip: () => {},
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'sheet_mobile',
  layout: 'inline',
};

const editClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], notes: '',
  name: 'My cool play', my_athlete: true,
};

describe('AnnotateFullscreenOverlay mobile inline sheet — stage CTA (T9330 §2.6)', () => {
  it('edit mode with a fresh-draft project renders "Apply AI Focus" in the mobile sheet', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
      />
    );
    expect(screen.getByRole('button', { name: 'Apply AI Focus' })).toBeTruthy();
  });

  it('reflects the linked project stage (Spotlight) on mobile too', () => {
    useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: false, is_published: false }] });
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    expect(screen.queryByRole('button', { name: 'Apply AI Focus' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply Spotlight' })).toBeTruthy();
  });

  it('clicking the stage CTA with an untouched form navigates directly (onOpenInFocus)', () => {
    const onOpenInFocus = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
        onOpenInFocus={onOpenInFocus}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Apply AI Focus' }));
    expect(screen.queryByText('Save this play first?')).toBeNull();
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });

  it('dirty edit routes through the T8730 save-first dialog (rendered in the inline layout)', () => {
    const onOpenInFocus = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
        onOpenInFocus={onOpenInFocus}
      />
    );
    // Make the form dirty (rating 4 -> 5), then tap the CTA: must prompt, not navigate.
    fireEvent.click(screen.getByTitle('5 stars'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply AI Focus' }));
    expect(screen.getByText('Save this play first?')).toBeTruthy();
    expect(onOpenInFocus).not.toHaveBeenCalled();
  });

  it('create mode (no existing clip) shows NO stage CTA — just Save/Cancel', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={null} />);
    expect(screen.queryByRole('button', { name: 'Apply AI Focus' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Apply Spotlight|View Final|View Published/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });
});

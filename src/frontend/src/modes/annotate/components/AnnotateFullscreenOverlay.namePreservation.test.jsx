import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T9630 AC2: "a custom title can be replaced when notes change" (handoff N-item).
// The investigation found the auto-generate-name effect already gated on
// `!isNameManuallyEdited && !existingClip?.name` (T8140/T9330), which should
// already prevent this. These tests try to actually reproduce the bug rather
// than assume the guard works — they pin the guard's behavior as a regression
// test now that it's confirmed correct.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

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

describe('AnnotateFullscreenOverlay — a custom title survives editing notes (T9630 AC2)', () => {
  it('typing in Notes does not touch a custom clip name', () => {
    mockViewport(false);
    const customNamedClip = {
      id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: ['Goal'],
      my_athlete: true, name: 'My banger', notes: '',
    };
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={customNamedClip} />);
    // Open the details panel where Notes lives in the strip layout.
    fireEvent.click(screen.getByTestId('add-details-button'));
    fireEvent.change(screen.getByPlaceholderText('Add a note about this clip...'), {
      target: { value: 'Great run down the wing' },
    });
    // The header name (the strip's single name affordance) still reads the
    // untouched custom title.
    expect(screen.getByText('My banger')).toBeTruthy();
  });

  it('saving after a notes-only edit sends the ORIGINAL custom name, not a regenerated one', () => {
    mockViewport(false);
    const onUpdateClip = vi.fn(() => Promise.resolve(true));
    const customNamedClip = {
      id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: ['Goal'],
      my_athlete: true, name: 'My banger', notes: '',
    };
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={customNamedClip} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    fireEvent.change(screen.getByPlaceholderText('Add a note about this clip...'), {
      target: { value: 'Great run down the wing' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Update play' }));
    expect(onUpdateClip).toHaveBeenCalledWith('c1', expect.objectContaining({ name: 'My banger' }));
  });

  it('switching from an unnamed clip to a custom-named clip shows the NEW clip\'s own name (no stale bleed-through)', () => {
    mockViewport(false);
    const unnamedClip = {
      id: 'c1', startTime: 0, endTime: 10, rating: 3, tags: [], notes: 'some notes', my_athlete: true, name: '',
    };
    const customNamedClip = {
      id: 'c2', startTime: 20, endTime: 30, rating: 4, tags: [], notes: '', my_athlete: true, name: 'Custom title',
    };
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} existingClip={unnamedClip} />);
    rerender(<AnnotateFullscreenOverlay {...baseProps} existingClip={customNamedClip} />);
    expect(screen.getByText('Custom title')).toBeTruthy();
  });
});

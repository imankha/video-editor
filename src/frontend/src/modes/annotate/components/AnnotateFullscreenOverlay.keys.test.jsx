import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T8600 §2.6: Esc closes the details surface first, then the editor. 1-5 and
// Enter keep ignoring INPUT/TEXTAREA targets (unchanged), but Esc must be
// handled for typing targets too so it can close a note textarea inside the
// details surface without discarding the whole play.

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

beforeEach(() => mockViewport(false));

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
};

describe('AnnotateFullscreenOverlay — Esc layering (T8600)', () => {
  it('Esc closes the details panel first, leaving the editor open', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" onClose={onClose} />);
    fireEvent.click(screen.getByText('Add details'));
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a second Esc (details already closed) closes the editor', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc while typing in the Notes textarea closes details, not the editor', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" onClose={onClose} />);
    fireEvent.click(screen.getByText('Add details'));
    const notes = screen.getByLabelText('Notes (optional)');
    notes.focus();
    fireEvent.keyDown(notes, { key: 'Escape' });
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('AnnotateFullscreenOverlay — 1-5 and Enter ignore INPUT/TEXTAREA (unchanged)', () => {
  it('typing "1" in the clip name field does not change the rating', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    const nameInput = screen.getByLabelText('Clip name');
    fireEvent.keyDown(nameInput, { key: '1' });
    // Default rating notation for 4 stars is "!"; unaffected by the keypress.
    expect(screen.getByText('!')).toBeTruthy();
  });

  it('Enter (not typing) triggers Save', () => {
    const onCreateClip = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" onCreateClip={onCreateClip} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCreateClip).toHaveBeenCalledTimes(1);
  });
});

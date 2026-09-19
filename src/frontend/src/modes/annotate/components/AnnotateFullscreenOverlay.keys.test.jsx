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
  // T10580: details now defaults CLOSED on every layout (rating moved out to
  // its own always-visible badge, so there's no longer a reason to force it
  // open on desktop) — every test here opens it explicitly first.
  it('Esc closes the details panel first, leaving the editor open', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a second Esc (details already closed) closes the editor', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    // First Esc closes the (now-open) details panel; the second closes the editor.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Esc while typing in the Notes textarea closes details, not the editor', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" onClose={onClose} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
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
    // T8960: the name is a pencil button until clicked; open the inline input.
    fireEvent.click(screen.getByTitle('Rename clip'));
    const nameInput = screen.getByLabelText('Clip name');
    fireEvent.keyDown(nameInput, { key: '1' });
    // T10520: rating now lives in the rated badge's popup picker — open it
    // and confirm the default (4 stars · Good) is still checked, unaffected
    // by the keypress typed into the name field.
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
  });

  it('Enter (not typing) triggers Save', () => {
    const onCreateClip = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" onCreateClip={onCreateClip} />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onCreateClip).toHaveBeenCalledTimes(1);
  });
});

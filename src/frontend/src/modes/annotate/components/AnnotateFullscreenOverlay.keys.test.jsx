import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T8600 §2.6: Esc closes the details surface first, then the editor. 1-5 and
// Enter keep ignoring INPUT/TEXTAREA targets (unchanged), but Esc must be
// handled for typing targets too so it can close a note textarea inside the
// details surface without discarding the whole play.
//
// T10610: there is no more Save/handleSave, so "Enter (not typing) triggers
// Save" is retired (design doc § E row 7). Replaced by: Enter INSIDE the name
// input commits the name (routes through blur via the shared
// onTextFieldKeyDown); Enter with nothing focused does nothing. The 1-5
// digit-key shortcut STAYS and now PERSISTS {rating} (previously local state
// only) — added assertion for that.

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

const existingClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true,
  name: 'My cool play', notes: '', tagged_teammates: [],
};

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 30,
    videoDuration: 6000,
    existingClip,
    onUpdateClip: vi.fn(() => Promise.resolve({ saveOk: true })),
    onClose: vi.fn(),
    onSeek: () => {},
    videoController: {},
    onDeleteClip: () => {},
    ...overrides,
  };
}

describe('AnnotateFullscreenOverlay — Esc layering (T8600)', () => {
  // T10580: details now defaults CLOSED on every layout (rating moved out to
  // its own always-visible badge, so there's no longer a reason to force it
  // open on desktop) — every test here opens it explicitly first.
  it('Esc closes the details panel first, leaving the editor open', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onClose })} layout="strip" />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a second Esc (details already closed) closes the editor', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onClose })} layout="strip" />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    // First Esc closes the (now-open) details panel; the second closes the editor.
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // T10610 (binding constraint 8, the ONE Escape rule): Escape INSIDE a
  // focused text field is claimed by that field's own onTextFieldKeyDown —
  // it reverts the draft, blurs, and stops propagation, so it never reaches
  // this window-level handler. The details panel does NOT close on this
  // Escape (that would be a second, competing meaning for the same
  // keypress); a second, separate Escape with the field no longer focused
  // is what closes the details panel.
  it('Esc while typing in the Notes textarea reverts the field only -- it does not close details or the editor', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onClose })} layout="strip" />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    const notes = screen.getByLabelText('Notes (optional)');
    notes.focus();
    fireEvent.change(notes, { target: { value: 'Junk' } });
    fireEvent.keyDown(notes, { key: 'Escape' });
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
    expect(screen.getByLabelText('Notes (optional)').value).toBe('');
    expect(onClose).not.toHaveBeenCalled();
  });

  // T10590 (Reviewer BLOCKING): the rating picker's OWN Escape handler is on
  // `document` (RatingBadge has no `window`-level access), so without
  // stopPropagation the SAME keypress also reached this file's window-level
  // handler and discarded the whole editor. Dispatching from `document` (not
  // `window`, which every other test here uses and which SKIPS
  // document-level listeners entirely in jsdom) is required to reproduce it.
  it('Esc closes the rating picker only -- it does not also discard the editor', () => {
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onClose })} layout="strip" />);
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('AnnotateFullscreenOverlay — 1-5 and Enter ignore INPUT/TEXTAREA (unchanged)', () => {
  it('typing "1" in the clip name field does not change the rating', () => {
    render(<AnnotateFullscreenOverlay {...baseProps()} layout="strip" />);
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

  it('Enter with nothing focused does nothing (no crash, no write, no close)', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    const onClose = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, onClose })} layout="strip" />);
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onUpdateClip).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Enter INSIDE the name input commits the name via the shared blur-routing (one {name} write)', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="strip" />);
    fireEvent.click(screen.getByTitle('Rename clip'));
    const nameInput = screen.getByLabelText('Clip name');
    fireEvent.change(nameInput, { target: { value: 'Great tackle' } });
    fireEvent.keyDown(nameInput, { key: 'Enter' });
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { name: 'Great tackle' });
  });

  it('the 1-5 digit-key shortcut (nothing focused) persists {rating} via onUpdateClip', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="strip" />);
    fireEvent.keyDown(window, { key: '5' });
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { rating: 5 });
    // Visual state also reflects it.
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radio', { name: '5 stars - Brilliant' }).getAttribute('aria-checked')).toBe('true');
  });
});

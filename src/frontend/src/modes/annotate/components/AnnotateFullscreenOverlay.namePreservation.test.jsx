import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T9630 AC2 / T10610: this file used to pin an auto-generate-name effect that
// raced a manual notes edit (guarded by `isNameManuallyEdited`). That effect
// is DELETED entirely (design doc § E row 10) — name is now pure local-echo
// + commit-on-blur, nothing ever auto-populates it, so the race it guarded
// against cannot occur by construction.
//
// The structurally-true replacement: each field's commit handler is
// surgical — committing notes sends ONLY {notes} (never also {name}), and
// committing name sends ONLY {name} (never also {notes}). This is the
// per-gesture write contract (design doc § 2.2) doing the same job the old
// guard did, without needing a guard at all.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

const customNamedClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: ['Goal'],
  my_athlete: true, name: 'My banger', notes: '', tagged_teammates: [],
};

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 30,
    videoDuration: 6000,
    existingClip: customNamedClip,
    onUpdateClip: vi.fn(() => Promise.resolve({ saveOk: true })),
    onClose: () => {},
    onSeek: () => {},
    videoController: {},
    onDeleteClip: () => {},
    ...overrides,
  };
}

describe('AnnotateFullscreenOverlay — each text field commits surgically (T10610, replaces T9630 AC2)', () => {
  it('committing notes sends ONLY {notes} — never also {name}', () => {
    mockViewport(false);
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="strip" />);
    // T10580: the details panel (where Notes lives) defaults CLOSED — open it first.
    fireEvent.click(screen.getByTestId('add-details-button'));
    const notesField = screen.getByPlaceholderText('Add a note about this clip...');
    fireEvent.change(notesField, { target: { value: 'Great run down the wing' } });
    fireEvent.blur(notesField);
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { notes: 'Great run down the wing' });
  });

  it('the header name still reads the untouched custom title after a notes edit', () => {
    mockViewport(false);
    render(<AnnotateFullscreenOverlay {...baseProps()} layout="strip" />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    fireEvent.change(screen.getByPlaceholderText('Add a note about this clip...'), {
      target: { value: 'Great run down the wing' },
    });
    expect(screen.getByText('My banger')).toBeTruthy();
  });

  it('committing name sends ONLY {name} — never also {notes}', () => {
    mockViewport(false);
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip })} layout="overlay" />);
    const input = screen.getByDisplayValue('My banger');
    fireEvent.change(input, { target: { value: 'Renamed banger' } });
    fireEvent.blur(input);
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { name: 'Renamed banger' });
  });

  it('switching from an unnamed clip to a custom-named clip shows the NEW clip\'s own name (no stale bleed-through)', () => {
    mockViewport(false);
    const unnamedClip = {
      id: 'c1', startTime: 0, endTime: 10, rating: 3, tags: [], notes: 'some notes', my_athlete: true, name: '', tagged_teammates: [],
    };
    const otherCustomNamedClip = {
      id: 'c2', startTime: 20, endTime: 30, rating: 4, tags: [], notes: '', my_athlete: true, name: 'Custom title', tagged_teammates: [],
    };
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: unnamedClip })} layout="strip" />);
    rerender(<AnnotateFullscreenOverlay {...baseProps({ existingClip: otherCustomNamedClip })} layout="strip" />);
    expect(screen.getByText('Custom title')).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// The strip's own footer also has a "Cancel" button, so dialog assertions
// must scope to the dialog's own container (found via its title).
function dialogScope() {
  return within(screen.getByText('Save this play first?').closest('.bg-gray-800'));
}

// T8600 §2.8: Focus mid-edit must never silently discard the open form. The
// strip's Focus button (edit mode, existingClip.autoProjectId set) opens a
// confirm-then-save-then-navigate prompt with exactly two buttons (Q2:
// "Save & open Focus" + "Cancel", no third "Discard" button).
//
// T8730: the prompt now ONLY appears when there are real unsaved changes. The
// dirty-path suite below therefore edits a field first (dirtyEdit) so the
// dialog still fires; a separate not-dirty test asserts the direct-navigate path.

// Make the edit form dirty by typing a new clip name (flips isNameManuallyEdited
// so nameToSave diverges from the loaded clip's empty name).
function dirtyEdit() {
  fireEvent.change(screen.getByLabelText('Clip name'), { target: { value: 'Edited name' } });
}

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
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true, autoProjectId: 42,
};

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  existingClip,
  onCreateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'inline_desktop',
  layout: 'strip',
};

describe('AnnotateFullscreenOverlay — Focus mid-edit save-first prompt (T8600 §2.8, T8730 dirty path)', () => {
  it('with unsaved changes, clicking Focus opens a confirm prompt instead of navigating directly', () => {
    const onOpenInFocus = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={vi.fn()} onOpenInFocus={onOpenInFocus} />);
    dirtyEdit();
    fireEvent.click(screen.getByRole('button', { name: /focus/i }));
    expect(onOpenInFocus).not.toHaveBeenCalled();
    expect(screen.getByText('Save this play first?')).toBeTruthy();
  });

  it('exactly two buttons: "Save & open Focus" and "Cancel" (no Discard, Q2)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={vi.fn()} onOpenInFocus={vi.fn()} />);
    dirtyEdit();
    fireEvent.click(screen.getByRole('button', { name: /focus/i }));
    const dialog = dialogScope();
    expect(dialog.getByRole('button', { name: 'Save & open Focus' })).toBeTruthy();
    expect(dialog.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(dialog.getAllByRole('button')).toHaveLength(3); // header X + the two above
    expect(screen.queryByText(/discard/i)).toBeNull();
  });

  it('Cancel closes the prompt without saving or navigating', () => {
    const onUpdateClip = vi.fn();
    const onOpenInFocus = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={onUpdateClip} onOpenInFocus={onOpenInFocus} />);
    dirtyEdit();
    fireEvent.click(screen.getByRole('button', { name: /focus/i }));
    fireEvent.click(dialogScope().getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Save this play first?')).toBeNull();
    expect(onUpdateClip).not.toHaveBeenCalled();
    expect(onOpenInFocus).not.toHaveBeenCalled();
  });

  it('"Save & open Focus" saves first, then navigates with the reel id', async () => {
    const onUpdateClip = vi.fn(() => Promise.resolve());
    const onOpenInFocus = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={onUpdateClip} onOpenInFocus={onOpenInFocus} />);
    dirtyEdit();
    fireEvent.click(screen.getByRole('button', { name: /focus/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Save & open Focus' }));
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(onOpenInFocus).toHaveBeenCalledWith(42));
  });

  it('the dialog copy names Annotate, not "the play editor" (T8730 naming)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={vi.fn()} onOpenInFocus={vi.fn()} />);
    dirtyEdit();
    fireEvent.click(screen.getByRole('button', { name: /focus/i }));
    expect(screen.getByText('Opening Focus closes the Annotate editor.')).toBeTruthy();
    expect(screen.queryByText(/play editor/i)).toBeNull();
  });
});

describe('AnnotateFullscreenOverlay — Focus with no unsaved changes navigates directly (T8730)', () => {
  it('clicking Focus with an untouched form opens Focus with no dialog', () => {
    const onUpdateClip = vi.fn();
    const onOpenInFocus = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={onUpdateClip} onOpenInFocus={onOpenInFocus} />);
    // No edits — click Focus straight away.
    fireEvent.click(screen.getByRole('button', { name: /focus/i }));
    expect(screen.queryByText('Save this play first?')).toBeNull();
    expect(onUpdateClip).not.toHaveBeenCalled();
    expect(onOpenInFocus).toHaveBeenCalledWith(42);
  });

  it('a non-name edit (rating change) is also detected as dirty and shows the prompt', () => {
    const onOpenInFocus = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={vi.fn()} onOpenInFocus={onOpenInFocus} />);
    // Change the rating (4 -> 5): a genuine edit, so the prompt must appear.
    fireEvent.click(screen.getByTitle('5 stars'));
    fireEvent.click(screen.getByRole('button', { name: /focus/i }));
    expect(screen.getByText('Save this play first?')).toBeTruthy();
    expect(onOpenInFocus).not.toHaveBeenCalled();
  });
});

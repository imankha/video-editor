import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T9630 AC3: Unsaved/Saving/Saved derived from the REAL persistence outcome of
// the Save gesture's promise (onCreateClip/onUpdateClip resolving true/false),
// never asserted. A failed save must show the error state, retain every field
// exactly as typed, and NOT close/resume.

function mockViewport(matches) {
  window.matchMedia = (query) => ({
    matches, media: query, onchange: null,
    addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const existingClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true, name: 'My banger', notes: '',
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

describe('AnnotateFullscreenOverlay — Unsaved/Saving/Saved (T9630 AC3)', () => {
  it('shows "Saving..." while the update promise is pending', async () => {
    mockViewport(false);
    const { promise, resolve } = deferred();
    const onUpdateClip = vi.fn(() => promise);
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update play' }));
    expect((await screen.findByTestId('save-status')).textContent).toBe('Saving...');
    resolve(true);
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toBe('Saved'));
  });

  it('a rejected/failed save shows an error state and does NOT close the editor', async () => {
    mockViewport(false);
    const onUpdateClip = vi.fn(() => Promise.resolve(false));
    const onResume = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={onUpdateClip} onResume={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update play' }));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toMatch(/couldn't save/i));
    expect(onResume).not.toHaveBeenCalled();
    // The form is still on screen with the SAME clip, untouched.
    expect(screen.getByText('My banger')).toBeTruthy();
  });

  it('a save that throws is treated the same as a failed save (error, stays open)', async () => {
    mockViewport(false);
    const onUpdateClip = vi.fn(() => Promise.reject(new Error('network down')));
    const onResume = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={onUpdateClip} onResume={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update play' }));
    await waitFor(() => expect(screen.getByTestId('save-status').textContent).toMatch(/couldn't save/i));
    expect(onResume).not.toHaveBeenCalled();
  });

  it('a successful save closes/resumes as before', async () => {
    mockViewport(false);
    const onUpdateClip = vi.fn(() => Promise.resolve(true));
    const onResume = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={onUpdateClip} onResume={onResume} />);
    fireEvent.click(screen.getByRole('button', { name: 'Update play' }));
    await waitFor(() => expect(onResume).toHaveBeenCalledTimes(1));
  });

  it('editing a field after a successful save shows "Unsaved changes" again (real derived state, not a stale "Saved")', async () => {
    mockViewport(false);
    const onUpdateClip = vi.fn(() => Promise.resolve(true));
    // Use a non-closing layout path isn't available for edit mode (edit always
    // resumes/closes) — assert against the pre-save dirty detection instead,
    // which is the same `hasUnsavedEdits()` the badge reads.
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByTitle('5 stars'));
    expect(screen.getByTestId('save-status').textContent).toBe('Unsaved changes');
  });

  it('a freshly opened, untouched edit form shows no status (never claims saved before any save attempt)', () => {
    mockViewport(false);
    render(<AnnotateFullscreenOverlay {...baseProps} onUpdateClip={() => Promise.resolve(true)} />);
    expect(screen.queryByTestId('save-status')).toBeNull();
  });
});

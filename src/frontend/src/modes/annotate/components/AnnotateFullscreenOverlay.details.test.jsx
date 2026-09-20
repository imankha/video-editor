import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T8600 C1/C2: Tags + Notes move behind a "Details" disclosure.
// Desktop (layout='strip') expands in place; mobile (layout='inline',
// isMobile) opens a full-screen popup portaled to document.body. The
// disclosure label counts existing tags/notes so edit-mode users see there
// is hidden content.

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

beforeEach(() => mockViewport(false)); // desktop by default

const existingClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], notes: '',
  my_athlete: true, name: 'Play 1', tagged_teammates: [],
};

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  existingClip,
  onUpdateClip: () => Promise.resolve({ saveOk: true }),
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  onDeleteClip: () => {},
};

// T10580 relabelled the disclosure from "Rate and Tag" (stale once T10520 moved
// rating to its own always-visible badge) to "Notes and Tags"; T10620 relabelled
// it again to "Details" once category/teammates/Delete play moved behind it too,
// so "Notes and Tags" undersold what it held. It defaults CLOSED on every layout,
// not just mobile -- T10290's desktop-open-by-default existed only because
// rating used to live here and needed to be visible without an extra tap.
describe('AnnotateFullscreenOverlay — "Details" disclosure label (T8600/T10290/T10580/T10620)', () => {
  it('shows "Details" when there are no tags and no note', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    expect(screen.getByText('Details')).toBeTruthy();
  });

  it('counts tags and note presence in the label once selected', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ ...existingClip, tags: ['Goal', 'Assist'], notes: 'nice one' }}
      />
    );
    expect(screen.getByText(/Details \(2 tags, note\)/)).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — desktop expand-in-place (layout="strip")', () => {
  it('the details panel is CLOSED by default and expands on click, no popup (T10580)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    // Desktop panel is in-flow content, not a portaled dialog, and closed by default.
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
  });

  it('re-clicking the disclosure toggles the panel open and closed', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    const toggle = () => screen.getByText(/Details/);
    // Starts closed (T10580 default) -> click opens -> click re-closes.
    fireEvent.click(toggle());
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
    fireEvent.click(toggle());
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
  });
});

describe('AnnotateFullscreenOverlay — mobile full-screen popup (layout="inline", isMobile)', () => {
  beforeEach(() => mockViewport(true));

  it('is closed by default on mobile; tapping "Details" opens a full-screen popup with Tags + Notes', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" />);
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    fireEvent.click(screen.getByText('Details'));
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(dialog).toBeTruthy();
    expect(screen.getByPlaceholderText('Add a note about this clip...')).toBeTruthy();
  });

  it('the X button closes the popup without an extra write beyond a clean notes commit', () => {
    // Done was removed (it was a second button doing exactly what X does) —
    // X is now the popup's one dismissal control, per the no-backdrop-close rule.
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByText('Details'));
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(within(dialog).queryByRole('button', { name: 'Done' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'Details' })).toBeNull();
    // Notes was never touched, so closing -> commitNotes() is a no-op.
    expect(onUpdateClip).not.toHaveBeenCalled();
  });

  it('Notes is newly available on mobile via the popup (was desktop-only)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" />);
    fireEvent.click(screen.getByText('Details'));
    expect(screen.getByPlaceholderText('Add a note about this clip...')).toBeTruthy();
  });
});

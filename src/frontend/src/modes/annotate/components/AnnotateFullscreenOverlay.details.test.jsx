import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T8600 C1/C2: Tags + Notes move behind an "Add details" disclosure.
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

describe('AnnotateFullscreenOverlay — "Add details" disclosure label (T8600)', () => {
  it('shows "Add details" when there are no tags and no note', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    expect(screen.getByText('Add details')).toBeTruthy();
  });

  it('counts tags and note presence in the label once selected', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: ['Goal', 'Assist'], notes: 'nice one', my_athlete: true }}
      />
    );
    expect(screen.getByText(/Details \(2 tags, note\)/)).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — desktop expand-in-place (layout="strip")', () => {
  it('the details panel is closed by default and opens in place on click, no popup', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    expect(screen.queryByRole('dialog', { name: 'Add details' })).toBeNull();
    fireEvent.click(screen.getByText('Add details'));
    // Desktop panel is in-flow content, not a portaled dialog.
    expect(screen.queryByRole('dialog', { name: 'Add details' })).toBeNull();
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
  });

  it('re-clicking the disclosure collapses the panel (no separate Done/X)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    const toggle = () => screen.getByText(/Add details|Details/);
    fireEvent.click(toggle());
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
    fireEvent.click(toggle());
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
  });
});

describe('AnnotateFullscreenOverlay — mobile full-screen popup (layout="inline", isMobile)', () => {
  beforeEach(() => mockViewport(true));

  it('tapping "Add details" opens a full-screen popup with Tags + Notes', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" />);
    fireEvent.click(screen.getByText('Add details'));
    const dialog = screen.getByRole('dialog', { name: 'Add details' });
    expect(dialog).toBeTruthy();
    expect(screen.getByPlaceholderText('Add a note about this clip...')).toBeTruthy();
  });

  it('Done closes the popup without saving', () => {
    const onCreateClip = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" onCreateClip={onCreateClip} />);
    fireEvent.click(screen.getByText('Add details'));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Add details' })).toBeNull();
    expect(onCreateClip).not.toHaveBeenCalled();
  });

  it('Notes is newly available on mobile via the popup (was desktop-only)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" />);
    fireEvent.click(screen.getByText('Add details'));
    expect(screen.getByPlaceholderText('Add a note about this clip...')).toBeTruthy();
  });
});

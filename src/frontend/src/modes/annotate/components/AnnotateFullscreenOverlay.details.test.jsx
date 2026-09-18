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

// T10290: the disclosure is labelled "Rate and Tag" (2026-09-18, was "Details"
// -- dropped the "Add" prefix before that), open by default on desktop (>= md)
// and closed on mobile.
describe('AnnotateFullscreenOverlay — "Rate and Tag" disclosure label (T8600/T10290)', () => {
  it('shows "Rate and Tag" when there are no tags and no note', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    expect(screen.getByText('Rate and Tag')).toBeTruthy();
  });

  it('counts tags and note presence in the label once selected', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: ['Goal', 'Assist'], notes: 'nice one', my_athlete: true }}
      />
    );
    expect(screen.getByText(/Rate and Tag \(2 tags, note\)/)).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — desktop expand-in-place (layout="strip")', () => {
  it('the details panel is OPEN by default on desktop and collapses on click, no popup (T10290)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    // Desktop panel is in-flow content, not a portaled dialog, and open by default.
    expect(screen.queryByRole('dialog', { name: 'Rate and Tag' })).toBeNull();
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
    fireEvent.click(screen.getByText('Rate and Tag'));
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
  });

  it('re-clicking the disclosure re-opens the panel (no separate Done/X)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    const toggle = () => screen.getByText(/Rate and Tag/);
    // Starts open (desktop default) -> click collapses -> click re-opens.
    fireEvent.click(toggle());
    expect(screen.queryByLabelText('Notes (optional)')).toBeNull();
    fireEvent.click(toggle());
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay — mobile full-screen popup (layout="inline", isMobile)', () => {
  beforeEach(() => mockViewport(true));

  it('is closed by default on mobile; tapping "Rate and Tag" opens a full-screen popup with Tags + Notes', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" />);
    expect(screen.queryByRole('dialog', { name: 'Rate and Tag' })).toBeNull();
    fireEvent.click(screen.getByText('Rate and Tag'));
    const dialog = screen.getByRole('dialog', { name: 'Rate and Tag' });
    expect(dialog).toBeTruthy();
    expect(screen.getByPlaceholderText('Add a note about this clip...')).toBeTruthy();
  });

  it('Done closes the popup without saving', () => {
    const onCreateClip = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" onCreateClip={onCreateClip} />);
    fireEvent.click(screen.getByText('Rate and Tag'));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: 'Rate and Tag' })).toBeNull();
    expect(onCreateClip).not.toHaveBeenCalled();
  });

  it('Notes is newly available on mobile via the popup (was desktop-only)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" />);
    fireEvent.click(screen.getByText('Rate and Tag'));
    expect(screen.getByPlaceholderText('Add a note about this clip...')).toBeTruthy();
  });
});

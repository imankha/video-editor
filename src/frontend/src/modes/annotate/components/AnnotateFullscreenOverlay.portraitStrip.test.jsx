import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T10620: mobile PORTRAIT editor is an IN-FLOW compact strip
// (layout="portrait-strip"), NOT the old fixed max-h-[85vh] bottom sheet. The
// video the trim handles refer to stays visible above it. This suite pins:
//   - no fixed / max-h-[85vh] wrapper in the strip's own render path
//   - strip row 2: Done + disclosure NEVER shrink (flex-none); the name input
//     absorbs the squeeze (flex-1 min-w-0) — the artifact's clipped-button bug
//   - category, teammates and Delete play are reachable behind the disclosure
//   - no Save/Update button anywhere (T10610 contract still holds)

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

beforeEach(() => mockViewport(true)); // portrait phone — coarse pointer + narrow
afterEach(() => {
  cleanup();
  useProjectsStore.setState({ projects: [] });
});

const editClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], notes: '',
  name: 'My cool play', my_athlete: true, tagged_teammates: [],
};

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onUpdateClip: () => Promise.resolve({ saveOk: true }),
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  onDeleteClip: () => {},
  layout: 'portrait-strip',
};

describe('AnnotateFullscreenOverlay portrait-strip — in-flow, no bottom sheet', () => {
  it('renders the strip with NO fixed / max-h-[85vh] wrapper (it is in flow)', () => {
    const { container } = render(
      <AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} />
    );
    expect(screen.getByTestId('annotate-portrait-strip')).toBeTruthy();
    // The retired sheet was `fixed ... max-h-[85vh]`; the strip is a plain
    // border-t row. Details is closed, so no portaled popup exists yet either.
    expect(container.querySelector('.fixed')).toBeNull();
    expect(container.innerHTML).not.toContain('85vh');
  });

  it('renders NO Save/Update button (T10610 contract) — Done is the only chrome close', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} />);
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /update/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay portrait-strip — row 2 shrink priority', () => {
  it('Done and the disclosure button carry flex-none + whitespace-nowrap; they never shrink', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} />);
    const done = screen.getByRole('button', { name: 'Done' });
    const disclosure = screen.getByTestId('add-details-button');
    expect(done.className).toMatch(/flex-none/);
    expect(done.className).toMatch(/whitespace-nowrap/);
    expect(disclosure.className).toMatch(/flex-none/);
    expect(disclosure.className).toMatch(/whitespace-nowrap/);
  });

  it('the name input absorbs the squeeze (flex-1 min-w-0) even with a long name', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, name: 'An extremely long clip name that would otherwise push the buttons off screen' }}
      />
    );
    const input = screen.getByLabelText('Clip name');
    expect(input.className).toMatch(/flex-1/);
    expect(input.className).toMatch(/min-w-0/);
    // The two buttons are still present (not clipped out of the tree).
    expect(screen.getByRole('button', { name: 'Done' })).toBeTruthy();
    expect(screen.getByTestId('add-details-button')).toBeTruthy();
  });

  it('the name input commits on blur via onUpdateClip({name}) — same per-gesture write', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} onUpdateClip={onUpdateClip} />);
    const input = screen.getByLabelText('Clip name');
    fireEvent.change(input, { target: { value: 'Renamed' } });
    fireEvent.blur(input);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { name: 'Renamed' });
  });
});

describe('AnnotateFullscreenOverlay portrait-strip — moved fields live behind the disclosure', () => {
  it('opens a full-screen popup carrying category, tags, notes, and Delete play', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    // Category (My athlete / Team)
    expect(within(dialog).getByText('Play category')).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'My athlete' })).toBeTruthy();
    expect(within(dialog).getByRole('radio', { name: 'Team' })).toBeTruthy();
    // Tags + Notes (shared DetailsFields)
    expect(within(dialog).getByPlaceholderText('Add a note about this clip...')).toBeTruthy();
    // Delete play
    expect(within(dialog).getByRole('button', { name: /delete play/i })).toBeTruthy();
  });

  it('reveals Teammates in the popup only on the Team layer', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, my_athlete: false }}
      />
    );
    fireEvent.click(screen.getByTestId('add-details-button'));
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(within(dialog).getByText('Teammates')).toBeTruthy();
  });

  it('a My-athlete clip hides Teammates in the popup', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    expect(within(dialog).queryByText('Teammates')).toBeNull();
  });

  it('Delete play in the popup fires onDeleteClip with the clip id (after confirm)', () => {
    const onDeleteClip = vi.fn();
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} onDeleteClip={onDeleteClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    // DeletePlayButton is a two-step confirm (shared control, T10610 § D.1).
    fireEvent.click(within(dialog).getByRole('button', { name: /delete play/i }));
    fireEvent.click(within(dialog).getByRole('button', { name: /confirm delete/i }));
    expect(onDeleteClip).toHaveBeenCalledWith('c1');
  });

  it('category tap in the popup persists via onUpdateClip({my_athlete}) — a per-gesture write', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    const dialog = screen.getByRole('dialog', { name: 'Details' });
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Team' }));
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: false });
  });
});

describe('AnnotateFullscreenOverlay portrait-strip — stage CTA', () => {
  it('renders the full-width stage CTA below the strip when the clip has a project', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: null, reelSourceEndTime: null }}
      />
    );
    const cta = screen.getByRole('button', { name: 'Frame' });
    expect(cta.className).toMatch(/w-full/);
  });

  it('renders NO stage CTA for a project-less play', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} existingClip={editClip} />);
    expect(screen.queryByRole('button', { name: 'Frame' })).toBeNull();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T8960: desktop strip (layout="strip") layout-feedback rework —
//  - item 2: name is the FIRST control, default + pencil, renames inline
//  - item 5: My Athlete | Team layer control on header row 1
//  - item 6: details panel has no inner scroll
//
// T10610: there is no create mode left (design doc § E row 9), so the old
// "create mode shows a default name" / "centers the Marking a play title"
// tests (item 3/4, and the retired "one create outcome" Save-button block)
// are removed entirely. The name+pencil inline-edit affordance is genuine
// edit-mode behavior and stays.
//
// The strip's redundant centered "Edit play" header row (T9330) was removed
// per user feedback — the play name row above it already identifies what's
// being edited, so this file's row-2 header no longer renders on the strip
// layout.

beforeEach(() => {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
});

afterEach(() => {
  cleanup();
  useProjectsStore.setState({ projects: [] });
});

const baseProps = {
  isVisible: true,
  currentTime: 30,
  videoDuration: 6000,
  onUpdateClip: () => Promise.resolve({ saveOk: true }),
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  onDeleteClip: () => {},
};

const editClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true,
  name: 'My cool play', notes: '', tagged_teammates: [],
};

describe('AnnotateFullscreenOverlay strip — name-first header, no redundant title (T8960 items 2+3, T10610)', () => {
  it('does not render a separate "Edit play"/"Marking a play" title row — the name row is the only header', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} />);
    expect(screen.queryByText('Edit play')).toBeNull();
    expect(screen.queryByText('Marking a play')).toBeNull();
    expect(screen.getByText('My cool play')).toBeTruthy();
  });

  it('shows the clip name behind a pencil affordance (no inline input yet)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} />);
    expect(screen.getByText('My cool play')).toBeTruthy();
    expect(screen.getByTitle('Rename clip')).toBeTruthy();
    expect(screen.queryByLabelText('Clip name')).toBeNull();
  });

  it('clicking the pencil opens an inline name input, seeded with the stored value', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} />);
    fireEvent.click(screen.getByTitle('Rename clip'));
    const input = screen.getByLabelText('Clip name');
    expect(input).toBeTruthy();
    expect(input.value).toBe('My cool play');
  });

  it('Enter commits the rename via onUpdateClip({name}) and closes the inline input', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByTitle('Rename clip'));
    const input = screen.getByLabelText('Clip name');
    fireEvent.change(input, { target: { value: 'Banger' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { name: 'Banger' });
    // Enter routes through blur, which also closes the inline input (the
    // header falls back to displaying existingClip.name, unchanged here
    // since this is a fire-and-forget onUpdateClip mock with no parent
    // re-render feeding the new name back down).
    expect(screen.queryByLabelText('Clip name')).toBeNull();
  });

  it('blur also commits the rename via onUpdateClip({name})', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByTitle('Rename clip'));
    const input = screen.getByLabelText('Clip name');
    fireEvent.change(input, { target: { value: 'Great tackle' } });
    fireEvent.blur(input);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { name: 'Great tackle' });
  });

  // Regression guard: onTextFieldKeyDown's Escape branch mutates the DOM
  // node's .value synchronously (in addition to calling draftSetter), and
  // commitName reads e.target.value when a blur event is available — so the
  // nested blur() call inside the SAME keydown handler (which fires
  // commitName before React has flushed the revert's setState) still sees
  // the reverted value, not the stale pre-revert one. Was a real bug found
  // during T10610 review: the strip's onBlur wrapper (`() => { commitName();
  // ... }`) called commitName with no event, and commitName's old
  // state-only read raced React's batching. See
  // AnnotateFullscreenOverlay.noSaveButton.test.jsx's equivalent formBody +
  // strip Escape tests (both real-focused, both now no-op).
  it('Escape reverts the inline name editor and writes nothing (does not race the nested blur)', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} onUpdateClip={onUpdateClip} />);
    fireEvent.click(screen.getByTitle('Rename clip'));
    const input = screen.getByLabelText('Clip name');
    // Real DOM focus — Escape's e.currentTarget.blur() is a spec no-op on a
    // non-focused element, which would mask this exact race.
    input.focus();
    fireEvent.change(input, { target: { value: 'Junk' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onUpdateClip).not.toHaveBeenCalled();
  });
});

describe('AnnotateFullscreenOverlay strip — layer control on the top line (T8960 item 5)', () => {
  it('renders the My Athlete | Team control (header row 1)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...editClip, my_athlete: false }} />);
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('AnnotateFullscreenOverlay strip — details panel has no inner scroll (T8960 item 6)', () => {
  it('the opened details panel is not an overflow-y-auto / max-h-64 scroll box', () => {
    // T10580: details defaults CLOSED on every layout now (rating moved out
    // to its own always-visible badge) -- open it first.
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} />);
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
    expect(container.querySelector('.overflow-y-auto')).toBeNull();
    expect(container.querySelector('.max-h-64')).toBeNull();
  });
});

// T9330 §3.5: the strip's stage CTA row is a FULL-WIDTH primary button driven
// by getClipStage — no longer a small right-anchored chip that always says
// "Framing" regardless of stage.
describe('AnnotateFullscreenOverlay strip — full-width stage-aware primary CTA (T9330)', () => {
  it('renders the stage CTA full-width, not a small right-anchored chip', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    const cta = screen.getByRole('button', { name: 'Frame' });
    expect(cta.className).toMatch(/w-full/);
    // Regression (2026-09-18 user request): rollover explaining what Framing
    // does, using the already-approved Clips-tab copy (T10280).
    expect(cta.title).toBe(
      'Framing focuses the camera on your player and lets you trim and add slo-mo to key moments.'
    );
  });

  it('reflects the linked project stage (Spotlight), not a hardcoded "Framing" label', () => {
    // linkedProject is looked up via useProjectsList (matching ClipDetailsEditor),
    // so seed the store rather than passing a prop.
    useProjectsStore.setState({ projects: [{ id: 42, has_working_video: true, has_final_video: false, is_published: false }] });
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    expect(screen.queryByRole('button', { name: 'Frame' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply Spotlight' })).toBeTruthy();
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T8960: desktop strip (layout="strip") layout-feedback rework —
//  - item 2: name is the FIRST control, default + pencil, renames inline (both modes)
//  - item 3: "+ Adding new play" is a centered title row (create mode only)
//  - item 4: create-mode "Clip" toggle-button with stateful copy
//  - item 5: My Athlete | Team layer control on header row 1
//  - item 6: details panel has no inner scroll
//  - item 7: edit-mode button reads "Clip Play"

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
  onCreateClip: () => {},
  onUpdateClip: () => {},
  onResume: () => {},
  onClose: () => {},
  onSeek: () => {},
  videoController: {},
  surface: 'inline_desktop',
};

const editClip = { id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: true, name: 'My cool play' };

describe('AnnotateFullscreenOverlay strip — name-first header (T8960 items 2+3)', () => {
  it('create mode shows a default name behind a pencil (no inline input yet)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" nextClipNumber={7} />);
    const rename = screen.getByTitle('Rename clip');
    // The default "Play N" name is shown (auto-gen may override, but the pencil affordance is present).
    expect(rename).toBeTruthy();
    // Not an input until clicked.
    expect(screen.queryByLabelText('Clip name')).toBeNull();
  });

  it('clicking the pencil opens an inline name input (create mode)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    fireEvent.click(screen.getByTitle('Rename clip'));
    const input = screen.getByLabelText('Clip name');
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Banger' } });
    expect(input.value).toBe('Banger');
  });

  it('centers the "Marking a play" title on its own row in create mode', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    expect(screen.getByText('Marking a play')).toBeTruthy();
  });

  it('edit mode shows the clip name behind the pencil and NO "Marking a play" title', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} />);
    expect(screen.getByText('My cool play')).toBeTruthy();
    expect(screen.queryByText('Marking a play')).toBeNull();
  });
});

describe('AnnotateFullscreenOverlay strip — layer control on the top line (T8960 item 5)', () => {
  it('renders the My Athlete | Team control (header row 1)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" newClipLayerIsMine={false} />);
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });
});

// T9830: the create-mode "Clip" toggle is replaced by two always-visible,
// always-enabled Save outcomes — "Create an editable clip" and "Save play". The
// primary action never switches on rating or a prior toggle.
describe('AnnotateFullscreenOverlay strip — two explicit create outcomes (T9830)', () => {
  it('create mode shows both outcome buttons, enabled, with NO toggle', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" newClipLayerIsMine={true} />);
    expect(screen.getByRole('button', { name: 'Create an editable clip' }).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Save play' }).disabled).toBe(false);
    // The old toggle off-state label is gone.
    expect(screen.queryByText('Just save this play')).toBeNull();
  });

  it('never shows a double-negative label, and drops the stale reel tooltip (T9450)', () => {
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" newClipLayerIsMine={true} />);
    expect(screen.queryByText("Don't Clip Play")).toBeNull();
    expect(container.querySelector('[title="Auto-create a reel from this play"]')).toBeNull();
  });

  it('a 5-star My Athlete moment shows the SAME two buttons (no rating-driven default)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" newClipLayerIsMine={true} />);
    fireEvent.keyDown(window, { key: '5' }); // rating shortcut — no inline stars to click
    expect(screen.getByRole('button', { name: 'Create an editable clip' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save play' })).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay strip — edit-mode "Create clip" button (T8960 item 7, T9520 N09)', () => {
  it('reads "Create clip" (no "Clip Out Play"/"Clip Play") when the clip has no reel yet', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} />);
    expect(screen.getByText('Create clip')).toBeTruthy();
    expect(screen.queryByText('Clip Out Play')).toBeNull();
    expect(screen.queryByText('Clip Play')).toBeNull();
  });
});

describe('AnnotateFullscreenOverlay strip — details panel has no inner scroll (T8960 item 6)', () => {
  it('the opened details panel is not an overflow-y-auto / max-h-64 scroll box', () => {
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    fireEvent.click(screen.getByText('Add details'));
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy();
    expect(container.querySelector('.overflow-y-auto')).toBeNull();
    expect(container.querySelector('.max-h-64')).toBeNull();
  });
});

// T9330 §3.5: the strip's stage CTA row (L917-940) is replaced with a
// FULL-WIDTH primary button driven by getClipStage — no longer a small
// right-anchored chip that always says "Framing" regardless of stage.
describe('AnnotateFullscreenOverlay strip — full-width stage-aware primary CTA (T9330)', () => {
  it('renders the stage CTA full-width, not a small right-anchored chip', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ ...editClip, autoProjectId: 42, reelSourceStartTime: 0, reelSourceEndTime: 10 }}
      />
    );
    const cta = screen.getByRole('button', { name: 'Frame this clip' });
    expect(cta.className).toMatch(/w-full/);
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
    expect(screen.queryByRole('button', { name: 'Frame this clip' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Apply Spotlight' })).toBeTruthy();
  });
});

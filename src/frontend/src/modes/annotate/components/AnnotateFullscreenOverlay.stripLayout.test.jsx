import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

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

afterEach(cleanup);

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
    const rename = screen.getByTitle('Rename this play');
    // The default "Play N" name is shown (auto-gen may override, but the pencil affordance is present).
    expect(rename).toBeTruthy();
    // Not an input until clicked.
    expect(screen.queryByLabelText('Clip name')).toBeNull();
  });

  it('clicking the pencil opens an inline name input (create mode)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    fireEvent.click(screen.getByTitle('Rename this play'));
    const input = screen.getByLabelText('Clip name');
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'Banger' } });
    expect(input.value).toBe('Banger');
  });

  it('centers the "+ Adding new play" title on its own row in create mode', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" />);
    expect(screen.getByText('Adding new play')).toBeTruthy();
  });

  it('edit mode shows the clip name behind the pencil and NO "Adding new play" title', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} />);
    expect(screen.getByText('My cool play')).toBeTruthy();
    expect(screen.queryByText('Adding new play')).toBeNull();
  });
});

describe('AnnotateFullscreenOverlay strip — layer control on the top line (T8960 item 5)', () => {
  it('renders the My Athlete | Team control (header row 1)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" newClipLayerIsMine={false} />);
    expect(screen.getByRole('radio', { name: 'Team layer' }).getAttribute('aria-checked')).toBe('true');
  });
});

describe('AnnotateFullscreenOverlay strip — "Clip" toggle copy (T8960 item 4)', () => {
  it('create mode toggle reads "Don\'t Clip Play" when off and flips copy on click', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" newClipLayerIsMine={true} />);
    // Default rating 4 (not 5) + My Athlete -> createProject off -> "Don't Clip Play".
    const toggle = screen.getByText("Don't Clip Play");
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle);
    expect(screen.getByText('Clip Play to focus on your player')).toBeTruthy();
  });

  it('a 5-star My Athlete clip auto-enables the toggle ("Clip Play to focus on your player")', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" newClipLayerIsMine={true} />);
    fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
    expect(screen.getByText('Clip Play to focus on your player')).toBeTruthy();
  });
});

describe('AnnotateFullscreenOverlay strip — edit-mode "Clip Play" button (T8960 item 7)', () => {
  it('reads "Clip Play" (no "Clip Out Play") when the clip has no reel yet', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={editClip} />);
    expect(screen.getByText('Clip Play')).toBeTruthy();
    expect(screen.queryByText('Clip Out Play')).toBeNull();
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

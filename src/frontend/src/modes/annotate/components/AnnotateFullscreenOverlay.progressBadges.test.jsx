import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { useProjectsStore } from '../../../stores/projectsStore';

// T10410: play-progress badges (rated / named / note / clip) on the desktop
// strip's header line and above the formBody footer, replacing the strip's
// loose "Clip created" text. Option C of the 2026-09-18 decision artifact.

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

// A saved play at the default rating, backend-derived name, no note, no clip.
const bareClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: ['Goal'], my_athlete: true,
  name: 'Good Goal', hasCustomName: false, notes: '', autoProjectId: null,
};

const badge = (id) => screen.getByTestId(id);

describe('strip header badges — states', () => {
  it('a bare play shows all three undone and the clip badge dormant', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    expect(badge('badge-rated').dataset.state).toBe('undone');
    expect(badge('badge-named').dataset.state).toBe('undone');
    expect(badge('badge-noted').dataset.state).toBe('undone');
    expect(badge('badge-clip').dataset.state).toBe('dormant');
    // The old loose status text is gone from the action row.
    expect(screen.queryByText('Clip created')).toBeNull();
  });

  it('a fully done play shows four done badges and the clip badge reads "Clip created"', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ ...bareClip, rating: 5, name: "Ava's header", hasCustomName: true, notes: 'what a run', autoProjectId: 42 }}
      />,
    );
    expect(badge('badge-rated').dataset.state).toBe('done');
    expect(badge('badge-named').dataset.state).toBe('done');
    expect(badge('badge-noted').dataset.state).toBe('done');
    expect(badge('badge-clip').dataset.state).toBe('done');
    expect(screen.getByText('Clip created')).toBeTruthy();
  });

  it('a one-tap "Play N" name is not "named" even though it is stored', () => {
    render(
      <AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, name: 'Play 3', hasCustomName: true }} />,
    );
    expect(badge('badge-named').dataset.state).toBe('undone');
  });

  it('rating a play 5 stars wakes the clip badge into the "Create clip" nudge', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(screen.getByTitle('5 stars'));
    expect(badge('badge-rated').dataset.state).toBe('done');
    expect(badge('badge-clip').dataset.state).toBe('nudge');
    expect(screen.getByText('Create clip')).toBeTruthy();
  });

  it('shows the clip badge pending while the parent reports the create in flight', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} focusPending />);
    expect(badge('badge-clip').dataset.state).toBe('pending');
  });
});

describe('strip header badges — clicks jump to the control', () => {
  it('the name badge opens the inline rename input', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    expect(screen.queryByLabelText('Clip name')).toBeNull();
    fireEvent.click(badge('badge-named'));
    expect(screen.getByLabelText('Clip name')).toBeTruthy();
  });

  it('typing a name flips the name badge to done', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(badge('badge-named'));
    fireEvent.change(screen.getByLabelText('Clip name'), { target: { value: 'Banger' } });
    expect(badge('badge-named').dataset.state).toBe('done');
  });

  it('the clip nudge sends the same partial createProject update as Frame clip and stays open', async () => {
    const onUpdateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 7 });
    const onResume = vi.fn();
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        existingClip={{ ...bareClip, rating: 5 }}
        onUpdateClip={onUpdateClip}
        onResume={onResume}
      />,
    );
    fireEvent.click(badge('badge-clip'));
    await waitFor(() => expect(onUpdateClip).toHaveBeenCalledWith('c1', { createProject: true }));
    // A partial update, not a full save: the editor does not close.
    expect(onResume).not.toHaveBeenCalled();
  });

  it('a done badge is not a button', () => {
    render(
      <AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, autoProjectId: 42 }} />,
    );
    expect(badge('badge-clip').tagName).toBe('SPAN');
  });
});

describe('formBody layouts', () => {
  it('the inline layout renders the badges above the footer buttons', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" existingClip={bareClip} />);
    expect(screen.getByTestId('play-progress-badges')).toBeTruthy();
    expect(badge('badge-clip').dataset.state).toBe('dormant');
  });

  it('create mode: the 5-star nudge saves the play AND creates the clip in one gesture', async () => {
    const onCreateClip = vi.fn().mockResolvedValue({ saveOk: true, projectId: 9 });
    render(<AnnotateFullscreenOverlay {...baseProps} layout="inline" onCreateClip={onCreateClip} />);
    fireEvent.click(screen.getByTitle('5 stars'));
    expect(badge('badge-clip').dataset.state).toBe('nudge');
    fireEvent.click(badge('badge-clip'));
    await waitFor(() => expect(onCreateClip).toHaveBeenCalled());
    expect(onCreateClip.mock.calls[0][0].createProject).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
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
  it('an edit-mode play is ALWAYS rated, even at a plain value; named/noted still undone', () => {
    // T10520: rated no longer compares against a "default" — edit mode means
    // a real rating is on record, period, whatever the value.
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    expect(badge('badge-rated').dataset.state).toBe('done');
    expect(badge('badge-named').dataset.state).toBe('undone');
    expect(badge('badge-noted').dataset.state).toBe('undone');
    expect(badge('badge-clip').dataset.state).toBe('dormant');
    // The old loose status text is gone from the action row.
    expect(screen.queryByText('Clip created')).toBeNull();
  });

  it('a fresh CREATE-mode play is NOT rated until the rating control is touched', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={null} />);
    expect(badge('badge-rated').dataset.state).toBe('undone');
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '4 stars - Good' })); // the untouched-looking default value
    expect(badge('badge-rated').dataset.state).toBe('done');
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
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Brilliant' }));
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
  it('renders named before rated, note, then clip (named sits right after the play name)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    const ids = screen.getAllByTestId(/^badge-/).map((el) => el.dataset.testid);
    expect(ids).toEqual(['badge-named', 'badge-rated', 'badge-noted', 'badge-clip']);
  });

  it('the name badge opens the inline rename input', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    expect(screen.queryByLabelText('Clip name')).toBeNull();
    fireEvent.click(badge('badge-named'));
    expect(screen.getByLabelText('Clip name')).toBeTruthy();
  });

  it('clicking the rated badge opens a popup box with all five ratings, best-first', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeNull();
    fireEvent.click(badge('badge-rated'));
    const group = screen.getByRole('radiogroup', { name: "Rate your athlete's play" });
    expect(group).toBeTruthy();
    // The popup is a SEPARATE element from the badge itself (T10520 round 3 —
    // not an in-place expansion of the badge, a floating box anchored to it).
    expect(group.closest('[data-testid="rating-picker"]')).toBeTruthy();
    expect(badge('badge-rated')).toBeTruthy();
    // 5 is listed first (best-first, top of the box), down to 1.
    // Scoped to the group -- the Layer segmented control also uses role="radio".
    const options = within(group).getAllByRole('radio');
    expect(options.map((o) => o.getAttribute('aria-label'))).toEqual([
      '5 stars - Brilliant', '4 stars - Good', '3 stars - Interesting',
      '2 stars - Technical Lapse', '1 star - Mental Lapse',
    ]);
  });

  it('picking a star sets the rating and closes the popup', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Brilliant' }));
    expect(badge('badge-rated').dataset.state).toBe('done');
    expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeNull();
    // The clip nudge wakes at 5 stars.
    expect(badge('badge-clip').dataset.state).toBe('nudge');
  });

  it('the done badge shows the rating\'s own chess notation, not a generic star (T10530)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 1 }} />);
    expect(badge('badge-rated').textContent).toBe('??');
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '3 stars - Interesting' }));
    expect(badge('badge-rated').textContent).toBe('!?');
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Brilliant' }));
    expect(badge('badge-rated').textContent).toBe('!!');
  });

  it('each row in the popup also shows its own chess notation (T10550)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(badge('badge-rated'));
    const group = screen.getByRole('radiogroup', { name: "Rate your athlete's play" });
    const rows = within(group).getAllByRole('radio');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Brilliant!!', 'Good!', 'Interesting!?', 'Technical Lapse?', 'Mental Lapse??',
    ]);
  });

  it('the popup heading is layer-aware: "your athlete\'s" vs "your team\'s"', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, my_athlete: true }} />);
    fireEvent.click(badge('badge-rated'));
    expect(screen.getByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Brilliant' })); // picking a row closes the popup

    fireEvent.click(screen.getByRole('radio', { name: 'Team' })); // flip the layer toggle
    fireEvent.click(badge('badge-rated'));
    expect(screen.getByRole('radiogroup', { name: "Rate your team's play" })).toBeTruthy();
  });

  it('T10590 (Reviewer): a REAL clip switch closes the popup rather than silently relabeling it', () => {
    // PlayProgressBadges is keyed on clip id specifically so an open popup
    // doesn't survive onto a DIFFERENT play with a stale heading/selection.
    const { rerender } = render(
      <AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, my_athlete: true }} />,
    );
    fireEvent.click(badge('badge-rated'));
    expect(screen.getByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();

    rerender(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, id: 'c2', my_athlete: false }} />);
    // Scoped by testid, not role="radiogroup" -- the Layer segmented control
    // ("Play category") is also a radiogroup and stays mounted throughout.
    expect(screen.queryByTestId('rating-picker')).toBeNull();
  });

  it('an outside click (desktop) closes the popup', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(badge('badge-rated'));
    expect(screen.getByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeNull();
  });

  // T10590 (Reviewer): mobile is now driven by the editor's own `isMobile`
  // (threaded down), not a CSS breakpoint, and backdrop-tap no longer closes
  // the sheet (project rule: no backdrop-close) -- an explicit X does.
  describe('mobile bottom sheet', () => {
    beforeEach(() => {
      window.matchMedia = (query) => ({
        matches: true,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      });
    });

    it('the X closes the sheet; tapping the dimmed backdrop does not', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
      fireEvent.click(badge('badge-rated'));
      const group = screen.getByRole('radiogroup', { name: "Rate your athlete's play" });
      expect(group).toBeTruthy();
      const backdrop = screen.getByRole('presentation');
      fireEvent.click(backdrop);
      expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByRole('radiogroup', { name: "Rate your athlete's play" })).toBeNull();
    });
  });

  it('the rated badge stays clickable once done, so the rating can be set again and again (T10520)', () => {
    // Edit mode: rated is already 'done' from the first render (any real
    // rating counts, not just non-default values).
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, rating: 5 }} />);
    expect(badge('badge-rated').dataset.state).toBe('done');
    expect(badge('badge-rated').tagName).toBe('BUTTON'); // never an inert span, unlike the other badges
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '2 stars - Technical Lapse' }));
    expect(badge('badge-rated').dataset.state).toBe('done'); // still done -- edit mode always is
    // Reopen: the picker reflects the just-picked value.
    fireEvent.click(badge('badge-rated'));
    expect(screen.getByRole('radio', { name: '2 stars - Technical Lapse' }).getAttribute('aria-checked')).toBe('true');
    // Change it again.
    fireEvent.click(screen.getByRole('radio', { name: '4 stars - Good' }));
    fireEvent.click(badge('badge-rated'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
  });

  it('DetailsFields no longer carries its own duplicate Rating row (the badge is the only rating control)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    // T10580: detailsOpen now defaults CLOSED -- open the disclosure first
    // (Reviewer: this assertion was vacuous when the panel was never
    // mounted at all) so this actually re-checks the panel's own content.
    fireEvent.click(screen.getByTestId('add-details-button'));
    expect(screen.getByLabelText('Notes (optional)')).toBeTruthy(); // sanity: the panel really is open
    expect(screen.queryByText(/^Rating/)).toBeNull();
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
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Brilliant' }));
    expect(badge('badge-clip').dataset.state).toBe('nudge');
    fireEvent.click(badge('badge-clip'));
    await waitFor(() => expect(onCreateClip).toHaveBeenCalled());
    expect(onCreateClip.mock.calls[0][0].createProject).toBe(true);
  });
});

describe('same-play identity churn keeps unsaved edits (Reviewer BLOCKING #2)', () => {
  // updateClipRegion spreads the region on EVERY surgical update, so the parent
  // hands the editor a NEW existingClip object for the SAME play — e.g. the
  // autoProjectId landing after the clip badge's create. The reset effect must
  // not treat that as a clip switch and wipe the form.
  it('re-rendering with a new object for the same clip id preserves the 5-star edit and typed name', () => {
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Brilliant' }));
    fireEvent.click(badge('badge-named'));
    fireEvent.change(screen.getByLabelText('Clip name'), { target: { value: 'Banger' } });
    expect(badge('badge-clip').dataset.state).toBe('nudge');

    // The create lands: same id, new identity, autoProjectId set.
    rerender(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, autoProjectId: 42 }} />);
    expect(badge('badge-clip').dataset.state).toBe('done');
    expect(badge('badge-rated').dataset.state).toBe('done');
    expect(screen.getByLabelText('Clip name').value).toBe('Banger');
    fireEvent.click(badge('badge-rated'));
    expect(screen.getByRole('radio', { name: '5 stars - Brilliant' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a DIFFERENT clip id still resets the form', () => {
    const { rerender } = render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={bareClip} />);
    fireEvent.click(badge('badge-rated'));
    fireEvent.click(screen.getByRole('radio', { name: '5 stars - Brilliant' }));
    rerender(<AnnotateFullscreenOverlay {...baseProps} layout="strip" existingClip={{ ...bareClip, id: 'c2', rating: 3 }} />);
    fireEvent.click(badge('badge-rated'));
    expect(screen.getByRole('radio', { name: '3 stars - Interesting' }).getAttribute('aria-checked')).toBe('true');
  });
});

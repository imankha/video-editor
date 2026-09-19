import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';
import { ANNOTATE } from '../../../config/displayNames';

// jsdom lacks matchMedia; AnnotateFullscreenOverlay renders through the real useIsMobile hook.
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

// T5700: the Layer control (a) defaults NEW clips from the mode-toggle prop
// (newClipLayerIsMine), (b) hydrates from the clip when editing, (c) is shown
// on mobile too (no !isMobile guard), (d) is locked read-only for imported
// clips, and (e) preserves the 5-star-auto-project-only-for-My-Athlete rule.
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
  surface: 'dock_fullscreen',
};

describe('AnnotateFullscreenOverlay — Layer control (T5700)', () => {
  it('create mode defaults the Layer control from newClipLayerIsMine=true (My Athlete)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
    expect(screen.getByRole('radio', { name: 'My athlete' }).getAttribute('aria-checked')).toBe('true');
  });

  it('create mode defaults the Layer control from newClipLayerIsMine=false (Team)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={false} />);
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });

  it('edit mode hydrates the Layer control from the existing clip, ignoring the mode toggle', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        newClipLayerIsMine={true}
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false }}
      />
    );
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a new clip is saved with my_athlete matching the mode toggle', () => {
    const onCreateClip = vi.fn();
    const { container } = render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={false} onCreateClip={onCreateClip} />);
    // NOTE: getByRole('button', { name: 'Save' }) also matches the "Save" tag
    // pill (goalkeeper position tag) — scope to the submit button's own class.
    fireEvent.click(container.querySelector('button.bg-green-600'));
    expect(onCreateClip).toHaveBeenCalledTimes(1);
    expect(onCreateClip.mock.calls[0][0]).toMatchObject({ my_athlete: false });
  });

  describe('imported clip (shared_by set)', () => {
    it('locks the Layer control to Team', () => {
      render(
        <AnnotateFullscreenOverlay
          {...baseProps}
          existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false, shared_by: 'Dana Smith' }}
        />
      );
      const mine = screen.getByRole('radio', { name: /^My athlete/ });
      const team = screen.getByRole('radio', { name: /^Team/ });
      expect(mine.disabled).toBe(true);
      expect(team.disabled).toBe(true);
    });

    it('an update saves without changing my_athlete when the lock is clicked (no-op, no request for the layer field)', () => {
      const onUpdateClip = vi.fn();
      render(
        <AnnotateFullscreenOverlay
          {...baseProps}
          existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false, shared_by: 'Dana Smith' }}
          onUpdateClip={onUpdateClip}
        />
      );
      fireEvent.click(screen.getByRole('radio', { name: /^My athlete/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Update play' }));
      expect(onUpdateClip).toHaveBeenCalledTimes(1);
      expect(onUpdateClip.mock.calls[0][1]).toMatchObject({ my_athlete: false });
    });
  });

  // T9830/T10290: rating and layer no longer drive a create-clip default. The
  // single Save outcome ("Save play") is always present and enabled, identical
  // for unrated / 4-star / 5-star and for either layer. T10310 (2026-09-18 user
  // request): "Save and Frame" moved out to the main screen, so it's never
  // rendered here.
  describe('the one Save outcome, independent of rating/layer (T9830/T10290/T10310)', () => {
    it('shows the outcome button, always enabled, at the default rating', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
      const save = screen.getByRole('button', { name: ANNOTATE.SAVE_PLAY });
      expect(save.disabled).toBe(false);
      expect(screen.queryByRole('button', { name: ANNOTATE.SAVE_AND_FRAME })).toBeNull();
    });

    it('a 5-star My Athlete moment shows the SAME button (no rating-driven default)', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
      fireEvent.keyDown(window, { key: '5' }); // rating shortcut, no inline stars to click
      expect(screen.getByRole('button', { name: ANNOTATE.SAVE_PLAY })).toBeTruthy();
    });

    it('a 5-star Team moment ALSO shows the same button', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={false} />);
      fireEvent.keyDown(window, { key: '5' });
      expect(screen.getByRole('button', { name: ANNOTATE.SAVE_PLAY })).toBeTruthy();
    });

    it('the old create-clip toggle and its state labels are gone', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
      expect(screen.queryByText(ANNOTATE.JUST_SAVE_PLAY)).toBeNull();
      expect(screen.queryByText("Don't Clip Play")).toBeNull();
    });
  });
});

// T8600: the desktop strip (layout="strip") renders the Layer control as a
// sibling row OUTSIDE the tinted card, separate markup from formBody (used by
// the overlay/inline layouts above) — needs its own strip-scoped coverage.
describe('AnnotateFullscreenOverlay — Layer control in the desktop strip (T8600)', () => {
  it('the strip button row shows the Layer control, defaulted from newClipLayerIsMine', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" surface="inline_desktop" newClipLayerIsMine={false} />);
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });

  it('locks both radios for an imported clip (shared_by set) in the strip', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        layout="strip"
        surface="inline_desktop"
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false, shared_by: 'Dana Smith' }}
      />
    );
    expect(screen.getByRole('radio', { name: /^My athlete/ }).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /^Team/ }).disabled).toBe(true);
  });
});

// T9830: rating is now an OPTIONAL detail — it no longer predicts a Save
// outcome, so the old star-scale "will become an editable clip / saves without
// creating a clip" caption is gone, and the rating control itself lives behind
// the "Optional details" disclosure rather than inline in the primary form.
describe('AnnotateFullscreenOverlay — rating is an optional detail, no outcome caption (T9830)', () => {
  it('create mode shows no outcome-prediction caption', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
    expect(screen.queryByText(/will also become an editable clip/)).toBeNull();
    expect(screen.queryByText(/without creating a clip/)).toBeNull();
    expect(screen.queryByText(/one more star|another star/)).toBeNull();
  });

  it('T10520: rating is reachable via the badge regardless of the details disclosure state (formBody)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
    // Collapsing the "Optional details" disclosure (Tags/Notes) no longer
    // affects rating at all — the rated badge and its popup picker live
    // outside the disclosure entirely, so the default is checkable either way.
    fireEvent.click(screen.getByTestId('add-details-button')); // collapse it
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
  });

  it('T10520: same on the strip layout', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" surface="inline_desktop" newClipLayerIsMine={true} />);
    fireEvent.click(screen.getByTestId('add-details-button')); // collapse it
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
  });
});

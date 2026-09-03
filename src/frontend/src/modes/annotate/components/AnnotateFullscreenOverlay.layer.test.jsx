import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

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
    expect(screen.getByRole('radio', { name: 'My Athlete layer' }).getAttribute('aria-checked')).toBe('true');
  });

  it('create mode defaults the Layer control from newClipLayerIsMine=false (Team)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={false} />);
    expect(screen.getByRole('radio', { name: 'Team layer' }).getAttribute('aria-checked')).toBe('true');
  });

  it('edit mode hydrates the Layer control from the existing clip, ignoring the mode toggle', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps}
        newClipLayerIsMine={true}
        existingClip={{ id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], my_athlete: false }}
      />
    );
    expect(screen.getByRole('radio', { name: 'Team layer' }).getAttribute('aria-checked')).toBe('true');
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
      const mine = screen.getByRole('radio', { name: /^My Athlete layer/ });
      const team = screen.getByRole('radio', { name: /^Team layer/ });
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
      fireEvent.click(screen.getByRole('radio', { name: /^My Athlete layer/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Update' }));
      expect(onUpdateClip).toHaveBeenCalledTimes(1);
      expect(onUpdateClip.mock.calls[0][1]).toMatchObject({ my_athlete: false });
    });
  });

  describe('5-star auto-project coupling', () => {
    it('a 5-star Team clip does NOT auto-enable Create Reel', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={false} />);
      fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
      expect(screen.getByText("Don't Create Reel")).toBeTruthy();
    });

    it('a 5-star My Athlete clip DOES auto-enable Create Reel', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
      fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
      expect(screen.getByText('Create Reel')).toBeTruthy();
    });

    it('switching the Layer control to Team after a 5-star rating turns Create Reel off', () => {
      render(<AnnotateFullscreenOverlay {...baseProps} newClipLayerIsMine={true} />);
      fireEvent.click(screen.getByRole('button', { name: '5 stars' }));
      expect(screen.getByText('Create Reel')).toBeTruthy();
      fireEvent.click(screen.getByRole('radio', { name: 'Team layer' }));
      expect(screen.getByText("Don't Create Reel")).toBeTruthy();
    });
  });
});

// T8600: the desktop strip (layout="strip") renders the Layer control as a
// sibling row OUTSIDE the tinted card, separate markup from formBody (used by
// the overlay/inline layouts above) — needs its own strip-scoped coverage.
describe('AnnotateFullscreenOverlay — Layer control in the desktop strip (T8600)', () => {
  it('the strip button row shows the Layer control, defaulted from newClipLayerIsMine', () => {
    render(<AnnotateFullscreenOverlay {...baseProps} layout="strip" surface="inline_desktop" newClipLayerIsMine={false} />);
    expect(screen.getByRole('radio', { name: 'Team layer' }).getAttribute('aria-checked')).toBe('true');
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
    expect(screen.getByRole('radio', { name: /^My Athlete layer/ }).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /^Team layer/ }).disabled).toBe(true);
  });
});

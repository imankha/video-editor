import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AnnotateFullscreenOverlay } from './AnnotateFullscreenOverlay';

// T5700: the Layer control (a) hydrates from the clip when editing, (b) is
// shown on mobile too (no !isMobile guard), (c) is locked read-only for
// imported clips, (d) preserves the T5725 layer->teammates clearing rule.
//
// T10610: `newClipLayerIsMine` is retired — there is no create mode, so the
// Layer control always hydrates from existingClip.my_athlete. Every toggle
// now persists on its own gesture via onUpdateClip (design doc § 2.2), not a
// Save-button submit — see AnnotateFullscreenOverlay.noSaveButton.test.jsx's
// two layer tests for the current expected call shape. The old "one Save
// outcome, independent of rating/layer" and "rating is an optional detail"
// describe blocks were entirely about the retired SAVE_AND_FRAME/handleSave
// machinery (dead now that every field is per-gesture) and are removed.

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

const baseClip = {
  id: 'c1', startTime: 0, endTime: 10, rating: 4, tags: [], name: 'Play 1',
  notes: '', tagged_teammates: [],
};

function baseProps(overrides = {}) {
  return {
    isVisible: true,
    currentTime: 30,
    videoDuration: 6000,
    existingClip: baseClip,
    onUpdateClip: vi.fn(() => Promise.resolve({ saveOk: true })),
    onClose: () => {},
    onSeek: () => {},
    videoController: {},
    onDeleteClip: () => {},
    ...overrides,
  };
}

describe('AnnotateFullscreenOverlay — Layer control (T5700)', () => {
  it('hydrates the Layer control from the existing clip (My athlete)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: true } })} />);
    expect(screen.getByRole('radio', { name: 'My athlete' }).getAttribute('aria-checked')).toBe('true');
  });

  it('hydrates the Layer control from the existing clip (Team)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: false } })} />);
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });

  it('toggling to Team persists {my_athlete: false} on its own gesture', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, existingClip: { ...baseClip, my_athlete: true } })} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Team' }));
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: false });
  });

  it('toggling back to My athlete clears teammates in the SAME gesture (T5725)', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    const clip = { ...baseClip, my_athlete: false, tagged_teammates: ['Sam'] };
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, existingClip: clip })} />);
    fireEvent.click(screen.getByRole('radio', { name: 'My athlete' }));
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: true, tagged_teammates: [] });
  });

  describe('imported clip (shared_by set)', () => {
    it('locks the Layer control to Team', () => {
      render(
        <AnnotateFullscreenOverlay
          {...baseProps({ existingClip: { ...baseClip, my_athlete: false, shared_by: 'Dana Smith' } })}
        />
      );
      const mine = screen.getByRole('radio', { name: /^My athlete/ });
      const team = screen.getByRole('radio', { name: /^Team/ });
      expect(mine.disabled).toBe(true);
      expect(team.disabled).toBe(true);
    });

    it('clicking the locked control does not persist anything (no request for the layer field)', () => {
      const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
      render(
        <AnnotateFullscreenOverlay
          {...baseProps({ onUpdateClip, existingClip: { ...baseClip, my_athlete: false, shared_by: 'Dana Smith' } })}
        />
      );
      fireEvent.click(screen.getByRole('radio', { name: /^My athlete/ }));
      expect(onUpdateClip).not.toHaveBeenCalled();
    });
  });
});

// T8600: the desktop strip (layout="strip") renders the Layer control as a
// sibling row OUTSIDE the tinted card, separate markup from formBody (used by
// the overlay/inline layouts above) — needs its own strip-scoped coverage.
describe('AnnotateFullscreenOverlay — Layer control in the desktop strip (T8600)', () => {
  it('the strip button row shows the Layer control, hydrated from the existing clip', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: false } })} layout="strip" />);
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });

  it('locks both radios for an imported clip (shared_by set) in the strip', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ existingClip: { ...baseClip, my_athlete: false, shared_by: 'Dana Smith' } })}
        layout="strip"
      />
    );
    expect(screen.getByRole('radio', { name: /^My athlete/ }).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /^Team/ }).disabled).toBe(true);
  });

  it('toggling the strip layer control persists on its own gesture', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, existingClip: { ...baseClip, my_athlete: true } })} layout="strip" />);
    fireEvent.click(screen.getByRole('radio', { name: 'Team' }));
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: false });
  });
});

// T10520/T10580: rating lives in the rated badge's popup picker regardless of
// the "Optional details" disclosure state.
describe('AnnotateFullscreenOverlay — rating reachable via the badge regardless of details state', () => {
  it('formBody: the badge works both while details is closed and after opening it', () => {
    render(<AnnotateFullscreenOverlay {...baseProps()} />);
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' }); // close the picker without opening details
    fireEvent.click(screen.getByTestId('add-details-button')); // now open details too
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
  });

  it('same on the strip layout', () => {
    render(<AnnotateFullscreenOverlay {...baseProps()} layout="strip" />);
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByTestId('add-details-button'));
    fireEvent.click(screen.getByTestId('badge-rated'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
  });
});

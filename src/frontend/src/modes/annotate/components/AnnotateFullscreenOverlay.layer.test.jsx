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
// two layer tests for the current expected call shape.
//
// T11150 (Play editor hierarchy, H16): the Layer/category control moved OFF
// the always-visible header row and INTO the "Details" disclosure (category
// first, then teammates) — every test here opens Details first before
// looking for the radio group.

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

const openDetails = () => fireEvent.click(screen.getByTestId('add-details-button'));

describe('AnnotateFullscreenOverlay — Layer control (T5700/T11150)', () => {
  it('hydrates the Layer control from the existing clip (My athlete)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: true } })} />);
    openDetails();
    expect(screen.getByRole('radio', { name: 'My athlete' }).getAttribute('aria-checked')).toBe('true');
  });

  it('hydrates the Layer control from the existing clip (Team)', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: false } })} />);
    openDetails();
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });

  it('toggling to Team persists {my_athlete: false} on its own gesture', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, existingClip: { ...baseClip, my_athlete: true } })} />);
    openDetails();
    fireEvent.click(screen.getByRole('radio', { name: 'Team' }));
    expect(onUpdateClip).toHaveBeenCalledTimes(1);
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: false });
  });

  it('toggling back to My athlete clears teammates in the SAME gesture (T5725)', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    const clip = { ...baseClip, my_athlete: false, tagged_teammates: ['Sam'] };
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, existingClip: clip })} />);
    openDetails();
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
      openDetails();
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
      openDetails();
      fireEvent.click(screen.getByRole('radio', { name: /^My athlete/ }));
      expect(onUpdateClip).not.toHaveBeenCalled();
    });
  });
});

// T8600/T11150: the desktop strip (layout="strip") renders its Details panel
// as separate markup from formBody (used by the overlay/inline layouts
// above) — needs its own strip-scoped coverage.
describe('AnnotateFullscreenOverlay — Layer control in the desktop strip (T8600/T11150)', () => {
  it('the strip Details panel shows the Layer control, hydrated from the existing clip', () => {
    render(<AnnotateFullscreenOverlay {...baseProps({ existingClip: { ...baseClip, my_athlete: false } })} layout="strip" />);
    openDetails();
    expect(screen.getByRole('radio', { name: 'Team' }).getAttribute('aria-checked')).toBe('true');
  });

  it('locks both radios for an imported clip (shared_by set) in the strip', () => {
    render(
      <AnnotateFullscreenOverlay
        {...baseProps({ existingClip: { ...baseClip, my_athlete: false, shared_by: 'Dana Smith' } })}
        layout="strip"
      />
    );
    openDetails();
    expect(screen.getByRole('radio', { name: /^My athlete/ }).disabled).toBe(true);
    expect(screen.getByRole('radio', { name: /^Team/ }).disabled).toBe(true);
  });

  it('toggling the strip layer control persists on its own gesture', () => {
    const onUpdateClip = vi.fn(() => Promise.resolve({ saveOk: true }));
    render(<AnnotateFullscreenOverlay {...baseProps({ onUpdateClip, existingClip: { ...baseClip, my_athlete: true } })} layout="strip" />);
    openDetails();
    fireEvent.click(screen.getByRole('radio', { name: 'Team' }));
    expect(onUpdateClip).toHaveBeenCalledWith('c1', { my_athlete: false });
  });
});

// T11150: rating lives in the RatingPill regardless of the "Details"
// disclosure state (they are two independent controls now).
describe('AnnotateFullscreenOverlay — rating reachable via the pill regardless of details state', () => {
  it('formBody: the pill works both while details is closed and after opening it', () => {
    render(<AnnotateFullscreenOverlay {...baseProps()} />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' }); // close the picker without opening details
    openDetails(); // now open details too
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
  });

  it('same on the strip layout', () => {
    render(<AnnotateFullscreenOverlay {...baseProps()} layout="strip" />);
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.keyDown(document, { key: 'Escape' });
    openDetails();
    fireEvent.click(screen.getByTestId('rating-pill'));
    expect(screen.getByRole('radio', { name: '4 stars - Good' }).getAttribute('aria-checked')).toBe('true');
  });
});

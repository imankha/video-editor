import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ClipDetailsEditor } from './ClipDetailsEditor';

// jsdom lacks matchMedia; ClipDetailsEditor renders through the real useIsMobile
// hook. `matches` is the value returned for EVERY query, so `true` simulates a
// mobile viewport and `false` a desktop one.
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

beforeEach(() => mockViewport(false));

// T5725: teammate tagging is a Team-layer-only affordance. The Teammates block
// renders ONLY when the clip is on the Team layer (my_athlete === false), on
// desktop AND mobile (the old !isMobile gate is gone). Switching a clip TO My
// Athlete clears its teammate tags in the SAME gesture (clear-on-switch), so a
// My Athlete clip can never hold an invisible, contradictory teammate tag.
const baseRegion = {
  id: 'c1',
  startTime: 0,
  endTime: 10,
  rating: 4,
  tags: [],
  notes: '',
  name: 'Test clip',
};

const TEAMMATES_LABEL = 'Teammates';

describe('ClipDetailsEditor — Teammates control gating (T5725)', () => {
  it('is ABSENT on a My Athlete clip (my_athlete = true)', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: true }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
  });

  it('is ABSENT on a legacy My Athlete clip (my_athlete = null → My Athlete)', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: null }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
  });

  it('is ABSENT on a legacy My Athlete clip (my_athlete = undefined → My Athlete)', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: undefined }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
  });

  it('is PRESENT on a Team clip (my_athlete = false)', () => {
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: false }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
  });

  it('is PRESENT on a Team clip on MOBILE too (dropped the !isMobile gate)', () => {
    mockViewport(true);
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: false }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.getByText(TEAMMATES_LABEL)).toBeTruthy();
  });

  it('is ABSENT on a My Athlete clip on MOBILE', () => {
    mockViewport(true);
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: true }} onUpdate={() => {}} onDelete={() => {}} />);
    expect(screen.queryByText(TEAMMATES_LABEL)).toBeNull();
  });

  it('renders existing teammate chips on a Team clip', () => {
    render(
      <ClipDetailsEditor
        region={{ ...baseRegion, my_athlete: false, tagged_teammates: ['Alex', 'Sam'] }}
        onUpdate={() => {}}
        onDelete={() => {}}
      />
    );
    expect(screen.getByText('Alex')).toBeTruthy();
    expect(screen.getByText('Sam')).toBeTruthy();
  });
});

describe('ClipDetailsEditor — clear-on-switch to My Athlete (T5725)', () => {
  it('switching a tagged Team clip TO My Athlete clears tags in the same surgical write', () => {
    const onUpdate = vi.fn();
    render(
      <ClipDetailsEditor
        region={{ ...baseRegion, my_athlete: false, tagged_teammates: ['Alex'] }}
        onUpdate={onUpdate}
        onDelete={() => {}}
      />
    );
    fireEvent.click(screen.getByRole('radio', { name: 'My Athlete layer' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ my_athlete: true, tagged_teammates: [] });
  });

  it('switching TO Team sends ONLY my_athlete (no spurious tag write)', () => {
    const onUpdate = vi.fn();
    render(<ClipDetailsEditor region={{ ...baseRegion, my_athlete: true }} onUpdate={onUpdate} onDelete={() => {}} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Team layer' }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate).toHaveBeenCalledWith({ my_athlete: false });
  });
});

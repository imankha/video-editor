// T6670 — the carousel surfaces an inline "create a new card" affordance, but
// ONLY when a host wires `onCreateNew` (the share-dialog carousel, which
// attaches at share time, deliberately does not). The tile is always enabled
// (no-consent routing happens in the host's inner consent gate, not by
// disabling the affordance here).

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { IntroCardCarousel } from './IntroCardCarousel';

afterEach(cleanup);

function renderCarousel(overrides = {}) {
  const props = {
    cards: [],
    profile: { id: 'p', introPhotoKey: null },
    selectedId: null,
    hasConsent: true,
    onSelect: vi.fn(),
    onRequestConsent: vi.fn(),
    ...overrides,
  };
  render(<IntroCardCarousel {...props} />);
  return props;
}

describe('IntroCardCarousel — inline create affordance (T6670)', () => {
  it('renders the "New card" tile when onCreateNew is wired', () => {
    renderCarousel({ onCreateNew: vi.fn() });
    // getByLabelText throws if absent, so this asserts presence.
    expect(screen.getByLabelText('Create new Athlete Intro Card')).toBeTruthy();
  });

  it('does NOT render the tile when onCreateNew is absent (share-dialog carousel)', () => {
    renderCarousel();
    expect(screen.queryByLabelText('Create new Athlete Intro Card')).toBeNull();
  });

  it('clicking the tile calls onCreateNew', () => {
    const onCreateNew = vi.fn();
    renderCarousel({ onCreateNew });
    fireEvent.click(screen.getByLabelText('Create new Athlete Intro Card'));
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });

  it('the create tile stays enabled even without consent (routes into the consent gate)', () => {
    const onCreateNew = vi.fn();
    renderCarousel({ hasConsent: false, onCreateNew });
    const tile = screen.getByLabelText('Create new Athlete Intro Card');
    expect(tile.disabled).toBe(false);
    fireEvent.click(tile);
    expect(onCreateNew).toHaveBeenCalledTimes(1);
  });
});

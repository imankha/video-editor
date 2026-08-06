// T5205 — the shared preview: framing resolution, slot-text sourcing, and that
// text slots now render at the T5210 contract geometry (post-rebase).

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { IntroCardPreview, resolveFraming, slotDisplayText } from './IntroCardPreview';

// RichText fetches /api/fonts/fonts.json; stub it (no backend in unit tests).
beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, json: async () => ({}) });
});
afterEach(() => { vi.restoreAllMocks(); cleanup(); });

describe('resolveFraming', () => {
  it('uses the card focal/zoom when set', () => {
    expect(resolveFraming({ focal_x: 0.2, focal_y: 0.8, zoom: 2 }, {})).toEqual({ focalX: 0.2, focalY: 0.8, zoom: 2 });
  });

  it('falls back to the profile framing, then to centred/un-zoomed defaults', () => {
    const fromProfile = resolveFraming({ focal_x: null, focal_y: null, zoom: null }, { introFocalX: 0.3 });
    expect(fromProfile).toEqual({ focalX: 0.3, focalY: 0.5, zoom: 1.0 });
    expect(resolveFraming({}, {})).toEqual({ focalX: 0.5, focalY: 0.5, zoom: 1.0 });
  });
});

describe('slotDisplayText', () => {
  it('reads the title from the profile full name (T6620) and facts from the profile', () => {
    // T6620: the profile ALWAYS wins; a stored title_text is dead and ignored.
    const card = { title_text: 'CHAMPION' };
    const profile = { full_name: 'Jordan Vega', position: 'Striker', class: '', team: 'Rovers' };
    expect(slotDisplayText('title', card, profile)).toBe('Jordan Vega');
    expect(slotDisplayText('position', card, profile)).toBe('Striker');
    expect(slotDisplayText('class', card, profile)).toBe('');
  });
});

describe('IntroCardPreview rendering', () => {
  const baseCard = { image_key: 'k', previewUrl: 'http://x/p.jpg', treatment: 'gold', text_elements: {} };

  it('renders the photo with object-position from the focal point', () => {
    const { container } = render(
      <IntroCardPreview card={{ ...baseCard, focal_x: 0.25, focal_y: 0.75, zoom: 1.5, title_text: '' }} profile={{}} boxWidth={90} boxHeight={160} aspect="9:16" />
    );
    const img = container.querySelector('img');
    expect(img.style.objectPosition).toBe('25% 75%');
    expect(img.style.transform).toContain('scale(1.5)');
  });

  it('renders the title text (profile full name) and a shown fact value; omits an unfilled fact', () => {
    // T6620: the title is the profile's full name; a stored title_text is ignored.
    const { container } = render(
      <IntroCardPreview
        card={{ ...baseCard, title_text: 'CHAMPION', shown_fields: ['position', 'class'] }}
        profile={{ full_name: 'Jordan Vega', position: 'Striker', class: '' }}
        boxWidth={90}
        boxHeight={160}
        aspect="9:16"
      />
    );
    expect(container.textContent).toContain('Jordan Vega');
    expect(container.textContent).not.toContain('CHAMPION'); // dead title_text never renders
    expect(container.textContent).toContain('Striker');
    // class is empty -> that line is omitted, never rendered blank.
  });

  it('renderSlots=false draws the backdrop + photo but no text (motion base layer)', () => {
    const { container } = render(
      <IntroCardPreview card={{ ...baseCard }} profile={{ full_name: 'HELLO' }} boxWidth={90} boxHeight={160} aspect="9:16" renderSlots={false} />
    );
    expect(container.textContent).not.toContain('HELLO');
  });
});

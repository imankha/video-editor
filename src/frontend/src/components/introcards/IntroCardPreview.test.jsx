// T5205 — the shared preview: framing resolution + slot-text sourcing, and the
// contract that slot text is drawn ONLY with T5210 composition geometry.

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { IntroCardPreview, resolveFraming, slotDisplayText } from './IntroCardPreview';

afterEach(cleanup);

describe('resolveFraming', () => {
  it('uses the card focal/zoom when set', () => {
    const f = resolveFraming({ focal_x: 0.2, focal_y: 0.8, zoom: 2 }, {});
    expect(f).toEqual({ focalX: 0.2, focalY: 0.8, zoom: 2 });
  });

  it('falls back to the profile framing, then to centred/un-zoomed defaults', () => {
    const fromProfile = resolveFraming({ focal_x: null, focal_y: null, zoom: null }, { introFocalX: 0.3 });
    expect(fromProfile.focalX).toBe(0.3);
    expect(fromProfile.focalY).toBe(0.5);
    expect(fromProfile.zoom).toBe(1.0);

    const defaults = resolveFraming({}, {});
    expect(defaults).toEqual({ focalX: 0.5, focalY: 0.5, zoom: 1.0 });
  });
});

describe('slotDisplayText', () => {
  it('reads the title from the card and facts from the profile', () => {
    const card = { title_text: 'CHAMPION' };
    const profile = { position: 'Striker', class: '', team: 'Rovers' };
    expect(slotDisplayText('title', card, profile)).toBe('CHAMPION');
    expect(slotDisplayText('position', card, profile)).toBe('Striker');
    expect(slotDisplayText('class', card, profile)).toBe('');
    expect(slotDisplayText('team', card, profile)).toBe('Rovers');
  });
});

describe('IntroCardPreview rendering', () => {
  it('renders the photo with object-position from the focal point', () => {
    const { container } = render(
      <IntroCardPreview
        card={{ image_key: 'k', previewUrl: 'http://x/p.jpg', focal_x: 0.25, focal_y: 0.75, zoom: 1.5, treatment: 'gold' }}
        profile={{}}
        boxWidth={90}
        boxHeight={160}
      />
    );
    const img = container.querySelector('img');
    expect(img).toBeTruthy();
    expect(img.style.objectPosition).toBe('25% 75%');
    expect(img.style.transform).toContain('scale(1.5)');
  });

  it('draws NO slot text without geometry, even when text_elements exist (T5210 contract)', () => {
    const { container } = render(
      <IntroCardPreview
        card={{ image_key: 'k', previewUrl: 'u', title_text: 'HELLO', treatment: 'dark', text_elements: { title: { text: '', font: 'anton', size: 0.08, color: '#fff', align: 'center', position: { x: 0.5, y: 0.5 }, maxWidth: 0.8, shadow: { blur: 0, color: '#000', opacity: 0 }, stroke: { width: 0, color: '#000' } } } }}
        profile={{}}
        boxWidth={90}
        boxHeight={160}
      />
    );
    expect(container.textContent).not.toContain('HELLO');
  });
});

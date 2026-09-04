import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OverlayEffectIllustration } from '../OverlayEffectIllustration';

describe('OverlayEffectIllustration (T8520)', () => {
  it('renders an accessible img with descriptive alt text', () => {
    render(<OverlayEffectIllustration />);
    const img = screen.getByRole('img');
    expect(img).toBeTruthy();
    expect(img.getAttribute('aria-label')).toMatch(/spotlight/i);
    expect(img.getAttribute('aria-label')).toMatch(/label/i);
  });

  it('shows the on-video text label chip', () => {
    render(<OverlayEffectIllustration />);
    expect(screen.getByText('GOAL')).toBeTruthy();
  });
});

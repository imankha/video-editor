import { render, screen } from '@testing-library/react';
import { Download } from 'lucide-react';
import PrimaryCta from './PrimaryCta';

describe('PrimaryCta compact variant (T10840 D9)', () => {
  it('uses the same data-testid as the full variant', () => {
    render(<PrimaryCta compact icon={Download}><span>Generate</span><span>Framing</span></PrimaryCta>);
    expect(screen.getByTestId('primary-cta')).toBeTruthy();
  });

  it('renders a fixed 64x60 box that is byte-identical regardless of content (box-invariance)', () => {
    const { rerender } = render(
      <PrimaryCta compact icon={Download}><span>Generate</span><span>Framing</span></PrimaryCta>,
    );
    const first = screen.getByTestId('primary-cta').getAttribute('style');
    expect(first).toContain('width: 64px');
    expect(first).toContain('height: 60px');

    // A different label (the "Back to Preview" state) must not change the box.
    rerender(
      <PrimaryCta compact icon={Download}><span>Back to</span><span>Preview</span></PrimaryCta>,
    );
    const second = screen.getByTestId('primary-cta').getAttribute('style');
    expect(second).toContain('width: 64px');
    expect(second).toContain('height: 60px');
  });

  it('disabled compact CTA drops its shadow and is not clickable', () => {
    render(<PrimaryCta compact disabled icon={Download}><span>Generate</span></PrimaryCta>);
    const btn = screen.getByTestId('primary-cta');
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('style')).toContain('box-shadow: none');
  });

  it('the full (non-compact) variant keeps its 56px pill box', () => {
    render(<PrimaryCta icon={Download}>Generate Framing</PrimaryCta>);
    const style = screen.getByTestId('primary-cta').getAttribute('style');
    expect(style).toContain('height: 56px');
    expect(style).not.toContain('width: 64px');
  });
});

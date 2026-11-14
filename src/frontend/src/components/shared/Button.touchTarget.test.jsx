import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './Button';

// T15600: text (non-iconOnly) buttons had no coarse-pointer floor, so "Send code" /
// "Verify" / "Mark play" etc. stayed at their compact desktop height (as low as
// 32-36px) on touch devices, under the 44px Apple HIG / WCAG 2.5.5 minimum.
describe('T15600 Button coarse-pointer touch target floor (text buttons)', () => {
  it('gives every size a coarse-pointer min-h-11 floor even without iconOnly', () => {
    render(<>
      <Button size="sm" data-testid="sm">Send code</Button>
      <Button size="md" data-testid="md">Verify</Button>
      <Button size="lg" data-testid="lg">Go</Button>
    </>);
    expect(screen.getByTestId('sm').className).toContain('coarse-pointer:min-h-11');
    expect(screen.getByTestId('md').className).toContain('coarse-pointer:min-h-11');
    expect(screen.getByTestId('lg').className).toContain('coarse-pointer:min-h-11');
  });

  it('keeps the existing icon-only width+height floor unchanged', () => {
    render(<Button size="sm" iconOnly data-testid="icon">x</Button>);
    const cls = screen.getByTestId('icon').className;
    expect(cls).toContain('coarse-pointer:min-w-11');
    expect(cls).toContain('coarse-pointer:min-h-11');
  });
});

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import ActionBand from './ActionBand';

/**
 * T10630: at 393px the three-cell row (status | CTA | cost) had no cell with shrink
 * priority, so both text cells wrapped one word per line into a vertical column on
 * either side of the button. Fix stacks below `sm:` (CTA first) while keeping the
 * desktop row byte-identical at `sm:` and up.
 */

describe('ActionBand (T10630)', () => {
  it('keeps data-testid and CTA node identity', () => {
    render(
      <ActionBand
        status={<span>Set at least one focus point to generate</span>}
        cta={<button data-testid="the-cta">Generate Framing</button>}
        cost={<span>~8 credits</span>}
      />
    );

    expect(screen.getByTestId('action-band')).toBeTruthy();
    expect(screen.getByTestId('the-cta')).toBeTruthy();
  });

  it('stacks with the CTA ordered first on mobile, status/cost as full-width centered lines', () => {
    render(
      <ActionBand
        status={<span data-testid="status-content">status</span>}
        cta={<button data-testid="cta-content">cta</button>}
        cost={<span data-testid="cost-content">cost</span>}
      />
    );

    const statusCell = screen.getByTestId('status-content').parentElement;
    const ctaCell = screen.getByTestId('cta-content').parentElement;
    const costCell = screen.getByTestId('cost-content').parentElement;

    // Mobile: CTA renders first (order-1), status second (order-2), cost third (order-3).
    expect(ctaCell.className).toContain('order-1');
    expect(ctaCell.className).toContain('sm:order-2');
    expect(statusCell.className).toContain('order-2');
    expect(statusCell.className).toContain('sm:order-1');
    expect(costCell.className).toContain('order-3');

    // Full-width + centered text on mobile, restored to auto-width + edge-aligned at sm:.
    expect(statusCell.className).toContain('w-full');
    expect(statusCell.className).toContain('sm:w-auto');
    expect(statusCell.className).toContain('text-center');
    expect(statusCell.className).toContain('sm:text-left');
    expect(costCell.className).toContain('w-full');
    expect(costCell.className).toContain('sm:w-auto');
    expect(costCell.className).toContain('text-center');
    expect(costCell.className).toContain('sm:text-right');
  });

  it('keeps the outer row flex-col on mobile and flex-row from sm: up', () => {
    render(<ActionBand status={<span>s</span>} cta={<button>c</button>} cost={<span>k</span>} />);

    const row = screen.getByTestId('action-band').firstElementChild;
    expect(row.className).toContain('flex-col');
    expect(row.className).toContain('sm:flex-row');
    // min-h-[76px] must be sm:-scoped — mobile height is content-driven (three stacked lines).
    expect(row.className).not.toMatch(/(?<!sm:)min-h-\[76px\]/);
    expect(row.className).toContain('sm:min-h-[76px]');
  });

  it('renders nothing for status/cta/cost by default (no crash on null props)', () => {
    render(<ActionBand />);
    expect(screen.getByTestId('action-band')).toBeTruthy();
  });
});

/**
 * T11720: on phones (below sm), while Generate is locked (clip unframed), the
 * band collapses to one ~52px row so the timeline + Trim controls above it stay
 * on screen. The full band (with the REAL CTA in the DOM) still renders at sm+.
 */
describe('ActionBand compact locked band (T11720)', () => {
  it('renders a sm:hidden compact row with the unlock copy and a disabled Generate pill when compactLocked', () => {
    render(
      <ActionBand
        compactLocked
        status={<span>status</span>}
        cta={<button>Generate Highlight</button>}
        cost={<span>~8 credits</span>}
      />
    );
    const compact = screen.getByTestId('action-band-compact');
    expect(compact.className).toContain('sm:hidden');
    expect(compact.textContent).toMatch(/Set a focus point to unlock Generate/);
    const pill = screen.getByTestId('generate-locked-pill');
    expect(pill.getAttribute('aria-disabled')).toBe('true');
    expect(pill.textContent).toMatch(/^Generate$/);
  });

  it('keeps the full band (real CTA) in the DOM but hidden below sm when compactLocked', () => {
    render(
      <ActionBand
        compactLocked
        status={<span>status</span>}
        cta={<button data-testid="real-cta">Generate Highlight</button>}
        cost={<span>~8 credits</span>}
      />
    );
    const realCta = screen.getByTestId('real-cta');
    expect(realCta).toBeTruthy(); // still in the DOM for sm+ specs
    const fullBand = realCta.parentElement.parentElement;
    expect(fullBand.className).toContain('hidden');
    expect(fullBand.className).toContain('sm:flex');
  });

  it('does not render the compact row when not locked (byte-identical to before)', () => {
    render(<ActionBand status={<span>s</span>} cta={<button>c</button>} cost={<span>k</span>} />);
    expect(screen.queryByTestId('action-band-compact')).toBeNull();
    // Full band is the only child and renders at all widths (flex, not hidden).
    const row = screen.getByTestId('action-band').firstElementChild;
    expect(row.className).toContain('flex-col');
    expect(row.className).not.toContain('hidden');
  });
});

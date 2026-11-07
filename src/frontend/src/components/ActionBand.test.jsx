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

describe('ActionBand above slot', () => {
  it('renders the secondary row before the CTA row, and nothing when unused', () => {
    const { rerender } = render(<ActionBand above={<button>Trim</button>} cta={<button>Go</button>} />);
    const band = screen.getByTestId('action-band');
    expect(band.firstElementChild).toBe(screen.getByTestId('action-band-above'));
    expect(screen.getByTestId('action-band-above').contains(screen.getByText('Trim'))).toBe(true);
    rerender(<ActionBand cta={<button>Go</button>} />);
    expect(screen.queryByTestId('action-band-above')).toBeNull();
  });
});

/**
 * T12020: Focus puts Generate FIRST (left on desktop, top on mobile) with Trim and
 * Preview as the secondary row. The old above-path rendered the secondaries before
 * the CTA, so Generate sat last on both breakpoints.
 */
describe('ActionBand secondary row (T12020)', () => {
  it('renders the CTA before the secondary row in DOM order', () => {
    render(
      <ActionBand
        above={<button data-testid="secondary-trim">Trim</button>}
        cta={<button data-testid="primary-generate">Generate</button>}
      />
    );

    const cta = screen.getByTestId('primary-generate');
    const secondary = screen.getByTestId('secondary-trim');
    expect(cta.compareDocumentPosition(secondary) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

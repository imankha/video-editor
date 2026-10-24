import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { PackMixTable } from './PackMixTable';

describe('PackMixTable (T13330)', () => {
  it('renders counts and gross cents per pack for each window', () => {
    const data = {
      windows: {
        '30d': [{ pack: 'popular', purchases: 3, gross_cents: 3897 }],
        '90d': [{ pack: 'popular', purchases: 5, gross_cents: 6495 }, { pack: 'starter', purchases: 2, gross_cents: 1398 }],
        all: [],
      },
    };
    render(<PackMixTable data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    const w30 = within(screen.getByTestId('pack-mix-30d'));
    expect(w30.getByText(/Popular/)).toBeTruthy();
    expect(w30.getByText('$38.97')).toBeTruthy();
    const w90 = within(screen.getByTestId('pack-mix-90d'));
    expect(w90.getByText(/One Game/)).toBeTruthy();
    expect(w90.getByText('$13.98')).toBeTruthy();
    expect(within(screen.getByTestId('pack-mix-all')).getByText('No purchases.')).toBeTruthy();
  });
});

describe('PackMixTable labels (T13330 review)', () => {
  it('shows the display name + current credits per row and the starter-key cutover note', () => {
    const data = { windows: { '30d': [{ pack: 'starter', purchases: 1, gross_cents: 699 }], '90d': [], all: [] } };
    render(<PackMixTable data={data} loading={false} error={null} onRefresh={vi.fn()} />);
    const w30 = within(screen.getByTestId('pack-mix-30d'));
    expect(w30.getByText(/One Game/)).toBeTruthy();
    expect(w30.getByText(/150 credits/)).toBeTruthy();
    expect(screen.getByTestId('pack-mix-note').textContent).toMatch(/starter.*2026-10-23.*340/);
  });
});

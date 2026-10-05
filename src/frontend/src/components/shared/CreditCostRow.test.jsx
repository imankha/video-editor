import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

/**
 * T11770: one shared cost/balance row for all four credit modals (upload game,
 * attach video, add footage, extend storage). The row that used to be
 * `justify-between` with two wrapping text blocks interleaved at 390px
 * ("2 credits - keeps your video for 30 Balance: days 54"). CreditCostRow stacks
 * cost/balance as a flex-wrap justify-between pair of whitespace-nowrap spans so a
 * wrap drops the balance to the next line whole, never mid-phrase, and puts the
 * retention note on its own line below.
 */

import { CreditCostRow } from './CreditCostRow';

describe('CreditCostRow (T11770)', () => {
  it('renders cost, balance and the caller-supplied note', () => {
    render(<CreditCostRow cost={2} balance={54} note="Your game video is kept for 30 days." />);
    expect(screen.getByText('Cost: 2 credits')).toBeTruthy();
    expect(screen.getByText('Balance: 54 credits')).toBeTruthy();
    expect(screen.getByText('Your game video is kept for 30 days.')).toBeTruthy();
  });

  it('singularizes a one-credit cost', () => {
    render(<CreditCostRow cost={1} balance={54} note="n" />);
    expect(screen.getByText('Cost: 1 credit')).toBeTruthy();
  });

  it('cost and balance are separate whitespace-nowrap spans (never interleave on wrap)', () => {
    render(<CreditCostRow cost={2} balance={54} note="n" />);
    const cost = screen.getByText('Cost: 2 credits');
    const balance = screen.getByText('Balance: 54 credits');
    expect(cost.className).toContain('whitespace-nowrap');
    expect(balance.className).toContain('whitespace-nowrap');
    // distinct nodes, not one interleaving text block
    expect(cost).not.toBe(balance);
  });

  it('renders the balance red when the balance is short of the cost', () => {
    render(<CreditCostRow cost={5} balance={2} note="n" />);
    const balance = screen.getByText('Balance: 2 credits');
    expect(balance.className).toContain('text-red-400');
  });

  it('renders the balance in the normal color when the balance covers the cost', () => {
    render(<CreditCostRow cost={2} balance={54} note="n" />);
    const balance = screen.getByText('Balance: 54 credits');
    expect(balance.className).not.toContain('text-red-400');
  });

  it('does not turn red for a non-numeric (still-loading) balance', () => {
    render(<CreditCostRow cost={2} balance={'…'} note="n" />);
    const balance = screen.getByText(/Balance:\s*…/);
    expect(balance.className).not.toContain('text-red-400');
  });

  it('omits the note line entirely when no note is given', () => {
    const { container } = render(<CreditCostRow cost={2} balance={54} />);
    expect(container.querySelector('p')).toBeNull();
  });
});

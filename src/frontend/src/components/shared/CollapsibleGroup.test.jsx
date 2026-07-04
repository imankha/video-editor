import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

import { CollapsibleGroup } from './CollapsibleGroup';

// T4190: a collapsed game group must surface its unwatched reels so the My Reels
// badge always has a visible on-screen counterpart. The "N new" chip is that
// counterpart, driven by the newCount prop.
describe('CollapsibleGroup — NEW chip (T4190)', () => {
  it('shows an "N new" chip when newCount > 0', () => {
    render(<CollapsibleGroup title="Vs Legends Jun 6" count={3} newCount={2} />);
    expect(screen.getByText('2 new')).toBeTruthy();
  });

  it('hides the chip when newCount is 0', () => {
    render(<CollapsibleGroup title="Vs Legends Jun 6" count={3} newCount={0} />);
    expect(screen.queryByText(/\bnew\b/)).toBeNull();
  });

  it('hides the chip when newCount is omitted', () => {
    render(<CollapsibleGroup title="Vs Legends Jun 6" count={3} />);
    expect(screen.queryByText(/\bnew\b/)).toBeNull();
  });
});

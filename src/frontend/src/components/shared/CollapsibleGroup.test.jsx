import { describe, it, expect } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

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

// T6290: the poster-first-load-batch concern (10 posters firing during boot) is
// bounded structurally here — a COLLAPSED group never mounts its children, so a
// draft tile (and therefore its lazy poster <img>) in a collapsed group issues
// zero network requests until the user expands it. Combined with DraftTile's
// loading="lazy" for the tiles that DO mount, offscreen posters are never fetched
// on first paint. This guards that "children only exist while expanded" invariant.
describe('CollapsibleGroup — children mount only while expanded (T6290)', () => {
  it('does NOT mount children when collapsed (defaultExpanded=false)', () => {
    render(
      <CollapsibleGroup title="Vs Legends Jun 6" count={1} defaultExpanded={false}>
        <div data-testid="child-poster-tile">tile</div>
      </CollapsibleGroup>
    );
    expect(screen.queryByTestId('child-poster-tile')).toBeNull();
  });

  it('mounts children when expanded by default (defaultExpanded=true)', () => {
    render(
      <CollapsibleGroup title="Vs Legends Jun 6" count={1} defaultExpanded>
        <div data-testid="child-poster-tile">tile</div>
      </CollapsibleGroup>
    );
    expect(screen.getByTestId('child-poster-tile')).toBeTruthy();
  });

  it('mounts children only after the user expands a collapsed group', () => {
    render(
      <CollapsibleGroup title="Vs Legends Jun 6" count={1} defaultExpanded={false}>
        <div data-testid="child-poster-tile">tile</div>
      </CollapsibleGroup>
    );
    expect(screen.queryByTestId('child-poster-tile')).toBeNull();
    fireEvent.click(screen.getByTestId('collapsible-group-header'));
    expect(screen.getByTestId('child-poster-tile')).toBeTruthy();
  });
});

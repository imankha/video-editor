import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClipListItem } from './ClipListItem';

// T4080: the row renders the in-match soccer time when provided, and omits it
// (gracefully) when absent — e.g. recap mode passes no gameClock.
describe('ClipListItem — in-match soccer time (T4080)', () => {
  const region = { id: 'c1', rating: 4, name: 'Great play', tags: [], notes: '' };

  it('renders the soccer clock on desktop rows', () => {
    render(<ClipListItem region={region} index={0} isSelected={false} gameClock={"34'12\""} />);
    const clock = screen.getByText("34'12\"");
    expect(clock).toBeTruthy();
    expect(clock.getAttribute('title')).toBe('Game time');
  });

  it('renders nothing time-like when gameClock is absent (recap-safe)', () => {
    render(<ClipListItem region={region} index={0} isSelected={false} />);
    expect(screen.queryByTitle('Game time')).toBeNull();
  });

  it('uses the soccer clock on mobile in place of the end time', () => {
    render(
      <ClipListItem region={{ ...region, endTime: 999 }} index={0} isSelected={false} isMobile gameClock={"7'08\""} />,
    );
    expect(screen.getByText("7'08\"")).toBeTruthy();
  });
});

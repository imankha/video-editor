import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClipListItem } from './ClipListItem';

const region = { id: 'c1', startTime: 0, endTime: 5, rating: 4, my_athlete: true, videoSequence: 2 };

describe('ClipListItem — angle source pill (T8890)', () => {
  it('shows the violet source pill when angleName is provided', () => {
    render(<ClipListItem region={region} index={0} isSelected={false} onClick={() => {}} angleName="sideline" />);
    const pill = screen.getByTestId('clip-angle-pill');
    expect(pill.textContent).toContain('sideline');
  });

  it('shows NO pill for a backbone clip (angleName null) — common case stays clean', () => {
    render(<ClipListItem region={{ ...region, videoSequence: 1 }} index={0} isSelected={false} onClick={() => {}} angleName={null} />);
    expect(screen.queryByTestId('clip-angle-pill')).toBeNull();
  });
});

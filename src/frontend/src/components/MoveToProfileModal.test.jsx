// T13630:C1 the move picker + confirm name a profile whose stored name is null as
// "Default" (same convention as ManageProfilesModal), never a blank row / "Move to ?".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MoveToProfileModal } from './MoveToProfileModal';

afterEach(cleanup);

describe('MoveToProfileModal blank-name profile (T13630)', () => {
  it('T13630:C1 lists and confirms a null-named profile as "Default"', () => {
    render(
      <MoveToProfileModal
        videoIds={[1]}
        otherProfiles={[{ id: 'p1', name: null, color: '#fff' }]}
        moving={false}
        onMove={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const row = screen.getByText('Default');
    fireEvent.click(row);
    expect(screen.getByRole('heading', { name: 'Move to Default?' })).toBeTruthy();
    expect(screen.getByText('Default', { selector: 'span.font-semibold' })).toBeTruthy();
  });
});

/**
 * T8310: the deliberate "source expired" state for the reel editors. Pins that
 * the panel tells the truth (storage expired, not a bad format) and only offers
 * the Extend affordance when the source is still extendable (a fully reclaimed,
 * past-grace source cannot be recovered, so no button).
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SourceExpiredPanel } from './SourceExpiredPanel';

function renderPanel(props) {
  return render(<SourceExpiredPanel {...props} />);
}

describe('T8310 SourceExpiredPanel', () => {
  it('renders the expired message, never a format error', () => {
    renderPanel({ canExtend: false });
    expect(screen.getByTestId('source-expired-panel')).toBeTruthy();
    expect(screen.getByText(/storage expired/i)).toBeTruthy();
    expect(screen.queryByText(/format/i)).toBeNull();
  });

  it('shows the Extend affordance when the source is extendable', () => {
    renderPanel({ canExtend: true });
    expect(screen.getByTestId('source-expired-extend')).toBeTruthy();
  });

  it('hides the Extend affordance when the source is past recovery', () => {
    renderPanel({ canExtend: false });
    expect(screen.queryByTestId('source-expired-extend')).toBeNull();
    expect(screen.getByText(/no longer be recovered/i)).toBeTruthy();
  });
});

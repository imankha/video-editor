/**
 * T13660: a successful Add footage charges credits server-side, so the header
 * chip must refresh its balance on the attach-success gesture.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../components/GameFootagePicker', () => ({
  GameFootagePicker: ({ onFootageChange }) => (
    <button
      data-testid="picker-stub"
      onClick={() => onFootageChange({ files: [{ file: new File(['x'], 'a.mp4'), creationTime: null }], totalBytes: 1, proxies: {} })}
    />
  ),
}));
vi.mock('../../services/uploadManager', () => ({
  attachVideoToExistingGame: vi.fn(async () => ({ videos: [] })),
  UPLOAD_PHASE: { HASHING: 'hashing', ERROR: 'error' },
}));

import { AddFootageButton } from './AddFootageButton';
import { useCreditStore } from '../../stores/creditStore';
import { attachVideoToExistingGame } from '../../services/uploadManager';

describe('T13660 AddFootageButton credit refresh', () => {
  const fetchCredits = vi.fn(async () => {});
  beforeEach(() => {
    fetchCredits.mockClear();
    attachVideoToExistingGame.mockClear();
    useCreditStore.setState({ balance: 132, loaded: true, fetchCredits });
  });

  it('refreshes the credit balance after a successful attach', async () => {
    render(<AddFootageButton variant="card" gameId={2} onFootageAttached={vi.fn()} />);
    fireEvent.click(screen.getByTestId('add-footage-button'));
    fireEvent.click(screen.getByTestId('picker-stub'));
    fireEvent.click(screen.getByTestId('add-footage-submit'));
    await waitFor(() => expect(attachVideoToExistingGame).toHaveBeenCalled());
    await waitFor(() => expect(fetchCredits).toHaveBeenCalledTimes(1));
  });
});

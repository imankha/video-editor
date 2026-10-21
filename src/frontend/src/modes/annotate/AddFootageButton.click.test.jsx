/**
 * T13040: the Add footage tile (variant="card") must open the add-footage flow
 * on a real click. GameFootagePicker is stubbed (its own file-input behaviour
 * is covered elsewhere); this asserts the tile -> modal wiring.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../../components/GameFootagePicker', () => ({
  GameFootagePicker: () => <div data-testid="picker-stub" />,
}));
vi.mock('../../services/uploadManager', () => ({
  attachVideoToExistingGame: vi.fn(),
  UPLOAD_PHASE: { HASHING: 'hashing', ERROR: 'error' },
}));

import { AddFootageButton } from './AddFootageButton';

describe('T13040 AddFootageButton tile click', () => {
  it('opens the add-footage modal when the card tile is clicked', () => {
    render(<AddFootageButton variant="card" gameId={2} />);
    expect(screen.queryByTestId('add-footage-submit')).toBeNull();
    fireEvent.click(screen.getByTestId('add-footage-button'));
    expect(screen.getByTestId('add-footage-submit')).toBeTruthy();
    expect(screen.getByTestId('picker-stub')).toBeTruthy();
  });

  it('does nothing when disabled (no gameId)', () => {
    render(<AddFootageButton variant="card" gameId={null} />);
    fireEvent.click(screen.getByTestId('add-footage-button'));
    expect(screen.queryByTestId('add-footage-submit')).toBeNull();
  });
});

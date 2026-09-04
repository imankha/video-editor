import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// T8700: AttachVideoModal drives attachVideoToExistingGame for an existing game.
// The transport is mocked here — this test covers the modal's own contract:
// cost preview, gating submit on a picked file, and calling the attach helper
// with (gameId, file) on confirm.

const { attachSpy } = vi.hoisted(() => ({ attachSpy: vi.fn() }));
vi.mock('../services/uploadManager', () => ({
  attachVideoToExistingGame: attachSpy,
  UPLOAD_PHASE: {
    IDLE: 'idle', HASHING: 'hashing', PREPARING: 'preparing', UPLOADING: 'uploading',
    FINALIZING: 'finalizing', COMPLETE: 'complete', ERROR: 'error',
  },
}));

const { creditState } = vi.hoisted(() => ({ creditState: { balance: 88, loaded: true } }));
vi.mock('../stores/creditStore', () => {
  const useCreditStore = (sel) => sel(creditState);
  useCreditStore.getState = () => creditState;
  return { useCreditStore };
});

vi.mock('./shared', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { AttachVideoModal } from './AttachVideoModal';

const game = { id: 42, name: 'Vs Carlsbad SC' };

function renderModal(props = {}) {
  return render(
    <AttachVideoModal isOpen game={game} onClose={vi.fn()} onAttached={vi.fn()} {...props} />
  );
}

function pickFile(container, sizeBytes = 5 * 1024 * 1024) {
  const input = container.querySelector('input[type="file"]');
  const file = new File([new Uint8Array(sizeBytes)], 'second-half.mp4', { type: 'video/mp4' });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe('AttachVideoModal (T8700)', () => {
  beforeEach(() => {
    attachSpy.mockReset();
    attachSpy.mockResolvedValue({ videos_added: 1, upload_cost_charged: 3 });
    creditState.balance = 88;
    creditState.loaded = true;
  });

  it('renders nothing when no game is provided', () => {
    const { container } = render(<AttachVideoModal isOpen game={null} onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows the cost line + balance and the target game name', () => {
    renderModal();
    expect(screen.getByText(/keeps this video for 30 days/)).toBeTruthy();
    expect(screen.getByText(/Balance:\s*88/)).toBeTruthy();
    expect(screen.getByText(/Vs Carlsbad SC/)).toBeTruthy();
  });

  it('disables Add Video until a file is picked', () => {
    const { container } = renderModal();
    const submit = screen.getByRole('button', { name: 'Add Video' });
    expect(submit.disabled).toBe(true);
    pickFile(container);
    expect(submit.disabled).toBe(false);
  });

  it('calls attachVideoToExistingGame with the game id + file on confirm, then closes', async () => {
    const onAttached = vi.fn();
    const onClose = vi.fn();
    const { container } = renderModal({ onAttached, onClose });

    const file = pickFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'Add Video' }));

    await waitFor(() => expect(attachSpy).toHaveBeenCalledTimes(1));
    expect(attachSpy.mock.calls[0][0]).toBe(42);
    expect(attachSpy.mock.calls[0][1]).toBe(file);
    await waitFor(() => expect(onAttached).toHaveBeenCalledWith(42));
    expect(onClose).toHaveBeenCalled();
  });

  it('does not upload when the known balance is below the cost (buy-credits branch)', async () => {
    creditState.balance = 0; // below the 2-credit storage minimum
    const { container } = renderModal();
    pickFile(container);
    fireEvent.click(screen.getByRole('button', { name: 'Add Video' }));

    // The affordability pre-check short-circuits into BuyCredits — no upload fires.
    await waitFor(() => expect(attachSpy).not.toHaveBeenCalled());
  });
});

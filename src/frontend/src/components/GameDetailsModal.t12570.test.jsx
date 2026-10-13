import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

// T12570 (N24): the upload modal's close X is named and Escape closes it.

vi.mock('../stores/questStore', () => {
  const state = { recordAchievement: vi.fn() };
  const useQuestStore = (sel) => (sel ? sel(state) : state);
  useQuestStore.getState = () => state;
  return { useQuestStore };
});
vi.mock('../stores/creditStore', () => {
  const state = { balance: 88, loaded: true, fetchCredits: vi.fn() };
  const useCreditStore = (sel) => sel(state);
  useCreditStore.getState = () => state;
  return { useCreditStore };
});
vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(() => Promise.resolve({ ok: true, json: async () => ({ tournaments: [] }) })),
}));
vi.mock('./shared', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() } }));
vi.mock('./GameFootagePicker', () => ({ GameFootagePicker: () => null }));

import { GameDetailsModal } from './GameDetailsModal';

describe('GameDetailsModal close (T12570)', () => {
  it('close button has an accessible name and a 44px touch target', () => {
    render(<GameDetailsModal isOpen onClose={() => {}} onCreateGame={vi.fn()} />);
    const btn = screen.getByRole('button', { name: 'Close' });
    expect(btn.className).toContain('min-h-[44px]');
    expect(btn.className).toContain('min-w-[44px]');
  });

  it('Escape closes the modal', () => {
    const onClose = vi.fn();
    render(<GameDetailsModal isOpen onClose={onClose} onCreateGame={vi.fn()} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

// T13500: Escape closes Account Settings; every usage-history row has a plain label.

vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { AccountSettings } from './AccountSettings';
import { CreditHistoryModal } from './CreditHistoryModal';
import { useAuthStore } from '../stores/authStore';
import { useCreditStore } from '../stores/creditStore';

describe('T13500', () => {
  beforeEach(() => {
    apiFetch.mockReset();
    useCreditStore.setState({ balance: 10, loaded: true });
  });

  it('T13500:C1 Escape closes Account Settings', () => {
    useAuthStore.setState({ showAccountSettings: true, email: 'a@b.com', googleLinked: false });
    render(<AccountSettings />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useAuthStore.getState().showAccountSettings).toBe(false);
  });

  it('T13500:C2 usage history labels are capitalised plain language', async () => {
    apiFetch.mockResolvedValue({
      ok: true,
      json: async () => [
        { id: 3, amount: -5, source: 'game_video_add', created_at: '2026-10-01 10:00:00' },
        { id: 2, amount: -5, source: 'clip_upload', created_at: '2026-10-01 10:00:00' },
        { id: 1, amount: 80, source: 'new_account_bonus', created_at: '2026-10-01 10:00:00' },
      ],
    });
    render(<CreditHistoryModal onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('Footage added to a game')).toBeTruthy());
    expect(screen.getByText('Clip upload')).toBeTruthy();
    expect(screen.getByText('Signup bonus')).toBeTruthy();
  });
});

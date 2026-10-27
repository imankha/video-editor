import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('../config', () => ({ API_BASE: '' }));
vi.mock('../utils/googleAuth', () => ({
  onGisReady: () => () => {},
  getLastAuthError: () => null,
  clearLastAuthError: () => {},
  onAuthError: () => () => {},
}));
vi.mock('./ReportProblemButton', () => ({ ReportProblemButton: () => null }));

import { AuthGateModal } from './AuthGateModal';
import { useAuthStore } from '../stores/authStore';
import { writePendingOtp, readPendingOtp } from '../utils/otpFlow';

describe('T13470: AuthGateModal reopen starts at the email step', () => {
  beforeEach(() => {
    cleanup();
    apiFetch.mockReset();
    apiFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });
    sessionStorage.clear();
    useAuthStore.setState({ showAuthModal: true });
  });

  it('closing the modal after Send Code drops the pending code step', async () => {
    render(<AuthGateModal />);
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'old@x.com' } });
    fireEvent.click(screen.getByText('Send Code'));
    await screen.findByText(/6-digit code/i);

    act(() => useAuthStore.setState({ showAuthModal: false }));
    act(() => useAuthStore.setState({ showAuthModal: true }));

    expect(screen.queryByText(/6-digit code/i)).toBeNull();
    expect(screen.getByLabelText(/email address/i).value).toBe('');
  });

  it('mounting with the modal closed leaves a pending code step alone (SignInScreen restores it)', () => {
    useAuthStore.setState({ showAuthModal: false });
    writePendingOtp('a@b.com');
    render(<AuthGateModal />);
    expect(readPendingOtp()?.email).toBe('a@b.com');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('./Logo', () => ({ LogoWithText: () => <div /> }));
vi.mock('./auth/OtpAuthForm', () => ({ OtpAuthForm: () => <div /> }));
vi.mock('../utils/googleAuth', () => ({
  onGisReady: () => () => {},
  getLastAuthError: () => null,
  clearLastAuthError: () => {},
  onAuthError: () => () => {},
  onAuthPending: () => () => {},
  logSignInEnvironment: () => {},
}));

import { SignInScreen } from './SignInScreen';
import { useAuthStore } from '../stores/authStore';

describe('T13090: session-ended state', () => {
  it('sign-in card shows no signed-out explanation even when the session ended', () => {
    useAuthStore.setState({ sessionEnded: true, authError: null });
    const { container } = render(<SignInScreen />);
    expect(container.textContent).not.toMatch(/signed out because/i);
    useAuthStore.setState({ sessionEnded: false });
  });

  it('T13090:C1 cold load with a prior-session marker flags sessionEnded; without it does not', () => {
    localStorage.setItem('rb_had_session', '1');
    useAuthStore.getState().setSessionState(false);
    expect(useAuthStore.getState().sessionEnded).toBe(true);
    useAuthStore.setState({ sessionEnded: false });
    localStorage.removeItem('rb_had_session');
    useAuthStore.getState().setSessionState(false);
    expect(useAuthStore.getState().sessionEnded).toBe(false);
  });
});

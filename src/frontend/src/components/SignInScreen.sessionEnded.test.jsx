import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

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
import { SESSION_ENDED_NOTICE } from '../config/displayNames';

describe('T13090: SignInScreen session-ended notice', () => {
  beforeEach(() => {
    useAuthStore.setState({ sessionEnded: false, authError: null });
  });

  it('T13090:C1 shows the explanation line when the session ended', () => {
    useAuthStore.setState({ sessionEnded: true });
    render(<SignInScreen />);
    expect(screen.getByText(SESSION_ENDED_NOTICE)).toBeTruthy();
  });

  it('T13090:C2 shows no such line on a fresh sign-in', () => {
    render(<SignInScreen />);
    expect(screen.queryByText(SESSION_ENDED_NOTICE)).toBeNull();
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

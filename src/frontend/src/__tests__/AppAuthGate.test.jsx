import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// Mock authStore so we can drive isAuthenticated / isCheckingSession per test.
const mockState = {
  isAuthenticated: false,
  isCheckingSession: true,
};

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector) => selector(mockState),
}));

// Mock LoginScreen to a simple sentinel — we just want to verify the gate picks it.
vi.mock('../components/LoginScreen', () => ({
  LoginScreen: () => <div data-testid="login-screen">LOGIN</div>,
}));

import { AppAuthGate } from '../components/AppAuthGate';

describe('AppAuthGate', () => {
  beforeEach(() => {
    mockState.isAuthenticated = false;
    mockState.isCheckingSession = true;
  });

  it('renders loading spinner (not LoginScreen, not children) while session is being checked', () => {
    mockState.isCheckingSession = true;
    mockState.isAuthenticated = false;
    render(
      <AppAuthGate>
        <div data-testid="app-children">APP</div>
      </AppAuthGate>
    );
    expect(screen.queryByTestId('login-screen')).toBeNull();
    expect(screen.queryByTestId('app-children')).toBeNull();
    expect(screen.getByTestId('auth-gate-loading')).toBeTruthy();
  });

  it('renders LoginScreen when session-check is done and user is not authenticated', () => {
    mockState.isCheckingSession = false;
    mockState.isAuthenticated = false;
    render(
      <AppAuthGate>
        <div data-testid="app-children">APP</div>
      </AppAuthGate>
    );
    expect(screen.getByTestId('login-screen')).toBeTruthy();
    expect(screen.queryByTestId('app-children')).toBeNull();
  });

  it('renders children (the editor app) when session-check is done and user is authenticated', () => {
    mockState.isCheckingSession = false;
    mockState.isAuthenticated = true;
    render(
      <AppAuthGate>
        <div data-testid="app-children">APP</div>
      </AppAuthGate>
    );
    expect(screen.getByTestId('app-children')).toBeTruthy();
    expect(screen.queryByTestId('login-screen')).toBeNull();
  });
});

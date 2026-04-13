import { render, screen } from '@testing-library/react';
import { vi, describe, it, expect } from 'vitest';

vi.mock('../stores/authStore', () => ({
  useAuthStore: (selector) => selector({
    onAuthSuccess: vi.fn(),
  }),
}));

import { LoginScreen } from '../components/LoginScreen';

describe('LoginScreen', () => {
  it('renders a Google sign-in button slot and an OTP email input', () => {
    render(<LoginScreen />);
    // Google button is rendered into a container by GIS at runtime — we just
    // assert that the slot element exists.
    expect(screen.getByTestId('google-signin-slot')).toBeTruthy();
    // OTP email input should be present on initial (email) step.
    expect(screen.getByPlaceholderText(/email/i)).toBeTruthy();
  });
});

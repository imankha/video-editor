import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('./SignInScreen', () => ({ SignInScreen: () => <div>REAL_SIGN_IN</div> }));
vi.mock('../utils/devAccounts', () => ({ loginAsDevPreset: vi.fn() }));

import DevAuthWall from './DevAuthWall';
import { useDevAccountStore } from '../stores/devAccountStore';

const presets = [
  { id: 'empty', label: 'Empty', description: 'nothing', available: true },
  { id: 'full', label: 'Full', description: 'lots', available: false, unavailable_reason: 'template missing' },
];

describe('DevAuthWall', () => {
  beforeEach(() => {
    useDevAccountStore.setState({ presets: null, stackId: null, error: null, pendingPreset: null, useRealSignIn: false });
  });

  it('shows SignInScreen when probe returned nothing', () => {
    render(<DevAuthWall />);
    expect(screen.getByText('REAL_SIGN_IN')).toBeTruthy();
  });

  it('shows picker when presets set; unavailable card disabled with reason', () => {
    useDevAccountStore.getState().setFromProbe({ presets, stackId: 's' });
    render(<DevAuthWall />);
    expect(screen.queryByText('REAL_SIGN_IN')).toBeNull();
    expect(screen.getByText('template missing')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Full/ }).disabled).toBe(true);
    expect(screen.getByRole('button', { name: /Empty/ }).disabled).toBe(false);
  });

  it('real sign-in link shows SignInScreen', () => {
    useDevAccountStore.getState().setFromProbe({ presets, stackId: 's' });
    render(<DevAuthWall />);
    fireEvent.click(screen.getByText(/real sign-in/i));
    expect(screen.getByText('REAL_SIGN_IN')).toBeTruthy();
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// T16660: /admin used to render the whole Admin Panel (filters, roadmap line, build id) for any
// signed-in account and fire its /api/admin/* data requests, which the server refuses with 403.
// The gate shows nothing until GET /api/admin/me has answered, and a not-available screen to a
// non-admin, so AdminScreen (and its requests) never mounts for one.

vi.mock('../../config', () => ({ API_BASE: '' }));
vi.mock('../../utils/sessionInit', () => ({
  getUserId: vi.fn(() => null),
  setUserId: vi.fn(),
  resetSession: vi.fn(),
  clearProfileHeader: vi.fn(),
  applyUrlProfile: vi.fn(),
}));
vi.mock('../../utils/analytics', () => ({ track: vi.fn() }));

import { useAuthStore } from '../../stores/authStore';
import { AdminGate } from './AdminGate';

const AdminPanel = () => <div>Admin Panel</div>;

beforeEach(() => {
  useAuthStore.setState({ isAdmin: false, adminChecked: false });
});

describe('AdminGate (T16660)', () => {
  it('renders nothing while the admin check has not answered', () => {
    const { container } = render(<AdminGate onHome={vi.fn()}><AdminPanel /></AdminGate>);
    expect(screen.queryByText('Admin Panel')).toBeNull();
    expect(container.textContent).toBe('');
  });

  it('shows a not-available screen, not the admin panel, to a non-admin', () => {
    const onHome = vi.fn();
    useAuthStore.setState({ isAdmin: false, adminChecked: true });
    render(<AdminGate onHome={onHome}><AdminPanel /></AdminGate>);
    expect(screen.queryByText('Admin Panel')).toBeNull();
    expect(screen.getByTestId('admin-not-available')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /home/i }));
    expect(onHome).toHaveBeenCalledTimes(1);
  });

  it('T16660:C3 an admin still sees the Admin Panel', () => {
    useAuthStore.setState({ isAdmin: true, adminChecked: true });
    render(<AdminGate onHome={vi.fn()}><AdminPanel /></AdminGate>);
    expect(screen.getByText('Admin Panel')).toBeTruthy();
  });
});

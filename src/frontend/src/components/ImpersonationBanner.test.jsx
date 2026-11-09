import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';

import ImpersonationBanner from './ImpersonationBanner';
import { useAuthStore } from '../stores/authStore';

// T14990: "Reopen their page" offers the point the admin landed on at the start
// of THIS impersonation session (startImpersonation's sessionStorage snapshot).
describe('ImpersonationBanner "Reopen their page" (T14990)', () => {
  beforeEach(() => {
    sessionStorage.clear();
    useAuthStore.setState({ impersonator: { email: 'admin@test.local' }, email: 'user@test.local' });
  });

  it('renders nothing when not impersonating', () => {
    useAuthStore.setState({ impersonator: null });
    const { container } = render(<ImpersonationBanner />);
    expect(container.firstChild).toBeNull();
  });

  it('offers "Reopen their page" linking to the snapshot when one exists', () => {
    sessionStorage.setItem(
      'rb_impersonation_landing_point',
      JSON.stringify({ path: '/focus/p/8124', profile_id: 'prof-a', profile_name: 'Lucas', t: 37 }),
    );
    render(<ImpersonationBanner />);
    const link = screen.getByTestId('reopen-their-page');
    expect(link.textContent).toContain('Reopen their page');
    expect(link.getAttribute('href')).toBe('/focus/p/8124?profile=prof-a&t=37');
  });

  it('omits the link when impersonation landed on / with no point', () => {
    render(<ImpersonationBanner />);
    expect(screen.queryByTestId('reopen-their-page')).toBeNull();
  });
});

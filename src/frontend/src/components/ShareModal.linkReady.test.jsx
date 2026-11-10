// T15500: once 'Anyone with the link' mints a public link and no emails have
// been added, the footer's primary action must be an enabled Copy-link
// button, not the permanently-disabled "Share" button (which only fires when
// emails are present). Staying disabled here is exactly the staging bug
// (link ready, footer looks stuck for 30+s).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(async (url, opts) => {
    const u = String(url);
    if (u.includes('/contacts')) return { ok: true, json: async () => ({ contacts: [] }) };
    if (u.endsWith('/shares')) return { ok: true, json: async () => [] };
    if (opts?.method === 'POST' && u.endsWith('/share')) {
      return { ok: true, json: async () => ({ shares: [{ share_token: 'tok123', is_public: true }] }) };
    }
    return { ok: true, json: async () => ([]) };
  }),
}));
vi.mock('./shared/UserPicker', () => ({ UserPicker: () => null }));
vi.mock('./shared/Toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import { ShareModal } from './ShareModal';

afterEach(cleanup);

describe('ShareModal link-ready primary action (T15500)', () => {
  it('T15500:C1 footer primary becomes an enabled Copy link action once the public link is ready', async () => {
    render(<ShareModal videoId={1} videoName="Reel" hasIntroPhoto={false} onClose={() => {}} />);

    const open = screen.getByRole('button', { name: /Anyone with the link/ });
    fireEvent.click(open);

    await waitFor(() => {
      expect(screen.getByTestId('share-modal-submit')).toBeTruthy();
    });

    const primary = screen.getByTestId('share-modal-submit');
    expect(primary.textContent).toContain('Copy link');
    expect(primary.hasAttribute('disabled')).toBe(false);
    expect(screen.queryByRole('button', { name: /^Share$/ })).toBeNull();
  });
});

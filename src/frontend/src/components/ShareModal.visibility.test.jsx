// T12210: the visibility control says what the default is and what each state
// means (qa-35) -- a labelled two-option control, 'Only people I add' selected.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

vi.mock('../utils/apiFetch', () => ({
  default: vi.fn(async (url) => ({
    ok: true,
    json: async () => (String(url).includes('/contacts') ? { contacts: [] } : []),
  })),
}));
vi.mock('./shared/UserPicker', () => ({ UserPicker: () => null }));
vi.mock('./shared/Toast', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

import { ShareModal } from './ShareModal';

afterEach(cleanup);

describe('ShareModal visibility control (T12210)', () => {
  it('T12210:C1 shows "Who can watch" with both options and the default selected', () => {
    render(<ShareModal videoId={1} videoName="Reel" hasIntroPhoto={false} onClose={() => {}} />);

    expect(screen.getByText('Who can watch')).toBeTruthy();
    const restricted = screen.getByRole('button', { name: /Only people I add/ });
    const open = screen.getByRole('button', { name: /Anyone with the link/ });
    expect(restricted.getAttribute('aria-pressed')).toBe('true');
    expect(open.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Only the people you add can watch.')).toBeTruthy();

    fireEvent.click(open);
    expect(screen.getByRole('button', { name: /Anyone with the link/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Anyone with the link can watch. Creating a link does not send it.')).toBeTruthy();
  });
});

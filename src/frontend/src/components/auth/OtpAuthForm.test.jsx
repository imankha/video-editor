import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('../../config', () => ({ API_BASE: '' }));

import { OtpAuthForm } from './OtpAuthForm';

const ok = (body = {}) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });

async function sendCode() {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'a@b.com' } });
  fireEvent.click(screen.getByText('Send Code'));
  await screen.findByText(/6-digit code/i);
}

// A real browser fires BOTH the React onChange and onInput handlers from ONE
// native input event, against the same (stale) props.
function type(input, ch) {
  fireEvent.input(input, { target: { value: ch } });
}

describe('T13470: OtpAuthForm', () => {
  beforeEach(() => {
    cleanup();
    apiFetch.mockReset();
    sessionStorage.clear();
  });

  it('T13470:C2 typing six digits makes exactly one verify request', async () => {
    apiFetch.mockImplementation((url) =>
      url.includes('verify-otp') ? ok({ email: 'a@b.com', user_id: 'u1' }) : ok());
    render(<OtpAuthForm resetKey="k" />);
    await sendCode();
    const inputs = screen.getAllByRole('textbox').filter((i) => i.maxLength === 1);
    '123456'.split('').forEach((d, i) => type(inputs[i], d));
    await waitFor(() => expect(apiFetch.mock.calls.filter(([u]) => u.includes('verify-otp')).length).toBeGreaterThan(0));
    expect(apiFetch.mock.calls.filter(([u]) => u.includes('verify-otp')).length).toBe(1);
  });

  it('T13470:C1 code step survives a remount after Send Code', async () => {
    apiFetch.mockImplementation(() => ok());
    const first = render(<OtpAuthForm resetKey="k" />);
    await sendCode();
    first.unmount();
    render(<OtpAuthForm resetKey="k" />);
    expect(screen.getByText(/6-digit code/i)).toBeTruthy();
    expect(screen.getByText('a@b.com')).toBeTruthy();
  });
  it('T13470:C2 pasting a six-digit code makes exactly one verify request', async () => {
    apiFetch.mockImplementation((url) =>
      url.includes('verify-otp') ? ok({ email: 'a@b.com', user_id: 'u1' }) : ok());
    render(<OtpAuthForm resetKey="k" />);
    await sendCode();
    const inputs = screen.getAllByRole('textbox').filter((i) => i.maxLength === 1);
    fireEvent.paste(inputs[0], { clipboardData: { getData: () => '123456' } });
    await waitFor(() => expect(apiFetch.mock.calls.filter(([u]) => u.includes('verify-otp')).length).toBeGreaterThan(0));
    const calls = apiFetch.mock.calls.filter(([u]) => u.includes('verify-otp'));
    expect(calls.length).toBe(1);
    expect(JSON.parse(calls[0][1].body).code).toBe('123456');
  });
});

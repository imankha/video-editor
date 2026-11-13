import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('../../config', () => ({ API_BASE: '' }));

import { OtpAuthForm } from './OtpAuthForm';

const ok = (body = {}) => Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
const failing = (status, body = {}) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });

async function sendCode() {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'a@b.com' } });
  fireEvent.click(screen.getByText('Send code'));
  await screen.findByText(/6-digit code/i);
}

// A real browser fires BOTH the React onChange and onInput handlers from ONE
// native input event, against the same (stale) props.
function type(input, ch) {
  fireEvent.input(input, { target: { value: ch } });
}

function codeInputs() {
  return screen.getAllByRole('textbox').filter((i) => i.maxLength === 1);
}

describe('T15540: OtpAuthForm wrong code', () => {
  beforeEach(() => {
    cleanup();
    apiFetch.mockReset();
    sessionStorage.clear();
  });

  it('T15540:C1 an invalid code clears the boxes and refocuses the first one', async () => {
    apiFetch.mockImplementation((url) =>
      url.includes('verify-otp') ? failing(400, { detail: 'Invalid code. 3 attempts remaining.' }) : ok());
    render(<OtpAuthForm resetKey="k" />);
    await sendCode();
    const inputs = codeInputs();
    '123456'.split('').forEach((d, i) => type(inputs[i], d));
    await screen.findByText(/invalid code/i);

    const cleared = codeInputs();
    cleared.forEach((input) => expect(input.value).toBe(''));
    await waitFor(() => expect(document.activeElement).toBe(cleared[0]));
  });

  it('T15540:C2 one fresh digit over a leftover wrong code does not re-submit a mixed code', async () => {
    let verifyCalls = 0;
    apiFetch.mockImplementation((url) => {
      if (!url.includes('verify-otp')) return ok();
      verifyCalls += 1;
      return failing(400, { detail: 'Invalid code. 3 attempts remaining.' });
    });
    render(<OtpAuthForm resetKey="k" />);
    await sendCode();
    const first = codeInputs();
    '111111'.split('').forEach((d, i) => type(first[i], d));
    await screen.findByText(/invalid code/i);
    expect(verifyCalls).toBe(1);

    // Typing one fresh digit must not immediately re-submit a code still made
    // of 5 leftover wrong digits + 1 new one.
    const retry = codeInputs();
    type(retry[0], '6');
    await new Promise((r) => setTimeout(r, 20));
    expect(verifyCalls).toBe(1);
  });
});

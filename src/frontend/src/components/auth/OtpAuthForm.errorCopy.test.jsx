import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const apiFetch = vi.fn();
vi.mock('../../utils/apiFetch', () => ({ default: (...a) => apiFetch(...a) }));
vi.mock('../../config', () => ({ API_BASE: '' }));

import { OtpAuthForm } from './OtpAuthForm';

const failing = (status, body = {}) =>
  Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) });

function submitEmail() {
  fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'a@b.com' } });
  fireEvent.click(screen.getByText('Send code'));
}

describe('T14530: OtpAuthForm error copy', () => {
  beforeEach(() => {
    cleanup();
    apiFetch.mockReset();
    sessionStorage.clear();
  });

  it('T14530:C2 a failure with no server text shows plain copy, no status code', async () => {
    apiFetch.mockImplementation(() => failing(500));
    render(<OtpAuthForm resetKey="k" />);
    submitEmail();
    const shown = await screen.findByText(/couldn't send your code/i);
    expect(shown.textContent).not.toMatch(/\d{3}/);
    expect(shown.textContent).toMatch(/try again/i);
  });

  it('T14530:C2 keeps the plain reason the server wrote for the parent', async () => {
    apiFetch.mockImplementation(() => failing(429, { detail: 'Too many codes sent. Wait a minute and try again.' }));
    render(<OtpAuthForm resetKey="k" />);
    submitEmail();
    expect(await screen.findByText('Too many codes sent. Wait a minute and try again.')).toBeTruthy();
  });

  it('T14530:C2 a dropped connection says what to do, with no dash punctuation', async () => {
    apiFetch.mockImplementation(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<OtpAuthForm resetKey="k" />);
    submitEmail();
    const shown = await screen.findByText(/check your internet/i);
    expect(shown.textContent).not.toMatch(/—|Failed to fetch/);
  });
});

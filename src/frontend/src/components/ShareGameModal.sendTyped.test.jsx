import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShareGameModal } from './ShareGameModal';

/**
 * T17220:C2 — a typed email shares without pressing Enter, and the button is
 * "Send" (never "Share with 0"). Uses the REAL UserPicker: the bug lived in its
 * Enter-only commit.
 */

vi.mock('./shared/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

let apiMock;
vi.mock('../utils/apiFetch', () => ({ default: (...args) => apiMock(...args) }));

beforeEach(() => {
  apiMock = vi.fn(async (url, opts) => {
    if (url.includes('/contacts')) return { ok: true, json: async () => ({ contacts: [] }) };
    if (url.includes('/share-preview')) return { ok: true, json: async () => ({ all_team: [], tagged: [] }) };
    if (url.endsWith('/share') && opts?.method === 'POST') {
      return { ok: true, json: async () => ({ all_sent: true, results: [] }) };
    }
    throw new Error(`unexpected ${url}`);
  });
});

const sendButton = () => screen.getByTestId('share-game-submit');
const shareCalls = () => apiMock.mock.calls.filter(([u, o]) => u.endsWith('/share') && o?.method === 'POST');

describe('ShareGameModal typed email (T17220:C2)', () => {
  it('reads "Send", disabled with no email, never "Share with 0"', () => {
    render(<ShareGameModal gameId={5} gameName="G" onClose={() => {}} />);
    expect(sendButton().getAttribute('aria-label')).toBe('Send');
    expect(sendButton().disabled).toBe(true);
    expect(screen.queryByText(/Share with/)).toBeNull();
  });

  it('typing one email then tapping Send shares it, no Enter', async () => {
    const onClose = vi.fn();
    render(<ShareGameModal gameId={5} gameName="G" onClose={onClose} />);
    const input = screen.getByPlaceholderText(/email/i);
    fireEvent.change(input, { target: { value: 'Coach@Example.com' } });
    expect(sendButton().disabled).toBe(false);
    fireEvent.click(sendButton());
    await waitFor(() => expect(shareCalls()).toHaveLength(1));
    expect(JSON.parse(shareCalls()[0][1].body)).toEqual({
      recipients: [{ email: 'coach@example.com', scope: 'all_team' }],
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('leaving the field adds the typed email as a recipient', async () => {
    render(<ShareGameModal gameId={5} gameName="G" onClose={() => {}} />);
    const input = screen.getByPlaceholderText(/email/i);
    fireEvent.change(input, { target: { value: 'gran@example.com' } });
    fireEvent.blur(input);
    expect(input.value).toBe('');
    expect(screen.getAllByText('gran@example.com').length).toBeGreaterThan(0);
    expect(sendButton().disabled).toBe(false);
  });

  it('a half-typed address does not enable Send', () => {
    render(<ShareGameModal gameId={5} gameName="G" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { value: 'gran@' } });
    expect(sendButton().disabled).toBe(true);
  });
});

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShareGameModal } from './ShareGameModal';

vi.mock('./shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./shared/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}));

vi.mock('./shared/UserPicker', () => ({
  UserPicker: ({ emails, onChange, placeholder }) => (
    <div data-testid="user-picker">
      <input
        data-testid="email-input"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target.value) {
            onChange([...emails, e.target.value]);
            e.target.value = '';
          }
        }}
      />
    </div>
  ),
}));

// Preview fixtures keyed by email.
const PREVIEW = {
  'tagged@test.com': {
    all_team: [
      { id: 1, name: 'Fast break', rating: 5, start_time: 252 },
      { id: 2, name: 'Steal', rating: 4, start_time: 707 },
    ],
    tagged: [{ id: 2, name: 'Steal', rating: 4, start_time: 707 }],
    tagged_has_mapping: true,
  },
  'untagged@test.com': {
    all_team: [{ id: 1, name: 'Fast break', rating: 5, start_time: 252 }],
    tagged: [],
    tagged_has_mapping: false,
  },
};

let apiMock;
vi.mock('../utils/apiFetch', () => ({
  default: (...args) => apiMock(...args),
}));

function defaultApiMock() {
  return vi.fn(async (url, opts) => {
    if (url.includes('/contacts')) {
      return { ok: true, json: async () => ({ contacts: [] }) };
    }
    if (url.includes('/share-preview')) {
      const email = decodeURIComponent(new URL(url, 'http://x').searchParams.get('email'));
      return { ok: true, json: async () => PREVIEW[email] };
    }
    if (url.includes('/share-link') && opts?.method === 'POST') {
      return { ok: true, json: async () => ({ path: '/shared/game/tok123' }) };
    }
    if (url.includes('/share-link') && opts?.method === 'DELETE') {
      return { ok: true, json: async () => ({ ok: true }) };
    }
    if (url.endsWith('/share') && opts?.method === 'POST') {
      return { ok: true, json: async () => ({ all_sent: true, results: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

const props = { gameId: 42, gameName: 'Warriors vs Hawks', onClose: vi.fn() };

async function addRecipient(email) {
  const input = screen.getByTestId('email-input');
  fireEvent.keyDown(input, { key: 'Enter', target: { value: email } });
  await waitFor(() => expect(screen.getByText(email)).toBeTruthy());
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMock = defaultApiMock();
  Object.assign(navigator, { clipboard: { writeText: vi.fn(async () => {}) } });
});

describe('ShareGameModal — per-recipient clip scope', () => {
  it('shows the three approved scope labels verbatim once a recipient is added', async () => {
    render(<ShareGameModal {...props} />);
    await addRecipient('tagged@test.com');

    const select = screen.getByLabelText('Clips for tagged@test.com');
    const optionLabels = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(optionLabels).toEqual([
      'All team clips',
      "Only clips they're tagged in",
      'Game only (no clips)',
    ]);
    // default selection is "All team clips"
    expect(select.value).toBe('all_team');
  });

  it('shows the collapsed clip count for the default all-team scope', async () => {
    render(<ShareGameModal {...props} />);
    await addRecipient('tagged@test.com');
    await waitFor(() => expect(screen.getByText('2 clips')).toBeTruthy());
  });

  it('expands to the clip preview list agreeing with the scope', async () => {
    render(<ShareGameModal {...props} />);
    await addRecipient('tagged@test.com');
    await waitFor(() => expect(screen.getByText('2 clips')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Show clips'));
    expect(screen.getByText('Fast break')).toBeTruthy();
    expect(screen.getByText('Steal')).toBeTruthy();
  });

  it('warns inline AND in a send-time banner when a tagged-only recipient gets 0 clips', async () => {
    render(<ShareGameModal {...props} />);
    await addRecipient('untagged@test.com');
    await waitFor(() => expect(screen.getByText('1 clip')).toBeTruthy());

    const select = screen.getByLabelText('Clips for untagged@test.com');
    fireEvent.change(select, { target: { value: 'tagged_only' } });

    // inline row warning (before send)
    await waitFor(() =>
      expect(screen.getByText(/will receive the game only/i)).toBeTruthy());
    // send-time banner (distinct copy: "no tag match ... Send anyway?")
    expect(screen.getByText(/no tag match.*Send anyway/i)).toBeTruthy();
    // send stays ENABLED (speed-bump, not a block)
    expect(screen.getByText('Share with 1').disabled).toBe(false);
  });

  it('sends the {recipients:[{email,scope}]} shape with per-recipient scope', async () => {
    render(<ShareGameModal {...props} />);
    await addRecipient('tagged@test.com');
    await waitFor(() => expect(screen.getByText('2 clips')).toBeTruthy());

    const select = screen.getByLabelText('Clips for tagged@test.com');
    fireEvent.change(select, { target: { value: 'tagged_only' } });

    fireEvent.click(screen.getByText('Share with 1'));

    await waitFor(() => {
      const call = apiMock.mock.calls.find(
        (c) => c[0].endsWith('/share') && c[1]?.method === 'POST');
      expect(call).toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body).toEqual({
        recipients: [{ email: 'tagged@test.com', scope: 'tagged_only' }],
      });
    });
  });
});

describe('ShareGameModal — general access / revoke', () => {
  it('requires a confirmation before revoking, then shows the revoked state', async () => {
    render(<ShareGameModal {...props} />);

    fireEvent.click(screen.getByText('Revoke link'));
    // confirmation shown; no DELETE fired yet
    expect(screen.getByText('Revoke this game link?')).toBeTruthy();
    expect(apiMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(false);

    // confirm (the destructive button inside the dialog)
    const dialogRevoke = screen.getAllByText('Revoke link').at(-1);
    fireEvent.click(dialogRevoke);

    await waitFor(() =>
      expect(screen.getByText(/no one can watch via a link/i)).toBeTruthy());
    expect(apiMock.mock.calls.some((c) => c[1]?.method === 'DELETE')).toBe(true);
    expect(screen.getByText('Create new link')).toBeTruthy();
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportProblemButton } from './ReportProblemButton';

// T9400: a failed send must stay recoverable -- the typed report and its
// diagnostics survive, the user can Retry, and can Copy error details (scrubbed
// of credentials) even when the reporting service is unreachable. A successful
// retry after an ambiguous failure must file exactly one report (stable
// client_report_id sent on every attempt).

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ email: 'tester@example.com' }),
}));
vi.mock('../utils/clientLogger', () => ({
  // Log lines carrying secrets in the shapes that must not leak into the
  // copied "error details" blob (key=value, Bearer token, JSON-quoted key).
  getClientLogs: () => [
    { level: 'error', message: 'auth failed session token=SUPERSECRET123', ts: 1 },
    { level: 'error', message: 'Authorization: Bearer eyJhbGci.PAYLOAD.SIGNATURE', ts: 2 },
    { level: 'error', message: '{"access_token": "ya29.LEAKYTOKEN", "session_id": "SID999"}', ts: 3 },
  ],
  clearClientLogs: vi.fn(),
}));
vi.mock('../utils/analytics', () => ({ getActionLog: () => [] }));
vi.mock('../utils/editorContext', () => ({ getEditorContext: () => ({}) }));
vi.mock('html2canvas', () => ({ default: () => { throw new Error('no canvas in jsdom'); } }));

// apiFetch is the send path -- control it per test.
const apiFetchMock = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => apiFetchMock(...args) }));

beforeEach(() => {
  apiFetchMock.mockReset();
});

async function openAndType(text = 'quest completion never fired') {
  render(<ReportProblemButton />);
  fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
  const textarea = await waitFor(() => screen.getByPlaceholderText(/what went wrong/i));
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

async function sendAndFail() {
  // A network failure surfaces as a TypeError from fetch.
  apiFetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
  fireEvent.click(screen.getByRole('button', { name: /send report/i }));
  await waitFor(() => screen.getByText(/report not sent/i));
}

describe('ReportProblemButton failure recovery (T9400)', () => {
  it('keeps the typed report visible and editable after a failed send', async () => {
    await openAndType('quest completion never fired');
    await sendAndFail();

    // The textarea (with its text) must still be mounted -- not replaced by a
    // dead-end "Try again" view.
    const stillThere = screen.getByPlaceholderText(/what went wrong/i);
    expect(stillThere).toBeTruthy();
    expect(stillThere.value).toBe('quest completion never fired');
  });

  it('offers Retry report and Copy error details on failure', async () => {
    await openAndType();
    await sendAndFail();

    expect(screen.getByRole('button', { name: /retry report/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /copy error details/i })).toBeTruthy();
  });

  it('Copy error details shows a preview that scrubs session tokens', async () => {
    await openAndType();
    await sendAndFail();

    fireEvent.click(screen.getByRole('button', { name: /copy error details/i }));
    const preview = await waitFor(() => screen.getByLabelText(/error details preview/i));
    expect(preview).toBeTruthy();
    // None of the secret values may appear verbatim, across all three shapes.
    expect(preview.value).not.toContain('SUPERSECRET123');       // key=value
    expect(preview.value).not.toContain('eyJhbGci.PAYLOAD.SIGNATURE'); // Bearer token
    expect(preview.value).not.toContain('ya29.LEAKYTOKEN');      // JSON-quoted access_token
    expect(preview.value).not.toContain('SID999');               // JSON-quoted session_id
    expect(preview.value.toLowerCase()).toContain('redacted');
  });

  it('sends the same client_report_id on the first attempt and the retry (exactly-once dedup)', async () => {
    await openAndType();
    await sendAndFail();

    // Retry succeeds this time.
    apiFetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ sent: true, bug_id: 1 }) });
    fireEvent.click(screen.getByRole('button', { name: /retry report/i }));
    await waitFor(() => screen.getByText(/report sent/i));

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(apiFetchMock.mock.calls[1][1].body);
    expect(firstBody.client_report_id).toBeTruthy();
    expect(secondBody.client_report_id).toBe(firstBody.client_report_id);
  });
});

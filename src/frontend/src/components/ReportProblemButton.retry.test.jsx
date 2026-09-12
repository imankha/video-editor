import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportProblemButton } from './ReportProblemButton';

// T9690: durable failure-path net for T9400's report retry/dedup. These inject a
// REAL failure on the send path (an HTTP 5xx rejection, an in-flight second click)
// and assert the client's actual recovery: the typed report survives, a retry
// reuses the SAME client_report_id (so the backend files exactly one row), and a
// double-click can never open two concurrent sends. The failing send is never
// stubbed into succeeding -- the injected failure is what the assertions ride on.

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ email: 'tester@example.com' }),
}));
vi.mock('../utils/clientLogger', () => ({
  getClientLogs: () => [],
  clearClientLogs: vi.fn(),
}));
vi.mock('../utils/analytics', () => ({ getActionLog: () => [] }));
vi.mock('../utils/editorContext', () => ({ getEditorContext: () => ({}) }));
vi.mock('html2canvas', () => ({ default: () => { throw new Error('no canvas in jsdom'); } }));

const apiFetchMock = vi.fn();
vi.mock('../utils/apiFetch', () => ({ default: (...args) => apiFetchMock(...args) }));

beforeEach(() => {
  apiFetchMock.mockReset();
});

async function openAndType(text) {
  render(<ReportProblemButton />);
  fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
  const textarea = await waitFor(() => screen.getByPlaceholderText(/what went wrong/i));
  fireEvent.change(textarea, { target: { value: text } });
  return textarea;
}

describe('ReportProblemButton retry/dedup failure paths (T9690)', () => {
  it('preserves the report and reuses the client_report_id after an HTTP 5xx rejection', async () => {
    const text = 'crop editor froze on the second clip';
    await openAndType(text);

    // INJECTED FAILURE: the server rejects the first send with a 503 (the
    // res.ok === false branch, distinct from a network TypeError).
    apiFetchMock.mockResolvedValueOnce({
      ok: false,
      status: 503,
      url: '/api/auth/report-problem',
      json: async () => ({ detail: 'backend error -- check server logs' }),
    });
    fireEvent.click(screen.getByRole('button', { name: /send report/i }));
    await waitFor(() => screen.getByText(/report not sent/i));

    // Content preserved and editable -- not a dead-end that discards the message.
    const textarea = screen.getByPlaceholderText(/what went wrong/i);
    expect(textarea.value).toBe(text);

    // Retry succeeds this time.
    apiFetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ sent: true, bug_id: 7 }) });
    fireEvent.click(screen.getByRole('button', { name: /retry report/i }));
    await waitFor(() => screen.getByText(/report sent/i));

    // Exactly one retry, and the idempotency key is stable across both attempts so
    // the backend's ON CONFLICT files exactly one row.
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(apiFetchMock.mock.calls[0][1].body);
    const secondBody = JSON.parse(apiFetchMock.mock.calls[1][1].body);
    expect(firstBody.client_report_id).toBeTruthy();
    expect(secondBody.client_report_id).toBe(firstBody.client_report_id);
    expect(secondBody.description).toBe(text);
  });

  it('a double-clicked Send opens only one in-flight request', async () => {
    await openAndType('double click should not double-file');

    // INJECTED CONDITION: the first send is in flight (unresolved) when the user
    // clicks again. The button is disabled while state === 'sending', so the
    // second click must not open a second concurrent request.
    let resolveSend;
    apiFetchMock.mockImplementationOnce(
      () => new Promise((resolve) => { resolveSend = resolve; }),
    );

    const sendBtn = screen.getByRole('button', { name: /send report/i });
    fireEvent.click(sendBtn);
    await waitFor(() => screen.getByRole('button', { name: /sending/i }));

    // Second click while the first is still pending.
    fireEvent.click(screen.getByRole('button', { name: /sending/i }));

    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    // Let the in-flight send resolve so the test ends cleanly.
    resolveSend({ ok: true, json: async () => ({ sent: true, bug_id: 8 }) });
    await waitFor(() => screen.getByText(/report sent/i));
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });
});

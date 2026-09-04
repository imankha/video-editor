import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportProblemButton } from './ReportProblemButton';

// T7560: the Send button must stay disabled until there is a real (non-blank)
// description, so an empty report can never be submitted from the client.

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ email: 'tester@example.com' }),
}));
vi.mock('../utils/clientLogger', () => ({
  getClientLogs: () => [],
  clearClientLogs: vi.fn(),
}));
vi.mock('../utils/analytics', () => ({ getActionLog: () => [] }));
vi.mock('../utils/editorContext', () => ({ getEditorContext: () => ({}) }));
// Screenshot capture dynamically imports html2canvas; stub it out.
vi.mock('html2canvas', () => ({ default: () => { throw new Error('no canvas in jsdom'); } }));

async function openModal() {
  render(<ReportProblemButton />);
  fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
  // handleOpen awaits screenshot capture before opening the modal.
  return waitFor(() => screen.getByPlaceholderText(/what went wrong/i));
}

describe('ReportProblemButton client gate (T7560)', () => {
  it('disables Send until a non-empty description is typed', async () => {
    const textarea = await openModal();
    const sendBtn = screen.getByRole('button', { name: /send report/i });

    // Empty -> disabled
    expect(sendBtn.disabled).toBe(true);

    // Whitespace only -> still disabled
    fireEvent.change(textarea, { target: { value: '   \n  ' } });
    expect(sendBtn.disabled).toBe(true);

    // Real text -> enabled
    fireEvent.change(textarea, { target: { value: 'upload button did nothing' } });
    expect(sendBtn.disabled).toBe(false);

    // Cleared again -> disabled
    fireEvent.change(textarea, { target: { value: '' } });
    expect(sendBtn.disabled).toBe(true);
  });

  it('shows the gentle prompt while the description is empty', async () => {
    await openModal();
    expect(screen.getByText(/one sentence helps us fix it/i)).toBeTruthy();
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ReportProblemButton } from './ReportProblemButton';
import { CornerStack } from './shared/CornerStack';

// T13110: CornerStack is pointer-events-none (children opt back in). The open dialog
// must NOT live inside it, or real desktop mouse clicks fall through to the page behind.

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ email: 'tester@example.com' }),
}));
vi.mock('../utils/clientLogger', () => ({ getClientLogs: () => [], clearClientLogs: vi.fn() }));
vi.mock('../utils/analytics', () => ({ getActionLog: () => [] }));
vi.mock('../utils/editorContext', () => ({ getEditorContext: () => ({}) }));
vi.mock('html2canvas', () => ({ default: () => { throw new Error('no canvas in jsdom'); } }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

describe('ReportProblemButton dialog placement (T13110)', () => {
  it('renders the open dialog outside the pointer-events-none CornerStack', async () => {
    render(<CornerStack><ReportProblemButton compact /></CornerStack>);
    fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
    await waitFor(() => screen.getByPlaceholderText(/what went wrong/i));
    const modal = document.querySelector('[data-report-modal]');
    expect(modal).not.toBeNull();
    expect(modal.closest('[data-testid="corner-stack"]')).toBeNull();
  });
});

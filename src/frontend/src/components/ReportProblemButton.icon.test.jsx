import { render, screen } from '@testing-library/react';
import { ReportProblemButton } from './ReportProblemButton';

// T13910: the subscriber email tells users to click "the Report a problem icon 💬";
// the button shows that same emoji so the email and the app match on every device.

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ email: 'tester@example.com' }),
}));
vi.mock('../utils/clientLogger', () => ({ getClientLogs: () => [], clearClientLogs: vi.fn() }));
vi.mock('../utils/analytics', () => ({ getActionLog: () => [] }));
vi.mock('../utils/editorContext', () => ({ getEditorContext: () => ({}) }));
vi.mock('html2canvas', () => ({ default: () => { throw new Error('no canvas in jsdom'); } }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

describe('ReportProblemButton icon (T13910)', () => {
  it('compact button shows the speech-bubble emoji and keeps its accessible name', () => {
    render(<ReportProblemButton compact />);
    const btn = screen.getByRole('button', { name: 'Report a problem' });
    expect(btn.textContent).toBe('💬');
    expect(btn.querySelector('svg')).toBeNull();
  });

  it('text button leads with the emoji', () => {
    render(<ReportProblemButton />);
    const btn = screen.getByRole('button', { name: 'Report a problem' });
    expect(btn.textContent).toBe('💬 Report a problem');
  });
});

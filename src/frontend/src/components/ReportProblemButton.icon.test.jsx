import { render, screen } from '@testing-library/react';
import { ReportProblemButton } from './ReportProblemButton';

// T13910: the subscriber email shows the Report a problem icon as an image hosted at
// /icons/report-problem.png; the button renders that SAME file, so the email and the
// app look identical on every device (emoji fonts differ per platform).

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ email: 'tester@example.com' }),
}));
vi.mock('../utils/clientLogger', () => ({ getClientLogs: () => [], clearClientLogs: vi.fn() }));
vi.mock('../utils/analytics', () => ({ getActionLog: () => [] }));
vi.mock('../utils/editorContext', () => ({ getEditorContext: () => ({}) }));
vi.mock('html2canvas', () => ({ default: () => { throw new Error('no canvas in jsdom'); } }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

describe('ReportProblemButton icon (T13910)', () => {
  it('compact button shows the hosted speech-bubble image and keeps its accessible name', () => {
    render(<ReportProblemButton compact />);
    const btn = screen.getByRole('button', { name: 'Report a problem' });
    const img = btn.querySelector('img');
    expect(img.getAttribute('src')).toBe('/icons/report-problem.png');
    expect(img.getAttribute('aria-hidden')).toBe('true');
    expect(btn.querySelector('svg')).toBeNull();
    expect(btn.textContent).toBe('');
  });

  it('text button leads with the same image', () => {
    render(<ReportProblemButton />);
    const btn = screen.getByRole('button', { name: 'Report a problem' });
    expect(btn.querySelector('img').getAttribute('src')).toBe('/icons/report-problem.png');
    expect(btn.textContent.trim()).toBe('Report a problem');
  });
});

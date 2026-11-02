import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReportProblemButton } from './ReportProblemButton';
import { useProblemReportStore } from '../stores/problemReportStore';

// T14370: a "play not saved" toast needs to open the Report a problem form
// itself. The form used to open only from its own button.

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

describe('ReportProblemButton programmatic open (T14370)', () => {
  it('opens the form when the store asks for it', async () => {
    render(<ReportProblemButton />);
    expect(screen.queryByPlaceholderText(/what went wrong/i)).toBeNull();

    act(() => { useProblemReportStore.getState().requestOpen(); });

    await waitFor(() => screen.getByPlaceholderText(/what went wrong/i));
  });
});

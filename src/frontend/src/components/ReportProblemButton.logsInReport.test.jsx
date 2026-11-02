import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

// T14370 acceptance criterion 3: the submitted problem report carries the
// `[MarkPlay]` error line AND the console.log context before it, through the
// REAL clientLogger (not the stubbed one the other ReportProblemButton tests
// use) into the POST body. Pre-T14370 the logger did not capture console.log,
// so the `[CreateClip]` context never reached the report.

vi.mock('../stores/authStore', () => ({
  useAuthStore: (sel) => sel({ email: 'tester@example.com' }),
}));
vi.mock('../utils/analytics', () => ({ getActionLog: () => [] }));
vi.mock('../utils/editorContext', () => ({ getEditorContext: () => ({}) }));
vi.mock('html2canvas', () => ({ default: () => { throw new Error('no canvas in jsdom'); } }));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));

import apiFetch from '../utils/apiFetch';
import { installClientLogger } from '../utils/clientLogger';
import { ReportProblemButton } from './ReportProblemButton';

beforeAll(() => {
  for (const m of ['log', 'info', 'warn', 'error']) vi.spyOn(console, m).mockImplementation(() => {});
  installClientLogger();
});

describe('ReportProblemButton sends the Mark play trail (T14370)', () => {
  it('the POST body carries the console.log context and the [MarkPlay] error, in order', async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 1 }) });

    render(<ReportProblemButton />);
    fireEvent.click(screen.getByRole('button', { name: /report a problem/i }));
    const textarea = await waitFor(() => screen.getByPlaceholderText(/what went wrong/i));
    fireEvent.change(textarea, { target: { value: 'Mark play did nothing' } });

    // A long session's routine noise (more than the 300-entry routine ring),
    // then what the Mark play chain logs at the tap: its context line and the
    // failure, in the same tick.
    for (let i = 0; i < 400; i++) console.warn('[VIDEO] Suspend', i);
    console.log('[CreateClip] virtual:', 12.5, '->', 'actual:', 12.5);
    console.error('[MarkPlay] addClipRegion', { step: 'addClipRegion', gameId: 3 });

    fireEvent.click(screen.getByRole('button', { name: /send report/i }));
    await waitFor(() => screen.getByText(/thanks, we'll look into it/i));

    const call = apiFetch.mock.calls.find(([url]) => String(url).includes('/report-problem'));
    expect(call).toBeTruthy();
    const { logs } = JSON.parse(call[1].body);
    const context = logs.findIndex((l) => l.level === 'log' && l.message.startsWith('[CreateClip] virtual: 12.5'));
    const failure = logs.findIndex((l) => l.level === 'error' && l.message.startsWith('[MarkPlay] addClipRegion'));
    const shape = `${logs.length} entries; last 6: ${JSON.stringify(logs.slice(-6).map((l) => `${l.level}:${l.message.slice(0, 50)}`))}`;
    expect(failure, shape).toBeGreaterThan(-1);
    // Pre-T14370 console.log was not captured at all, so this context never
    // reached a report.
    expect(context, shape).toBeGreaterThan(-1);
    expect(context).toBeLessThan(failure);
  });
});

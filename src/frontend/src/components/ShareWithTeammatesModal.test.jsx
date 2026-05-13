import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ShareWithTeammatesModal } from './ShareWithTeammatesModal';

vi.mock('./shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

function mockFetch(responses = {}) {
  return vi.fn(async (url, opts) => {
    if (url.includes('/teammate-emails') && (!opts || opts.method !== 'PUT')) {
      const data = responses.emails ?? { Jake: [{ id: 1, email: 'mom@test.com', created_at: '2026-01-01' }] };
      return { ok: true, json: async () => data };
    }
    if (url.includes('/teammate-emails') && opts?.method === 'PUT') {
      return { ok: true, json: async () => ({}) };
    }
    if (url.includes('/share-with-teammates')) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('ShareWithTeammatesModal', () => {
  const defaultProps = {
    tagCounts: { Jake: 3, 'Player 7': 2, Alex: 1 },
    gameId: 42,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch();
  });

  it('renders header and all tag rows', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    expect(screen.getByText('Share With Teammates')).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByText('Jake')).toBeTruthy();
      expect(screen.getByText('Player 7')).toBeTruthy();
      expect(screen.getByText('Alex')).toBeTruthy();
    });
  });

  it('shows clip counts for each tag', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('(3 clips)')).toBeTruthy();
      expect(screen.getByText('(2 clips)')).toBeTruthy();
      expect(screen.getByText('(1 clip)')).toBeTruthy();
    });
  });

  it('pre-fills emails from stored mappings', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => {
      expect(screen.getByText('mom@test.com')).toBeTruthy();
    });
  });

  it('all tags are checked by default', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(3);
      checkboxes.forEach(cb => expect(cb.checked).toBe(true));
    });
  });

  it('unchecking a tag dims it and hides email input', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('Jake')).toBeTruthy());
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[0]);
    expect(checkboxes[0].checked).toBe(false);
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    render(<ShareWithTeammatesModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    const onClose = vi.fn();
    render(<ShareWithTeammatesModal {...defaultProps} onClose={onClose} />);
    const backdrop = screen.getByText('Share With Teammates').closest('.fixed');
    fireEvent.mouseDown(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('share button shows clip count for tags with emails', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => {
      const shareBtn = screen.getByRole('button', { name: /share/i });
      expect(shareBtn.textContent).toContain('3');
    });
  });

  it('share button disabled when no tags have emails', async () => {
    globalThis.fetch = mockFetch({ emails: {} });
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => {
      const shareBtn = screen.getByRole('button', { name: /share/i });
      expect(shareBtn.disabled).toBe(true);
    });
  });

  it('calls share endpoint on share click', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('mom@test.com')).toBeTruthy());
    const shareBtn = screen.getByRole('button', { name: /share/i });
    fireEvent.click(shareBtn);
    await waitFor(() => {
      const calls = globalThis.fetch.mock.calls;
      const shareCall = calls.find(c => c[0].includes('/share-with-teammates'));
      expect(shareCall).toBeTruthy();
      const body = JSON.parse(shareCall[1].body);
      expect(body.game_id).toBe(42);
      expect(body.recipients).toEqual([{ tag_name: 'Jake', emails: ['mom@test.com'] }]);
    });
  });

  it('shows success state after sharing', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => expect(screen.getByText('mom@test.com')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await waitFor(() => {
      expect(screen.getByText('Clips shared successfully')).toBeTruthy();
      expect(screen.getByRole('button', { name: /done/i })).toBeTruthy();
    });
  });

  it('saves new email mappings before sharing', async () => {
    globalThis.fetch = mockFetch({ emails: {} });
    render(<ShareWithTeammatesModal {...defaultProps} tagCounts={{ Jake: 3 }} />);
    await waitFor(() => expect(screen.queryByText('Loading email mappings...')).toBeNull());

    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'new@test.com' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await waitFor(() => {
      const calls = globalThis.fetch.mock.calls;
      const putCall = calls.find(c => c[0].includes('/teammate-emails') && c[1]?.method === 'PUT');
      expect(putCall).toBeTruthy();
      const body = JSON.parse(putCall[1].body);
      expect(body).toEqual([{ tag_name: 'Jake', email: 'new@test.com' }]);
    });
  });
});

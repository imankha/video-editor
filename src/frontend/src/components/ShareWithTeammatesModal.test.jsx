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
    if (url.includes('/share-with-teammates') && opts?.method === 'POST') {
      const body = JSON.parse(opts.body);
      const results = body.recipients.map(r => ({
        tag_name: r.tag_name,
        status: 'sent',
        emails: r.emails.map(e => ({ email: e, sent: true })),
      }));
      const sentTags = results.map(r => r.tag_name);
      return { ok: true, json: async () => ({ results, sent_tags: sentTags, failed_tags: [] }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

// sharedTagData maps a tag -> Set of already-shared clip ids. Helper builds it from arrays.
function sharedData(map = {}) {
  return Object.fromEntries(Object.entries(map).map(([tag, ids]) => [tag, new Set(ids)]));
}

describe('ShareWithTeammatesModal', () => {
  // tagClipIds gives each tagged teammate the raw clip ids that make up its count.
  const defaultProps = {
    tagCounts: { Jake: 3, 'Player 7': 2, Alex: 1 },
    tagClipIds: { Jake: [1, 2, 3], 'Player 7': [4, 5], Alex: [6] },
    gameId: 42,
    sharedTagData: {},
    onClose: vi.fn(),
    onSharedTagsChange: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetch();
  });

  it('renders header and all unsent tag rows', async () => {
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

  it('unsent tags are checked by default', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => {
      const checkboxes = screen.getAllByRole('checkbox');
      expect(checkboxes).toHaveLength(3);
      checkboxes.forEach(cb => expect(cb.checked).toBe(true));
    });
  });

  it('shows already-shared tags in a separate section', async () => {
    // All of Jake's clips already shared -> Jake is a "sent" tag.
    render(<ShareWithTeammatesModal {...defaultProps} sharedTagData={sharedData({ Jake: [1, 2, 3] })} />);
    await waitFor(() => {
      expect(screen.getByText('Already shared')).toBeTruthy();
      expect(screen.getByText('Not yet shared')).toBeTruthy();
    });
  });

  it('already-shared tags have no checkbox', async () => {
    render(
      <ShareWithTeammatesModal
        {...defaultProps}
        sharedTagData={sharedData({ Jake: [1, 2, 3], 'Player 7': [4, 5], Alex: [6] })}
      />
    );
    await waitFor(() => {
      expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
      expect(screen.getByText('All tagged teammates have been shared with')).toBeTruthy();
    });
  });

  it('closes on Escape key', async () => {
    const onClose = vi.fn();
    render(<ShareWithTeammatesModal {...defaultProps} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('does not close on backdrop click (no accidental dismiss)', async () => {
    const onClose = vi.fn();
    render(<ShareWithTeammatesModal {...defaultProps} onClose={onClose} />);
    const backdrop = screen.getByText('Share With Teammates').closest('.fixed');
    fireEvent.mouseDown(backdrop);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('share button shows clip count for checked unsent tags with emails', async () => {
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => {
      const shareBtn = screen.getByRole('button', { name: /share/i });
      expect(shareBtn.textContent).toContain('3');
    });
  });

  it('share button disabled when no unsent tags have emails', async () => {
    globalThis.fetch = mockFetch({ emails: {} });
    render(<ShareWithTeammatesModal {...defaultProps} />);
    await waitFor(() => {
      const shareBtn = screen.getByRole('button', { name: /share/i });
      expect(shareBtn.disabled).toBe(true);
    });
  });

  it('calls share endpoint, updates sharedTagData, and closes on success', async () => {
    const onSharedTagsChange = vi.fn();
    const onClose = vi.fn();
    render(<ShareWithTeammatesModal {...defaultProps} onSharedTagsChange={onSharedTagsChange} onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('mom@test.com')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await waitFor(() => {
      const calls = globalThis.fetch.mock.calls;
      const shareCall = calls.find(c => c[0].includes('/share-with-teammates'));
      expect(shareCall).toBeTruthy();
      const body = JSON.parse(shareCall[1].body);
      expect(body.game_id).toBe(42);
      expect(body.recipients).toEqual([{ tag_name: 'Jake', emails: ['mom@test.com'] }]);
    });
    await waitFor(() => {
      expect(onSharedTagsChange).toHaveBeenCalled();
      // onSharedTagsChange receives the updated tag -> Set(clipIds) map.
      const updated = onSharedTagsChange.mock.calls.at(-1)[0];
      expect(updated.Jake).toBeInstanceOf(Set);
      expect([...updated.Jake].sort((a, b) => a - b)).toEqual([1, 2, 3]);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it('saves new email mappings before sharing', async () => {
    globalThis.fetch = mockFetch({ emails: {} });
    render(<ShareWithTeammatesModal {...defaultProps} tagCounts={{ Jake: 3 }} tagClipIds={{ Jake: [1, 2, 3] }} />);
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

  it('excludes already-shared tags from share request', async () => {
    globalThis.fetch = mockFetch({
      emails: {
        Jake: [{ id: 1, email: 'mom@test.com', created_at: '2026-01-01' }],
        'Player 7': [{ id: 2, email: 'dad@test.com', created_at: '2026-01-01' }],
      },
    });
    const onSharedTagsChange = vi.fn();
    render(
      <ShareWithTeammatesModal
        {...defaultProps}
        sharedTagData={sharedData({ Jake: [1, 2, 3] })}
        onSharedTagsChange={onSharedTagsChange}
      />
    );
    await waitFor(() => expect(screen.getByText('dad@test.com')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await waitFor(() => {
      const calls = globalThis.fetch.mock.calls;
      const shareCall = calls.find(c => c[0].includes('/share-with-teammates'));
      const body = JSON.parse(shareCall[1].body);
      const tagNames = body.recipients.map(r => r.tag_name);
      expect(tagNames).not.toContain('Jake');
      expect(tagNames).toContain('Player 7');
    });
  });

  it('closes modal and does not update sharedTagData when all emails fail', async () => {
    globalThis.fetch = vi.fn(async (url, opts) => {
      if (url.includes('/teammate-emails') && (!opts || opts.method !== 'PUT')) {
        return { ok: true, json: async () => ({ Jake: [{ id: 1, email: 'mom@test.com', created_at: '2026-01-01' }] }) };
      }
      if (url.includes('/teammate-emails') && opts?.method === 'PUT') {
        return { ok: true, json: async () => ({}) };
      }
      if (url.includes('/share-with-teammates') && opts?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            results: [{ tag_name: 'Jake', status: 'failed', emails: [{ email: 'mom@test.com', sent: false }] }],
            sent_tags: [],
            failed_tags: ['Jake'],
          }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });

    const onSharedTagsChange = vi.fn();
    const onClose = vi.fn();
    render(
      <ShareWithTeammatesModal
        {...defaultProps}
        tagCounts={{ Jake: 3 }}
        tagClipIds={{ Jake: [1, 2, 3] }}
        onSharedTagsChange={onSharedTagsChange}
        onClose={onClose}
      />
    );
    await waitFor(() => expect(screen.getByText('mom@test.com')).toBeTruthy());

    fireEvent.click(screen.getByRole('button', { name: /share/i }));
    await waitFor(() => {
      expect(screen.getByText(/failed to send emails/i)).toBeTruthy();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(onSharedTagsChange).not.toHaveBeenCalled();
  });
});

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SharePlaybackDialog } from './SharePlaybackDialog';

vi.mock('./shared/Toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock('./shared/Button', () => ({
  Button: ({ children, onClick, disabled, ...props }) => (
    <button onClick={onClick} disabled={disabled} {...props}>{children}</button>
  ),
}));

vi.mock('./shared/UserPicker', () => ({
  UserPicker: ({ emails, onChange, placeholder }) => (
    <div data-testid="user-picker">
      <input
        data-testid="email-input"
        placeholder={placeholder}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target.value) {
            onChange([...emails, e.target.value]);
            e.target.value = '';
          }
        }}
      />
      {emails.map((email) => (
        <span key={email} data-testid="email-chip">{email}</span>
      ))}
    </div>
  ),
}));

function mockFetchSuccess() {
  return vi.fn(async (url, opts) => {
    if (url.includes('/contacts')) {
      return { ok: true, json: async () => ({ contacts: ['friend@test.com'] }) };
    }
    if (url.includes('/share-playback') && opts?.method === 'POST') {
      return { ok: true, json: async () => ({ results: [{ email: 'test@test.com', sent: true }], all_sent: true }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

function mockFetchFailure() {
  return vi.fn(async (url, opts) => {
    if (url.includes('/contacts')) {
      return { ok: true, json: async () => ({ contacts: [] }) };
    }
    if (url.includes('/share-playback') && opts?.method === 'POST') {
      return { ok: false, json: async () => ({ detail: 'Server error' }) };
    }
    return { ok: true, json: async () => ({}) };
  });
}

function mockFetchPartialFailure() {
  return vi.fn(async (url, opts) => {
    if (url.includes('/contacts')) {
      return { ok: true, json: async () => ({ contacts: [] }) };
    }
    if (url.includes('/share-playback') && opts?.method === 'POST') {
      return {
        ok: true,
        json: async () => ({
          results: [
            { email: 'good@test.com', sent: true },
            { email: 'bad@test.com', sent: false },
          ],
          all_sent: false,
        }),
      };
    }
    return { ok: true, json: async () => ({}) };
  });
}

describe('SharePlaybackDialog', () => {
  const defaultProps = {
    gameId: 42,
    gameName: 'Big Game',
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetchSuccess();
  });

  describe('Rendering', () => {
    it('renders dialog with game name in title', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      expect(screen.getByText('Share plays: Big Game')).toBeTruthy();
    });

    it('renders email input', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      expect(screen.getByTestId('user-picker')).toBeTruthy();
    });

    it('does not render a tag selector', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      expect(screen.queryByRole('combobox')).toBeNull();
      expect(screen.queryByText('Select athlete')).toBeNull();
    });

    // T9810: honest permission-scope disclosure (verified against the server grant).
    it('shows the permission-scope disclosure line', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      expect(
        screen.getByText(/watch this entire game recording and every play/i)
      ).toBeTruthy();
    });
  });

  // T9810: open-failure state — actionable error, not a broken form, when there
  // is no game context to invite into.
  describe('Open-failure state', () => {
    it('renders an actionable error instead of the form when gameId is missing', () => {
      render(<SharePlaybackDialog {...defaultProps} gameId={null} />);
      expect(screen.getByText("Game invitations couldn't open. Try again.")).toBeTruthy();
      expect(screen.queryByTestId('user-picker')).toBeNull();
    });

    it('does not fetch contacts when gameId is missing', () => {
      globalThis.fetch = mockFetchSuccess();
      render(<SharePlaybackDialog {...defaultProps} gameId={null} />);
      const contactsCall = globalThis.fetch.mock.calls.find(c => c[0].includes('/contacts'));
      expect(contactsCall).toBeFalsy();
    });

    it('closes from the error state', () => {
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} gameId={null} onClose={onClose} />);
      fireEvent.click(screen.getByText('Close'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Submit behavior', () => {
    it('share button disabled when no emails entered', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      const shareBtn = screen.getByText('Share');
      expect(shareBtn.disabled).toBe(true);
    });

    it('share button enabled when email is entered', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });

      const shareBtn = screen.getByText('Share');
      expect(shareBtn.disabled).toBe(false);
    });

    it('calls POST /api/games/{id}/share-playback with emails only', async () => {
      render(<SharePlaybackDialog {...defaultProps} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });

      fireEvent.click(screen.getByText('Share'));

      await waitFor(() => {
        const calls = globalThis.fetch.mock.calls;
        const shareCall = calls.find(c => c[0].includes('/share-playback'));
        expect(shareCall).toBeTruthy();
        expect(shareCall[0]).toContain('/api/games/42/share-playback');
        expect(shareCall[1].method).toBe('POST');
        expect(shareCall[1].credentials).toBe('include');
        const body = JSON.parse(shareCall[1].body);
        expect(body.emails).toEqual(['test@test.com']);
        expect(body.tag_name).toBeUndefined();
      });
    });

    it('shows success toast and closes on successful share', async () => {
      const { toast } = await import('./shared/Toast');
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} onClose={onClose} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });
      fireEvent.click(screen.getByText('Share'));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Annotations shared with 1 recipient');
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('shows error toast on HTTP failure', async () => {
      globalThis.fetch = mockFetchFailure();
      const { toast } = await import('./shared/Toast');
      render(<SharePlaybackDialog {...defaultProps} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });
      fireEvent.click(screen.getByText('Share'));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Server error');
      });
    });

    it('shows error toast with failed emails on partial failure', async () => {
      globalThis.fetch = mockFetchPartialFailure();
      const { toast } = await import('./shared/Toast');
      render(<SharePlaybackDialog {...defaultProps} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'good@test.com' } });
      fireEvent.click(screen.getByText('Share'));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to send to: bad@test.com');
      });
    });

    it('shows loading state during submission', async () => {
      globalThis.fetch = vi.fn(() => new Promise(() => {})); // Never resolves
      render(<SharePlaybackDialog {...defaultProps} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });
      fireEvent.click(screen.getByText('Share'));

      await waitFor(() => {
        expect(screen.getByText('Sharing...')).toBeTruthy();
      });
    });
  });

  describe('Dismiss behavior', () => {
    it('closes on Escape key', () => {
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} onClose={onClose} />);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(onClose).toHaveBeenCalled();
    });

    it('does not close on backdrop click', () => {
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} onClose={onClose} />);
      const backdrop = screen.getByText('Share plays: Big Game').closest('.fixed');
      fireEvent.click(backdrop);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('does not close on inner dialog click', () => {
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} onClose={onClose} />);
      const dialog = screen.getByText('Share plays: Big Game').closest('.bg-gray-800');
      fireEvent.click(dialog);
      expect(onClose).not.toHaveBeenCalled();
    });

    it('closes on X button click', () => {
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} onClose={onClose} />);
      const buttons = screen.getAllByRole('button');
      const closeBtn = buttons.find(b => b.querySelector('svg'));
      fireEvent.click(closeBtn);
      expect(onClose).toHaveBeenCalled();
    });

    it('closes on Cancel button click', () => {
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} onClose={onClose} />);
      fireEvent.click(screen.getByText('Cancel'));
      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('Contacts loading', () => {
    it('fetches contacts on mount', async () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      await waitFor(() => {
        const calls = globalThis.fetch.mock.calls;
        const contactsCall = calls.find(c => c[0].includes('/contacts'));
        expect(contactsCall).toBeTruthy();
      });
    });

    // T9810: a contacts fetch failure is non-blocking but never silently swallowed —
    // the user is told suggestions are missing and can still type addresses.
    it('surfaces a non-blocking note when contacts fail to load', async () => {
      globalThis.fetch = vi.fn(async (url) => {
        if (url.includes('/contacts')) return { ok: false, json: async () => null };
        return { ok: true, json: async () => ({}) };
      });
      render(<SharePlaybackDialog {...defaultProps} />);
      await waitFor(() => {
        expect(screen.getByText(/Couldn't load your contacts/i)).toBeTruthy();
      });
      // Form is still usable.
      expect(screen.getByTestId('user-picker')).toBeTruthy();
    });
  });
});

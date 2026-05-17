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
    tags: ['Jake', 'Player 7'],
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mockFetchSuccess();
  });

  describe('Rendering', () => {
    it('renders dialog with game name in title', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      expect(screen.getByText('Share Highlights: Big Game')).toBeTruthy();
    });

    it('renders tag selector when multiple tags', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      expect(screen.getByText('Select athlete')).toBeTruthy();
      expect(screen.getByText('Choose an athlete...')).toBeTruthy();
    });

    it('renders email input', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      expect(screen.getByTestId('user-picker')).toBeTruthy();
    });

    it('shows tag options in dropdown', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      const options = screen.getAllByRole('option');
      expect(options).toHaveLength(3); // placeholder + 2 tags
      expect(options[1].textContent).toBe('Jake');
      expect(options[2].textContent).toBe('Player 7');
    });
  });

  describe('Single tag behavior', () => {
    it('auto-selects single tag and hides selector', () => {
      render(<SharePlaybackDialog {...defaultProps} tags={['Jake']} />);
      expect(screen.queryByText('Select athlete')).toBeNull();
      expect(screen.queryByRole('combobox')).toBeNull();
    });

    it('can submit with single tag without selecting', async () => {
      globalThis.fetch = mockFetchSuccess();
      render(<SharePlaybackDialog {...defaultProps} tags={['Jake']} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });

      const shareBtn = screen.getByText('Share');
      fireEvent.click(shareBtn);

      await waitFor(() => {
        const calls = globalThis.fetch.mock.calls;
        const shareCall = calls.find(c => c[0].includes('/share-playback'));
        expect(shareCall).toBeTruthy();
        const body = JSON.parse(shareCall[1].body);
        expect(body.tag_name).toBe('Jake');
      });
    });
  });

  describe('Submit behavior', () => {
    it('share button disabled when no emails entered', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      const shareBtn = screen.getByText('Share');
      expect(shareBtn.disabled).toBe(true);
    });

    it('share button disabled when no tag selected (multi-tag)', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });
      const shareBtn = screen.getByText('Share');
      expect(shareBtn.disabled).toBe(true);
    });

    it('share button enabled when email and tag are set', () => {
      render(<SharePlaybackDialog {...defaultProps} />);
      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'Jake' } });

      const shareBtn = screen.getByText('Share');
      expect(shareBtn.disabled).toBe(false);
    });

    it('calls POST /api/games/{id}/share-playback with correct body', async () => {
      render(<SharePlaybackDialog {...defaultProps} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });

      const select = screen.getByRole('combobox');
      fireEvent.change(select, { target: { value: 'Player 7' } });

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
        expect(body.tag_name).toBe('Player 7');
      });
    });

    it('shows success toast and closes on successful share', async () => {
      const { toast } = await import('./shared/Toast');
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} tags={['Jake']} onClose={onClose} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'test@test.com' } });
      fireEvent.click(screen.getByText('Share'));

      await waitFor(() => {
        expect(toast.success).toHaveBeenCalledWith('Highlights shared with 1 recipient');
        expect(onClose).toHaveBeenCalled();
      });
    });

    it('shows error toast on HTTP failure', async () => {
      globalThis.fetch = mockFetchFailure();
      const { toast } = await import('./shared/Toast');
      render(<SharePlaybackDialog {...defaultProps} tags={['Jake']} />);

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
      render(<SharePlaybackDialog {...defaultProps} tags={['Jake']} />);

      const input = screen.getByTestId('email-input');
      fireEvent.keyDown(input, { key: 'Enter', target: { value: 'good@test.com' } });
      fireEvent.click(screen.getByText('Share'));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith('Failed to send to: bad@test.com');
      });
    });

    it('shows loading state during submission', async () => {
      globalThis.fetch = vi.fn(() => new Promise(() => {})); // Never resolves
      render(<SharePlaybackDialog {...defaultProps} tags={['Jake']} />);

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

    it('closes on backdrop click', () => {
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} onClose={onClose} />);
      const backdrop = screen.getByText('Share Highlights: Big Game').closest('.fixed');
      fireEvent.click(backdrop);
      expect(onClose).toHaveBeenCalled();
    });

    it('does not close on inner dialog click', () => {
      const onClose = vi.fn();
      render(<SharePlaybackDialog {...defaultProps} onClose={onClose} />);
      const dialog = screen.getByText('Share Highlights: Big Game').closest('.bg-gray-800');
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
  });
});

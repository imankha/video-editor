import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../utils/apiFetch', () => ({ default: vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve([]) })) }));
vi.mock('./shared/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('./shared/UserPicker', () => ({ UserPicker: () => <div /> }));

import { ShareModal } from './ShareModal';

// T12470:C2 FloatingCoach hides behind any [aria-modal] / [role=dialog] layer, so the
// Share dialog must declare itself one or the Home guide shows behind it.
describe('ShareModal is a modal dialog', () => {
  it('declares role=dialog and aria-modal', () => {
    render(<ShareModal videoId={1} videoName="Clip" onClose={() => {}} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });
});

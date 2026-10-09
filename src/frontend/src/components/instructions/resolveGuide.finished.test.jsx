import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import InstructionCoach from './InstructionCoach';
import { resolveGuide } from './resolveGuide';
import { useSettingsStore } from '../../stores/settingsStore';
import { GUIDE } from '../../config/displayNames';

vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); });

describe('T12290: finished viewer and share rules', () => {
  it('finished viewer points at Share until a link exists, then is deliberately silent', () => {
    const g = resolveGuide({ screen: 'finished', local: { shared: false } });
    expect(g.id).toBe('finished.viewer');
    expect(g.message.title).toBe(GUIDE.finished.viewer);
    expect(resolveGuide({ screen: 'finished', local: { shared: true } })).toBeNull();
  });
  it('share modal tells the user to choose who can watch', () => {
    const g = resolveGuide({ screen: 'share', local: {} });
    expect(g.id).toBe('share.modal');
    expect(g.message.title).toBe(GUIDE.share.modal);
  });
});

describe('T12290: closing the guide never fails silently', () => {
  it('shows an error when the X save fails and the coach stays up', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    render(<InstructionCoach>Do the thing</InstructionCoach>);
    fireEvent.click(screen.getByLabelText('Turn off guidance'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/could not save/i);
    expect(screen.getByText('Do the thing')).toBeTruthy();
  });
  it('shows no error when the X save succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u, o) => ({ ok: true, json: async () => JSON.parse(o.body) })));
    render(<InstructionCoach>Do the thing</InstructionCoach>);
    fireEvent.click(screen.getByLabelText('Turn off guidance'));
    await waitFor(() => expect(screen.queryByText('Do the thing')).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

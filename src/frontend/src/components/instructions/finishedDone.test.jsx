import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import Guide from './Guide';
import { resolveGuide } from './resolveGuide';
import { useSettingsStore } from '../../stores/settingsStore';

vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); });

describe('T12710: end-of-walk message once a share link exists', () => {
  it('resolves finished.done with a turn-off CTA', () => {
    const g = resolveGuide({ screen: 'finished', local: { shared: true } });
    expect(g.id).toBe('finished.done');
    expect(g.message.title).toMatch(/upload videos, mark plays and make highlights/i);
    expect(g.message.title).toMatch(/turn it back on/i);
    expect(g.cta).toBe('Turn off guidance for now');
  });
  it('the CTA turns guidance off with a surgical PUT', async () => {
    const fetchMock = vi.fn(async (_u, o) => ({ ok: true, json: async () => JSON.parse(o.body) }));
    vi.stubGlobal('fetch', fetchMock);
    render(<Guide inline guide={resolveGuide({ screen: 'finished', local: { shared: true } })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off guidance for now' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ guidance: { coachEnabled: false } });
  });
});

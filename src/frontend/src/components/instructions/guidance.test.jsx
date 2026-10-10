import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import InstructionCoach from './InstructionCoach';
import GuidanceToggle from './GuidanceToggle';
import { useSettingsStore } from '../../stores/settingsStore';
import { useAuthStore } from '../../stores/authStore';
import { annotateCoachModel } from './catalog';
import { placeCoach } from './placement';

vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); });
describe('global guidance behavior', () => {
  it('round trips off, stays accessible, and restores the current instruction', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    vi.stubGlobal('fetch', vi.fn(async (_url, options) => ({ ok: true, json: async () => JSON.parse(options.body) })));
    render(<><GuidanceToggle /><InstructionCoach phase="generate">Generate now</InstructionCoach></>);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByText('Generate now')).toBeNull();
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole('switch').disabled).toBe(false));
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByText('Generate now')).toBeTruthy());
  });
  it('T12300: the toggle PUTs only the changed field and loading settings never writes', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    const fetchMock = vi.fn(async (_url, options) => ({ ok: true, json: async () => JSON.parse(options.body) }));
    vi.stubGlobal('fetch', fetchMock);
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: false } });
    expect(fetchMock).not.toHaveBeenCalled();
    render(<GuidanceToggle />);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/settings');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ guidance: { coachEnabled: true } });
  });
  it('restores the previous preference and reports save failure', async () => {
    useAuthStore.setState({ isAuthenticated: true });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500 })));
    render(<GuidanceToggle />);
    fireEvent.click(screen.getByRole('switch'));
    await screen.findByRole('alert');
    expect(screen.getByRole('switch').getAttribute('aria-checked')).toBe('true');
  });
  it('loads a saved disabled preference', () => {
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: false } });
    render(<InstructionCoach>Hidden</InstructionCoach>);
    expect(screen.queryByText('Hidden')).toBeNull();
  });
});
describe('workflow and placement contracts', () => {
  it('offers portrait creation for a synthesized placeholder', () => {
    expect(annotateCoachModel({ rating: 5 }, [{ orientation: 'portrait', projectId: null }], true).phase).toBe('brilliant');
    expect(annotateCoachModel({ rating: 5 }, [{ orientation: 'portrait', projectId: 12 }], true).phase).toBe('portrait');
  });
  it('keeps encouraging marking when there are already plays and no selection', () => {
    expect(annotateCoachModel(null, [], true).phase).toBe('hasPlaysOne');
  });
  it('flips and clamps without covering a target when space exists', () => {
    const result = placeCoach({ left: 5, top: 60, bottom: 104, width: 60 }, { width: 300, height: 130 }, { width: 390, height: 844 });
    expect(result).toEqual({ left: 12, top: 116 });
  });
  it('T12240: skips candidates that hit an avoid rect and docks when nothing fits', () => {
    const target = { left: 100, top: 300, right: 160, bottom: 344, width: 60, height: 44 };
    const card = { width: 300, height: 130 };
    const vp = { width: 390, height: 844 };
    const belowSlot = { left: 0, top: 344, right: 390, bottom: 500 };
    const r = placeCoach(target, card, vp, 'top', [belowSlot]);
    expect(r.top + card.height).toBeLessThanOrEqual(target.top);
    const aboveSlot = { left: 0, top: 100, right: 390, bottom: 300 };
    expect(placeCoach(target, card, vp, 'top', [belowSlot, aboveSlot])).toBe('dock');
  });
  it('T12240: never intersects anchor or avoid rects across viewports', () => {
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    for (const [w, h] of [[320, 640], [390, 844], [768, 1024], [1280, 800]]) {
      const target = { left: w / 2 - 60, top: 200, right: w / 2 + 60, bottom: 244, width: 120, height: 44 };
      const avoid = [{ left: 0, top: 244, right: w, bottom: 300 }];
      const card = { width: 260, height: 110 };
      const r = placeCoach(target, card, { width: w, height: h }, 'top', avoid);
      if (r === 'dock') continue;
      const rect = { left: r.left, top: r.top, right: r.left + card.width, bottom: r.top + card.height };
      expect(hit(rect, target)).toBe(false);
      expect(hit(rect, avoid[0])).toBe(false);
    }
  });
});

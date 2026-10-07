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
  it('keeps teaching marking when there are already plays and no selection', () => {
    expect(annotateCoachModel(null, [], true).phase).toBe('marking');
  });
  it('flips and clamps without covering a target when space exists', () => {
    const result = placeCoach({ left: 5, top: 60, bottom: 104, width: 60 }, { width: 300, height: 130 }, { width: 390, height: 844 });
    expect(result).toEqual({ left: 12, top: 116 });
  });
});

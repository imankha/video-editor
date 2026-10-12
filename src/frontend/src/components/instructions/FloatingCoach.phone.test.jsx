import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, waitFor } from '@testing-library/react';
import FloatingCoach from './FloatingCoach';
import { useSettingsStore } from '../../stores/settingsStore';

const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const rect = { left: 20, top: 100, right: 120, bottom: 140, width: 100, height: 40 };
const host = () => document.querySelector('[data-testid="floating-coach-host"]');

beforeEach(() => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('T12460: coach is visible on a 390 phone', () => {
  it('a visibility:hidden parked dialog does not block the coach', async () => {
    const target = document.createElement('button');
    target.dataset.testid = 'tgt';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect);
    const drawer = document.createElement('div');
    drawer.setAttribute('role', 'dialog');
    drawer.style.visibility = 'hidden';
    document.body.appendChild(drawer);
    render(<FloatingCoach target="[data-testid='tgt']" phase="p"><p>Hello</p></FloatingCoach>);
    await flush();
    await waitFor(() => expect(host().style.visibility).toBe('visible'));
  });

  it('a visible dialog still blocks the coach', async () => {
    const target = document.createElement('button');
    target.dataset.testid = 'tgt';
    document.body.appendChild(target);
    vi.spyOn(target, 'getBoundingClientRect').mockReturnValue(rect);
    const modal = document.createElement('div');
    modal.setAttribute('role', 'dialog');
    document.body.appendChild(modal);
    render(<FloatingCoach target="[data-testid='tgt']" phase="p"><p>Hello</p></FloatingCoach>);
    await flush();
    expect(host().style.visibility).toBe('hidden');
  });

  it('docks (visible) when the target and fallback are missing', async () => {
    render(<FloatingCoach target="[data-testid='nope']" fallbackTarget="[data-testid='nada']" phase="p"><p>Hello</p></FloatingCoach>);
    await flush();
    expect(host().style.visibility).toBe('visible');
    expect(host().dataset.docked).toBe('true');
  });
});

describe('T12470: docked coach sits above the action band', () => {
  it('reserves a strip above the band instead of covering it', async () => {
    const band = document.createElement('div');
    band.dataset.testid = 'action-band';
    document.body.appendChild(band);
    vi.spyOn(band, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 740, right: 390, bottom: 844, width: 390, height: 104 });
    render(<FloatingCoach target="[data-testid='nope']" phase="p"><p>Hello</p></FloatingCoach>);
    await flush();
    expect(host().dataset.docked).toBe('true');
    expect(parseInt(host().style.bottom, 10)).toBeGreaterThanOrEqual(844 - 740);
  });
});

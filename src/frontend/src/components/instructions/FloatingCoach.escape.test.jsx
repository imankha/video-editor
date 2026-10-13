import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, fireEvent } from '@testing-library/react';
import Guide from './Guide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';

vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const guide = {
  id: 'r.one', message: { title: 'Do the thing', body: '' }, anchor: { target: '[data-testid="tgt"]', fallback: '[data-testid="tgt"]' },
  avoid: [], keepClear: [], pulse: null, tone: 'coach', step: null, phase: 'one',
};

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
  const el = document.createElement('button'); el.dataset.testid = 'tgt'; document.body.appendChild(el);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; });

describe('T12690:C1 Esc consumed by the guide does not reach the screen behind it', () => {
  it('window/document listeners behind the coach never see the Escape the coach acknowledged', async () => {
    const behindWindow = vi.fn(); const behindDoc = vi.fn();
    window.addEventListener('keydown', behindWindow); document.addEventListener('keydown', behindDoc);
    render(<Guide guide={guide} />); await flush();
    fireEvent.keyDown(document.body, { key: 'Escape' }); await flush();
    window.removeEventListener('keydown', behindWindow); document.removeEventListener('keydown', behindDoc);
    expect(document.querySelector('[data-testid="guide-shade"]')).toBeNull();
    expect(behindWindow).not.toHaveBeenCalled();
    expect(behindDoc).not.toHaveBeenCalled();
  });
});

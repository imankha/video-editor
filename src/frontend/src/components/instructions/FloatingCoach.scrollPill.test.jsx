import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import Guide from './Guide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';

vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const PILL = { w: 190, h: 40 };
const HOST = { left: 560, top: 700, width: 320, height: 180 };
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

// A self-consistent fake layout: the card sits bottom-centre (as the dock does at 1440x900), the pill sits where its style puts it.
beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
  const tgt = document.createElement('button');
  tgt.dataset.testid = 'tgt';
  document.body.appendChild(tgt);
  vi.spyOn(tgt, 'getBoundingClientRect').mockReturnValue(box(20, 2000, 100, 40));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const id = this.dataset?.testid;
    if (id === 'tgt') return box(20, 2000, 100, 40);
    if (id === 'floating-coach-host') return box(HOST.left, HOST.top, HOST.width, HOST.height);
    if (id === 'guidance-scroll-hint') {
      const left = this.style.left ? parseFloat(this.style.left) : (1440 - PILL.w) / 2;
      return box(left, 900 - 16 - PILL.h, PILL.w, PILL.h);
    }
    return box(0, 0, 0, 0);
  });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
});

describe('T13020:C2 the scroll pill never overlaps the guide card', () => {
  it('moves off the card when the docked card would sit under the centred pill', async () => {
    const g = { id: 'r.one', message: { title: 'Do the thing', body: '' }, anchor: { target: '[data-testid="tgt"]', fallback: '[data-testid="tgt"]' },
      avoid: [], keepClear: [], pulse: null, tone: 'coach', step: null, phase: 'one' };
    render(<Guide guide={g} />); await flush();
    const pill = screen.getByTestId('guidance-scroll-hint');
    const host = document.querySelector('[data-testid="floating-coach-host"]');
    expect(overlaps(pill.getBoundingClientRect(), host.getBoundingClientRect())).toBe(false);
  });
});

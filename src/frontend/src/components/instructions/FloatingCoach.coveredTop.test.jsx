import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act, screen } from '@testing-library/react';
import Guide from './Guide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';
import { GUIDE_PULSE_CLASS } from './guideTargets';

// T14430: at 390x844 a top-pinned toast covered Retry upload's centre. The page was already at the top, yet the
// guide read the anchor as offscreen: "Scroll up to continue" (scrolling can't reveal it) and a card docked 593 px away.
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const box = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
const RETRY = box(256, 89, 109, 24);
const BANNER = box(12, 80, 366, 41);
const CARD = { width: 366, height: 120 };

beforeEach(() => {
  vi.stubGlobal('innerWidth', 390);
  vi.stubGlobal('innerHeight', 844);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
  const banner = document.createElement('div');
  banner.dataset.testid = 'upload-preview-notice';
  const retry = document.createElement('button');
  retry.dataset.testid = 'retry';
  retry.className = GUIDE_PULSE_CLASS;
  banner.appendChild(retry);
  const toast = document.createElement('div');
  toast.dataset.testid = 'toast';
  document.body.append(banner, toast);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
    const id = this.dataset?.testid;
    if (id === 'retry') return RETRY;
    if (id === 'upload-preview-notice') return BANNER;
    if (id === 'toast') return box(8, 8, 374, 90);
    if (id === 'floating-coach-host') {
      const top = this.style.top ? parseFloat(this.style.top) : 844 - 12 - CARD.height;
      return box(12, top, CARD.width, CARD.height);
    }
    return box(0, 0, 0, 0);
  });
  // Something that is not the guide covers the anchor's centre (the page cannot scroll: jsdom has no scroll height).
  document.elementFromPoint = () => toast;
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
  delete document.elementFromPoint;
});

describe('T14430:C2 a covered anchor the page cannot scroll toward', () => {
  it('shows no scroll pill and puts the card within 250 px of the anchor', async () => {
    const g = { id: 'annotate.upload-failed', message: { title: 'Tap Retry upload to try again.', body: '' },
      anchor: { target: '[data-testid="upload-preview-notice"]', fallback: '[data-testid="upload-preview-notice"]' },
      avoid: [], keepClear: ['[data-testid="upload-preview-notice"]'], pulse: 'retry', tone: 'coach', step: null, phase: 'one' };
    render(<Guide guide={g} />); await flush();
    expect(screen.queryByTestId('guidance-scroll-hint')).toBeNull();
    const host = document.querySelector('[data-testid="floating-coach-host"]').getBoundingClientRect();
    expect(host.top >= RETRY.bottom || host.bottom <= RETRY.top).toBe(true);
    expect(host.top - BANNER.bottom).toBeGreaterThanOrEqual(0);
    expect(host.top - RETRY.bottom).toBeLessThanOrEqual(250);
  });
});

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import Guide from './Guide';
import { resolveGuide } from './resolveGuide';
import { useSettingsStore } from '../../stores/settingsStore';
import { useGuideFocusStore } from './guideFocusStore';

// T14840: the Finished player's Download button must stay tappable under every
// guide card shown on that screen (shaded or not) -- prod lost 42% of finishers
// to a Download button with no cutout.
vi.mock('../../utils/apiFetch', () => ({ default: (...args) => fetch(...args) }));
const flush = () => act(async () => { await new Promise(r => setTimeout(r, 50)); });
const shade = () => document.querySelector('[data-testid="guide-shade"]');
const cutouts = () => JSON.parse(shade().dataset.cutouts);
const place = (testid, rect) => {
  const el = document.createElement('button');
  el.dataset.testid = testid;
  document.body.appendChild(el);
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height });
  return el;
};
const coversRect = (rect) => cutouts().some(c =>
  c.left <= rect.left && c.right >= rect.left + rect.width && c.top <= rect.top && c.bottom >= rect.top + rect.height);

const downloadRect = { left: 1100, top: 20, width: 100, height: 36 };

beforeEach(() => {
  vi.stubGlobal('innerWidth', 1440);
  vi.stubGlobal('innerHeight', 900);
  vi.stubGlobal('requestAnimationFrame', cb => setTimeout(cb, 0));
  useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
  useGuideFocusStore.getState().resetAcks();
  place('player-download', downloadRect);
  place('finished-share-action', { left: 200, top: 700, width: 300, height: 44 });
  place('player-close', { left: 1400, top: 20, width: 32, height: 32 });
  place('collection-player-video', { left: 0, top: 80, width: 1440, height: 600 });
});
afterEach(() => {
  cleanup(); vi.unstubAllGlobals(); useSettingsStore.getState().reset(); document.body.innerHTML = ''; vi.restoreAllMocks();
  delete document.elementFromPoint;
});

describe('T14840: Finished player Download stays clickable under the guide', () => {
  it('finished.viewer (before Get share link) leaves Download out of the shade', async () => {
    const guide = resolveGuide({ screen: 'finished', local: { shared: false } });
    render(<Guide guide={guide} />); await flush();
    if (shade()) expect(coversRect(downloadRect)).toBe(true);
  });

  it('finished.done (the closing "keep going" card) never blocks Download', async () => {
    const guide = resolveGuide({ screen: 'finished', local: { shared: true } });
    render(<Guide guide={guide} />); await flush();
    if (shade()) expect(coversRect(downloadRect)).toBe(true);
  });
});

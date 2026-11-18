import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GUIDE } from '../config/displayNames';

const { webShareDevice } = vi.hoisted(() => ({ webShareDevice: { isMobile: false, capability: 'none' } }));
vi.mock('../hooks/useWebShare', () => ({
  ShareCapability: { FULL: 'full', LINK_ONLY: 'link', NONE: 'none' },
  useWebShare: () => ({
    copyLink: vi.fn(), shareVideoFile: vi.fn(), shareLink: vi.fn(), createShareLink: vi.fn(), repointShareLink: vi.fn(),
    isMobile: webShareDevice.isMobile, capability: webShareDevice.capability,
  }),
}));
vi.mock('../utils/apiFetch', () => ({ default: vi.fn() }));
vi.mock('./collections/CollectionPlayer', () => ({
  CollectionPlayer: ({ actionBar }) => <div>{actionBar}<button title="Download">Download</button></div>,
}));

import { DraftReelPreview } from './DraftReelPreview';
import { useReelPreviewStore } from '../stores/reelPreviewStore';
import { useSettingsStore } from '../stores/settingsStore';

const snapshot = { projectId: 42, finalVideoId: 99, name: 'Brilliant Dribble', aspectRatio: '9:16', clipCount: 1, gameName: null, gameStartTime: null };
const named = (sentence) => sentence.match(/Tap (.+?) to send it/)[1];
// Every coach sentence the finished viewer can say; the one shown is the one whose text is on screen.
const viewerSentences = () => Object.values(GUIDE.finished).filter((s) => /Tap .+? to send it/.test(s));

// T17040: the finished viewer's coach names a share button that is on the sheet, on a phone too.
describe('T17040 finished viewer coach names a visible button', () => {
  beforeEach(() => {
    useSettingsStore.getState().setFromBootstrap({ guidance: { coachEnabled: true } });
    act(() => useReelPreviewStore.getState().close());
  });
  it.each([
    ['phone with file sharing', true, 'full'],
    ['phone, link only', true, 'link'],
    ['desktop', false, 'none'],
  ])('%s, already published highlight', async (_label, isMobile, capability) => {
    webShareDevice.isMobile = isMobile;
    webShareDevice.capability = capability;
    render(<DraftReelPreview />);
    act(() => { useReelPreviewStore.getState().open({ ...snapshot, alreadyPublished: true }); });
    const shown = await vi.waitFor(() => {
      const hits = viewerSentences().filter((s) => screen.queryByText(s));
      expect(hits).toHaveLength(1);
      return hits;
    });
    expect(screen.getByRole('button', { name: named(shown[0]) })).toBeTruthy();
  });
});

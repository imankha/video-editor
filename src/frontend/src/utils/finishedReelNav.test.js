import { describe, it, expect, vi, beforeEach } from 'vitest';

// T9470: openFinishedReel must navigate home FIRST and then stamp the preview
// snapshot with the screen it opened on, so DraftReelPreview can scope the
// fullscreen overlay to that screen (and discard it on navigate-away).
const { openMock, goHomeMock } = vi.hoisted(() => ({
  openMock: vi.fn(),
  goHomeMock: vi.fn(),
}));

vi.mock('../stores/reelPreviewStore', () => ({
  useReelPreviewStore: { getState: () => ({ open: openMock }) },
}));
vi.mock('../stores/editorStore', () => ({
  useEditorStore: {
    getState: () => ({ goToProjectManager: goHomeMock, editorMode: 'project-manager' }),
  },
}));

import { openFinishedReel } from './finishedReelNav';

const project = {
  id: 7,
  final_video_id: 91,
  name: 'Great Reel',
  aspect_ratio: '9:16',
  clip_count: 2,
  clip_game_start_time: 750,
  game_names: ['Lakers'],
};

describe('openFinishedReel (T9470 scoping)', () => {
  beforeEach(() => {
    openMock.mockClear();
    goHomeMock.mockClear();
  });

  it('navigates home before opening the preview', () => {
    openFinishedReel(project);
    expect(goHomeMock).toHaveBeenCalledTimes(1);
    expect(openMock).toHaveBeenCalledTimes(1);
  });

  it('stamps the snapshot with the opening editor mode (project-manager)', () => {
    openFinishedReel(project);
    expect(openMock).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 7,
        finalVideoId: 91,
        openMode: 'project-manager',
      }),
    );
  });
});

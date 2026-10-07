import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { useState } from 'react';
import useAnnotate from './useAnnotate';

/**
 * T11430 fixround1 MAJOR 4(b): the useAnnotate mapping from the backend's
 * snake_case `highlight_instances` to the frontend camelCase `highlightInstances`
 * that getClipStages consumes. If this key/field mapping drifts, every play
 * silently falls back to the old single-pointer CTA with no test catching it
 * (exactly how MAJOR 2 shipped). This pins the field-by-field mapping, including
 * the per-project reel_source_* snapshot added in this fix round (MAJOR 1).
 */

function Harness({ apiRef }) {
  const [videoMetadata, setVideoMetadata] = useState(null);
  const annotate = useAnnotate(videoMetadata, { selectedRegionId: null, onSelect: () => {} });
  apiRef.current = {
    regionsWithLayout: annotate.regionsWithLayout,
    loadGame: (annotations, duration) => {
      setVideoMetadata({ duration, width: 1080, height: 1920, fileName: 'g.mp4', format: 'mp4' });
      annotate.reset();
      annotate.importAnnotations(annotations, duration);
    },
  };
  return null;
}

function mountHarness() {
  const apiRef = { current: null };
  render(<Harness apiRef={apiRef} />);
  return apiRef;
}

describe('T11430 useAnnotate highlight_instances mapping', () => {
  it('maps every snake_case instance field (incl. per-project reel_source_*) to camelCase', () => {
    const api = mountHarness();
    const annotations = [
      {
        id: 1, raw_clip_id: 1, start_time: 10, end_time: 15, name: 'Great Goal',
        auto_project_id: 42,
        highlight_instances: [
          {
            project_id: 42,
            aspect_ratio: '9:16',
            highlight_ordinal: 1,
            has_working_video: true,
            has_framing_points: true,
            has_overlay_edits: true,
            has_final_video: true,
            is_published: true,
            archived_at: '2026-09-01T00:00:00Z',
            reel_source_start_time: 10,
            reel_source_end_time: 15,
          },
        ],
      },
    ];

    act(() => { api.current.loadGame(annotations, 100); });

    const region = api.current.regionsWithLayout.find((r) => r.rawClipId === 1);
    expect(region).toBeTruthy();
    expect(region.highlightInstances).toHaveLength(1);
    expect(region.highlightInstances[0]).toEqual({
      projectId: 42,
      aspectRatio: '9:16',
      highlightOrdinal: 1,
      hasWorkingVideo: true,
      hasFramingPoints: true,
      hasOverlayEdits: true,
      hasFinalVideo: true,
      isPublished: true,
      archivedAt: '2026-09-01T00:00:00Z',
      reelSourceStartTime: 10,
      reelSourceEndTime: 15,
    });
  });

  it('defaults to an empty highlightInstances array when the backend sends none (legacy single-pointer play)', () => {
    const api = mountHarness();
    const annotations = [
      { id: 2, raw_clip_id: 2, start_time: 0, end_time: 5, name: 'Old Play', auto_project_id: 7 },
    ];
    act(() => { api.current.loadGame(annotations, 100); });
    const region = api.current.regionsWithLayout.find((r) => r.rawClipId === 2);
    expect(region.highlightInstances).toEqual([]);
  });
});

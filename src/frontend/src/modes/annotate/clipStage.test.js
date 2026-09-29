import { describe, it, expect } from 'vitest';
import { getClipStage, isFramingExportInProgress, CLIP_STAGE, HIGHLIGHT_STATUS } from './clipStage';

// T9330 §2.5 — the 6-row stage table as one ordered pure function.
// Order matters — first match wins; composes T8070 staleness and T8470 Part D.
//
// region shape (only the fields getClipStage reads):
//   autoProjectId, startTime, endTime, reelSourceStartTime, reelSourceEndTime
// linkedProject shape: { has_working_video, has_final_video, is_published }

const baseRegion = { id: 'c1', startTime: 2, endTime: 8 };

describe('getClipStage (T9330)', () => {
  it('no autoProjectId -> NO_PROJECT with a clear Frame action', () => {
    const region = { ...baseRegion, autoProjectId: null };
    expect(getClipStage(region, null)).toEqual({
      stage: CLIP_STAGE.NO_PROJECT,
      status: HIGHLIGHT_STATUS.NOT_STARTED,
      label: 'Make Highlight',
      action: 'focus',
    });
  });

  it('fresh draft (autoProjectId set, no reelSource snapshot, no produced video) -> FOCUS, "Frame"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: null,
      reelSourceEndTime: null,
    };
    const linkedProject = { has_working_video: false, has_final_video: false, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.FOCUS,
      status: HIGHLIGHT_STATUS.CLIPPED,
      label: 'Make Highlight',
      action: 'focus',
    });
  });

  it('an accepted in-progress framing export reports Framing before a working video exists', () => {
    const region = { ...baseRegion, autoProjectId: 42 };
    const linkedProject = { has_working_video: false, has_final_video: false, is_published: false };
    expect(getClipStage(region, linkedProject, { framingInProgress: true })).toEqual({
      stage: CLIP_STAGE.FOCUS,
      status: HIGHLIGHT_STATUS.FRAMING,
      label: 'Make Highlight',
      action: 'focus',
    });
  });

  it('drifted (T8070): reelSource snapshot non-null but boundaries moved -> FOCUS, "Frame"', () => {
    const region = {
      ...baseRegion,
      startTime: 3, // moved from the reelSource snapshot's 2
      endTime: 8,
      autoProjectId: 42,
      reelSourceStartTime: 2,
      reelSourceEndTime: 8,
    };
    const linkedProject = { has_working_video: true, has_final_video: true, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.FOCUS,
      status: HIGHLIGHT_STATUS.CLIPPED,
      label: 'Make Highlight',
      action: 'focus',
    });
  });

  it('below-migration (has_final_video true but reelSource snapshot null) -> FOCUS, "Frame"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: null,
      reelSourceEndTime: null,
    };
    const linkedProject = { has_working_video: true, has_final_video: true, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.FOCUS,
      status: HIGHLIGHT_STATUS.CLIPPED,
      label: 'Make Highlight',
      action: 'focus',
    });
  });

  it('projectReflectsClip (exact equality) + has_working_video, no final -> SPOTLIGHT, "Add Overlay"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: 2,
      reelSourceEndTime: 8,
    };
    const linkedProject = { has_working_video: true, has_final_video: false, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.SPOTLIGHT,
      status: HIGHLIGHT_STATUS.FRAMED,
      label: 'Add Overlay to Highlight',
      action: 'overlay',
    });
  });

  it('projectReflectsClip + has_final_video, not published -> FINAL, "Preview"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: 2,
      reelSourceEndTime: 8,
    };
    const linkedProject = { has_working_video: true, has_final_video: true, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.FINAL,
      status: HIGHLIGHT_STATUS.OVERLAID,
      label: 'Preview Highlight',
      action: 'preview',
    });
  });

  it('projectReflectsClip + has_final_video + is_published -> PUBLISHED, "View Final"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: 2,
      reelSourceEndTime: 8,
    };
    const linkedProject = { has_working_video: true, has_final_video: true, is_published: true };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.PUBLISHED,
      status: HIGHLIGHT_STATUS.PUBLISHED,
      label: 'View Highlight',
      action: 'published',
    });
  });

  // Staleness precedence (T8070): a produced final video demotes back to FOCUS
  // the instant the clip's boundaries move off the exact producing window — no
  // epsilon. A 1ms/0.001s diff still counts as drift.
  describe('staleness precedence wins over produced stages (T8070, exact equality, no epsilon)', () => {
    it('a completed+published project demotes to FOCUS when startTime drifts by 0.001s', () => {
      const region = {
        ...baseRegion,
        startTime: 2.001, // 1ms drift from the reelSource snapshot
        endTime: 8,
        autoProjectId: 42,
        reelSourceStartTime: 2,
        reelSourceEndTime: 8,
      };
      const linkedProject = { has_working_video: true, has_final_video: true, is_published: true };
      expect(getClipStage(region, linkedProject)).toEqual({
        stage: CLIP_STAGE.FOCUS,
        status: HIGHLIGHT_STATUS.CLIPPED,
        label: 'Make Highlight',
        action: 'focus',
      });
    });

    it('a completed (unpublished) project demotes to FOCUS when endTime drifts by 0.001s', () => {
      const region = {
        ...baseRegion,
        startTime: 2,
        endTime: 8.001,
        autoProjectId: 42,
        reelSourceStartTime: 2,
        reelSourceEndTime: 8,
      };
      const linkedProject = { has_working_video: true, has_final_video: true, is_published: false };
      expect(getClipStage(region, linkedProject)).toEqual({
        stage: CLIP_STAGE.FOCUS,
        status: HIGHLIGHT_STATUS.CLIPPED,
        label: 'Make Highlight',
        action: 'focus',
      });
    });
  });
});

describe('isFramingExportInProgress', () => {
  it.each(['pending', 'processing'])('recognizes a %s framing export for the project', (status) => {
    expect(isFramingExportInProgress({ e1: { projectId: 42, type: 'framing', status } }, '42')).toBe(true);
  });

  it('ignores completed framing and active overlay exports', () => {
    expect(isFramingExportInProgress({
      e1: { projectId: 42, type: 'framing', status: 'complete' },
      e2: { projectId: 42, type: 'overlay', status: 'processing' },
    }, 42)).toBe(false);
  });
});

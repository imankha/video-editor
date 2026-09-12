import { describe, it, expect } from 'vitest';
import { getClipStage, CLIP_STAGE } from './clipStage';

// T9330 §2.5 — the 6-row stage table as one ordered pure function.
// Order matters — first match wins; composes T8070 staleness and T8470 Part D.
//
// region shape (only the fields getClipStage reads):
//   autoProjectId, startTime, endTime, reelSourceStartTime, reelSourceEndTime
// linkedProject shape: { has_working_video, has_final_video, is_published }

const baseRegion = { id: 'c1', startTime: 2, endTime: 8 };

describe('getClipStage (T9330)', () => {
  it('no autoProjectId -> NO_PROJECT, "Create Clip", disabled (manual-create territory)', () => {
    const region = { ...baseRegion, autoProjectId: null };
    expect(getClipStage(region, null)).toEqual({
      stage: CLIP_STAGE.NO_PROJECT,
      label: 'Create Clip',
      action: null,
    });
  });

  it('fresh draft (autoProjectId set, no reelSource snapshot, no produced video) -> FOCUS, "Frame this clip"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: null,
      reelSourceEndTime: null,
    };
    const linkedProject = { has_working_video: false, has_final_video: false, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.FOCUS,
      label: 'Frame this clip',
      action: 'focus',
    });
  });

  it('drifted (T8070): reelSource snapshot non-null but boundaries moved -> FOCUS, "Frame this clip"', () => {
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
      label: 'Frame this clip',
      action: 'focus',
    });
  });

  it('below-migration (has_final_video true but reelSource snapshot null) -> FOCUS, "Frame this clip"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: null,
      reelSourceEndTime: null,
    };
    const linkedProject = { has_working_video: true, has_final_video: true, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.FOCUS,
      label: 'Frame this clip',
      action: 'focus',
    });
  });

  it('projectReflectsClip (exact equality) + has_working_video, no final -> SPOTLIGHT, "Apply Spotlight"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: 2,
      reelSourceEndTime: 8,
    };
    const linkedProject = { has_working_video: true, has_final_video: false, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.SPOTLIGHT,
      label: 'Apply Spotlight',
      action: 'overlay',
    });
  });

  it('projectReflectsClip + has_final_video, not published -> FINAL, "View Final"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: 2,
      reelSourceEndTime: 8,
    };
    const linkedProject = { has_working_video: true, has_final_video: true, is_published: false };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.FINAL,
      label: 'View Final',
      action: 'focus',
    });
  });

  it('projectReflectsClip + has_final_video + is_published -> PUBLISHED, "View Published"', () => {
    const region = {
      ...baseRegion,
      autoProjectId: 42,
      reelSourceStartTime: 2,
      reelSourceEndTime: 8,
    };
    const linkedProject = { has_working_video: true, has_final_video: true, is_published: true };
    expect(getClipStage(region, linkedProject)).toEqual({
      stage: CLIP_STAGE.PUBLISHED,
      label: 'View Published',
      action: 'focus',
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
        label: 'Frame this clip',
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
        label: 'Frame this clip',
        action: 'focus',
      });
    });
  });
});

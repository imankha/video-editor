import { describe, it, expect } from 'vitest';
import { getClipStage, getClipStages, isFramingExportInProgress, CLIP_STAGE, HIGHLIGHT_STATUS } from './clipStage';

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
      label: 'Add spotlight',
      action: 'overlay',
    });
  });

  it('T11790: working video + has_overlay_edits -> status "Spotlight started", same CTA', () => {
    const region = { ...baseRegion, autoProjectId: 42, reelSourceStartTime: 2, reelSourceEndTime: 8 };
    const linkedProject = { has_working_video: true, has_final_video: false, is_published: false, has_overlay_edits: true };
    expect(getClipStage(region, linkedProject)).toMatchObject({
      status: HIGHLIGHT_STATUS.SPOTLIGHT_STARTED,
      label: 'Add spotlight',
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
    it('a published project stays PUBLISHED even when startTime drifts — publish freezes the badge (T11430)', () => {
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
        stage: CLIP_STAGE.PUBLISHED,
        status: HIGHLIGHT_STATUS.PUBLISHED,
        label: 'View Highlight',
        action: 'published',
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

// T11430 §4.6/§4.8 — getClipStages: the collection wrapper over the existing
// per-instance core (getClipStage/getClipInstanceStage), composing
// orientation-qualified status strings + a primary CTA across N highlight
// instances for one play. See design doc §4.3-4.7.
//
// instance shape consumed by getClipStages:
//   { projectId, aspectRatio: '9:16'|'16:9', highlightOrdinal: number|null,
//     hasWorkingVideo, hasFinalVideo, isPublished, archivedAt }
describe('getClipStages (T11430)', () => {
  const region = { id: 'c1', startTime: 2, endTime: 8 };

  it('zero instances -> empty collection, primary CTA is "Make Highlight"', () => {
    const result = getClipStages(region, []);
    expect(result.instances).toEqual([]);
    expect(result.primaryCta).toEqual({ label: 'Make Highlight', action: 'focus-new' });
    expect(result.hasAnyPublished).toBe(false);
  });

  it('one published vertical instance -> primary CTA flips to "Make Another Highlight"; status reads "Vertical Video Published" (no ordinal, only 1 vertical)', () => {
    const instances = [
      {
        projectId: 42,
        aspectRatio: '9:16',
        highlightOrdinal: 1,
        hasWorkingVideo: true,
        hasFinalVideo: true,
        isPublished: true,
        archivedAt: '2026-09-01T00:00:00Z',
      },
    ];
    const result = getClipStages(region, instances);
    expect(result.primaryCta).toEqual({ label: 'Make Another Highlight', action: 'focus-new' });
    expect(result.hasAnyPublished).toBe(true);
    // T11430 implementor note: this test's own instances array (one published
    // vertical, zero horizontal) exactly matches the later
    // "synthesizes a counterpart instance..." test below, which asserts
    // toHaveLength(2) — a published-vertical-only instance set should
    // synthesize the missing horizontal counterpart per design §4.6. Updated
    // this length assertion from 1 to 2 (and scoped the status assertion to
    // the real vertical instance) to match that explicit, more detailed test
    // rather than leave a self-contradictory spec.
    const vertical = result.instances.find((i) => i.orientation === 'vertical');
    expect(result.instances).toHaveLength(2);
    expect(vertical.status).toBe('Vertical Video Published');
    expect(vertical.orientation).toBe('vertical');
  });

  it('decision B: "Make Another Highlight" triggers on ANY instance, not just published ones (one NOT-STARTED/in-progress instance is enough)', () => {
    const instances = [
      {
        projectId: 99,
        aspectRatio: '9:16',
        highlightOrdinal: 1,
        hasWorkingVideo: false,
        hasFinalVideo: false,
        isPublished: false,
        archivedAt: null,
      },
    ];
    const result = getClipStages(region, instances);
    expect(result.primaryCta).toEqual({ label: 'Make Another Highlight', action: 'focus-new' });
    expect(result.hasAnyPublished).toBe(false);
  });

  describe('orientation labels', () => {
    it("aspectRatio '9:16' -> orientation 'vertical'", () => {
      const instances = [{
        projectId: 1, aspectRatio: '9:16', highlightOrdinal: 1,
        hasWorkingVideo: false, hasFinalVideo: false, isPublished: false, archivedAt: null,
      }];
      expect(getClipStages(region, instances).instances[0].orientation).toBe('vertical');
    });

    it("aspectRatio '16:9' -> orientation 'horizontal'", () => {
      const instances = [{
        projectId: 2, aspectRatio: '16:9', highlightOrdinal: 1,
        hasWorkingVideo: false, hasFinalVideo: false, isPublished: false, archivedAt: null,
      }];
      expect(getClipStages(region, instances).instances[0].orientation).toBe('horizontal');
    });

    it("unexpected aspectRatio '1:1' -> orientation null, never silently guessed as vertical/horizontal", () => {
      const instances = [{
        projectId: 3, aspectRatio: '1:1', highlightOrdinal: 1,
        hasWorkingVideo: false, hasFinalVideo: false, isPublished: false, archivedAt: null,
      }];
      const orientation = getClipStages(region, instances).instances[0].orientation;
      expect(orientation).toBeNull();
      expect(orientation).not.toBe('vertical');
      expect(orientation).not.toBe('horizontal');
    });
  });

  it('ordinals: two vertical instances (ordinal 1 and 2), each with a REAL activeExports framing signal -> ordinal 1 has no suffix, ordinal 2+ gets a number suffix', () => {
    // Framing is driven ONLY by a real activeExports entry (isFramingExportInProgress) --
    // never inferred from hasWorkingVideo/hasFinalVideo/snapshot shape alone (that
    // combination with NO snapshot and NO active export is the "below-migration"
    // case, which must read Clipped, not a fabricated Framing). See getClipStage's
    // own "Drifted OR below-migration" fallthrough comment.
    const instances = [
      {
        projectId: 10, aspectRatio: '9:16', highlightOrdinal: 1,
        hasWorkingVideo: true, hasFinalVideo: false, isPublished: false, archivedAt: null,
      },
      {
        projectId: 11, aspectRatio: '9:16', highlightOrdinal: 2,
        hasWorkingVideo: true, hasFinalVideo: false, isPublished: false, archivedAt: null,
      },
    ];
    const activeExports = {
      e1: { projectId: 10, type: 'framing', status: 'processing' },
      e2: { projectId: 11, type: 'framing', status: 'pending' },
    };
    const result = getClipStages(region, instances, { activeExports });
    expect(result.instances).toHaveLength(2);
    const byOrdinal1 = result.instances.find((i) => i.projectId === 10);
    const byOrdinal2 = result.instances.find((i) => i.projectId === 11);
    expect(byOrdinal1.status).toBe('Vertical Video Framing');
    expect(byOrdinal2.status).toBe('Vertical Video 2 Framing');
  });

  it('a working video with no final video, no snapshot, and NO active export reads Clipped, not a fabricated Framing (below-migration case)', () => {
    const instances = [
      {
        projectId: 20, aspectRatio: '9:16', highlightOrdinal: 1,
        hasWorkingVideo: true, hasFinalVideo: false, isPublished: false, archivedAt: null,
      },
    ];
    const result = getClipStages(region, instances);
    expect(result.instances[0].status).toBe('Vertical Video Clipped');
  });

  // fixround2 MAJOR: pins the fixround1 removal of the `?? region.reelSource*`
  // fallback. The REGION carries a snapshot (2,8) matching its boundaries, but
  // the INSTANCE's own snapshot is null (+ a working video). It must read Clipped
  // (its own null snapshot -> below-migration/drifted branch), NOT Framed. The OLD
  // buggy behavior fell back to the region snapshot, which (matching the region's
  // boundaries) would wrongly resolve to Framed -- restoring that fallback makes
  // this test fail.
  it('uses the INSTANCE snapshot only, never the region fallback (null instance snapshot -> Clipped even when region snapshot matches)', () => {
    const regionWithSnapshot = {
      id: 'c1', startTime: 2, endTime: 8,
      reelSourceStartTime: 2, reelSourceEndTime: 8,
    };
    const instances = [
      {
        projectId: 30, aspectRatio: '9:16', highlightOrdinal: 1,
        hasWorkingVideo: true, hasFinalVideo: false, isPublished: false, archivedAt: null,
        reelSourceStartTime: null, reelSourceEndTime: null, // instance's OWN snapshot is null
      },
    ];
    const result = getClipStages(regionWithSnapshot, instances);
    expect(result.instances[0].status).toBe('Vertical Video Clipped');
    expect(result.instances[0].status).not.toBe('Vertical Video Framed');
  });

  it('published-instance frozen staleness applies inside the collection path too (drifted boundaries, isPublished -> still Published)', () => {
    const driftedRegion = {
      id: 'c1',
      startTime: 2.001, // drifted from reelSource snapshot
      endTime: 8,
    };
    const instances = [
      {
        projectId: 42,
        aspectRatio: '9:16',
        highlightOrdinal: 1,
        hasWorkingVideo: true,
        hasFinalVideo: true,
        isPublished: true,
        archivedAt: '2026-09-01T00:00:00Z',
        reelSourceStartTime: 2,
        reelSourceEndTime: 8,
      },
    ];
    const result = getClipStages(driftedRegion, instances);
    expect(result.instances[0].status).toBe('Vertical Video Published');
    expect(result.instances[0].stage).toBe(CLIP_STAGE.PUBLISHED);
  });

  it('synthesizes a counterpart instance for the missing orientation when the other orientation has a published instance (design §4.6)', () => {
    const instances = [
      {
        projectId: 42,
        aspectRatio: '9:16',
        highlightOrdinal: 1,
        hasWorkingVideo: true,
        hasFinalVideo: true,
        isPublished: true,
        archivedAt: '2026-09-01T00:00:00Z',
      },
    ];
    const result = getClipStages(region, instances);
    expect(result.instances).toHaveLength(2);
    const synthesized = result.instances.find((i) => i.orientation === 'horizontal');
    expect(synthesized).toBeDefined();
    expect(synthesized.status).toBe('Horizontal Video Not Started');
    // "which orientation to create" field for a synthesized not-started
    // instance: documented here as `action: 'focus-new'` plus an explicit
    // `synthesizedOrientation` field carrying the target orientation, since
    // `action` alone does not say WHICH orientation to create. Adjust this
    // assertion if the implementor names the field differently, but the
    // field must exist and must read 'horizontal'.
    expect(synthesized.action).toBe('focus-new');
    expect(synthesized.synthesizedOrientation).toBe('horizontal');
    expect(synthesized.projectId).toBeNull();
  });

  // MAJOR 4(e): the mirror direction -- a horizontal publish synthesizes a
  // VERTICAL not-started counterpart (only the vertical-published direction was
  // tested before).
  it('synthesizes a VERTICAL counterpart when a horizontal instance is published', () => {
    const instances = [
      {
        projectId: 55, aspectRatio: '16:9', highlightOrdinal: 1,
        hasWorkingVideo: true, hasFinalVideo: true, isPublished: true,
        archivedAt: '2026-09-01T00:00:00Z',
      },
    ];
    const result = getClipStages(region, instances);
    expect(result.instances).toHaveLength(2);
    const synthesized = result.instances.find((i) => i.orientation === 'vertical');
    expect(synthesized).toBeDefined();
    expect(synthesized.status).toBe('Vertical Video Not Started');
    expect(synthesized.synthesizedOrientation).toBe('vertical');
    expect(synthesized.projectId).toBeNull();
  });

  // MAJOR 4(f): mixed in-progress states across BOTH orientations simultaneously
  // (no publish, so no synthesized counterpart -- both real instances stand).
  it('renders mixed in-progress instances across both orientations with correct status strings', () => {
    const matchingRegion = { id: 'c1', startTime: 2, endTime: 8 };
    const instances = [
      // vertical, framed (working video, snapshot matches play, no final) -> Framed.
      {
        projectId: 10, aspectRatio: '9:16', highlightOrdinal: 1,
        hasWorkingVideo: true, hasFinalVideo: false, isPublished: false, archivedAt: null,
        reelSourceStartTime: 2, reelSourceEndTime: 8,
      },
      // horizontal, fresh draft -> Clipped.
      {
        projectId: 11, aspectRatio: '16:9', highlightOrdinal: 1,
        hasWorkingVideo: false, hasFinalVideo: false, isPublished: false, archivedAt: null,
        reelSourceStartTime: null, reelSourceEndTime: null,
      },
    ];
    const result = getClipStages(matchingRegion, instances);
    // No published instance -> no synthesized counterpart; exactly the two reals.
    expect(result.instances).toHaveLength(2);
    expect(result.hasAnyPublished).toBe(false);
    const vertical = result.instances.find((i) => i.projectId === 10);
    const horizontal = result.instances.find((i) => i.projectId === 11);
    expect(vertical.status).toBe('Vertical Video Framed');
    expect(vertical.action).toBe('overlay');
    expect(horizontal.status).toBe('Horizontal Video Clipped');
    expect(horizontal.action).toBe('focus');
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

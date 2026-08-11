import { describe, it, expect } from 'vitest';
import { DRAFT_STAGE, getDraftStage, splitByStage } from './draftStage';

// Minimal draft shapes — only the fields the derivation reads.
const notStarted = { id: 1, clips_in_progress: 0, clips_exported: 0, has_working_video: false, has_final_video: false, has_overlay_edits: false };
const inFraming = { ...notStarted, id: 2, clips_in_progress: 1 };
const inFramingExported = { ...notStarted, id: 3, clips_exported: 2 };
const inFramingOverlayEdits = { ...notStarted, id: 4, has_overlay_edits: true };
const inOverlay = { ...notStarted, id: 5, has_working_video: true };
const ready = { ...notStarted, id: 6, has_final_video: true };

describe('getDraftStage', () => {
  it('buckets each pipeline state (mirrors getProjectStatusCounts)', () => {
    expect(getDraftStage(notStarted)).toBe(DRAFT_STAGE.NOT_STARTED);
    expect(getDraftStage(inFraming)).toBe(DRAFT_STAGE.IN_FRAMING);
    expect(getDraftStage(inFramingExported)).toBe(DRAFT_STAGE.IN_FRAMING);
    expect(getDraftStage(inFramingOverlayEdits)).toBe(DRAFT_STAGE.IN_FRAMING);
    expect(getDraftStage(inOverlay)).toBe(DRAFT_STAGE.IN_OVERLAY);
    expect(getDraftStage(ready)).toBe(DRAFT_STAGE.READY);
  });

  it('final video wins over every other signal (published or not)', () => {
    expect(getDraftStage({ ...ready, has_working_video: true, clips_in_progress: 3 }))
      .toBe(DRAFT_STAGE.READY);
    expect(getDraftStage({ ...ready, is_published: true })).toBe(DRAFT_STAGE.READY);
  });

  it('working video wins over framing counters', () => {
    expect(getDraftStage({ ...inOverlay, clips_in_progress: 2, clips_exported: 1 }))
      .toBe(DRAFT_STAGE.IN_OVERLAY);
  });
});

describe('splitByStage', () => {
  it('returns one bucket per stage present, in pipeline order, dropping empties', () => {
    const buckets = splitByStage([ready, notStarted, inOverlay, inFraming]);
    expect(buckets.map(b => b.stage)).toEqual([
      DRAFT_STAGE.NOT_STARTED,
      DRAFT_STAGE.IN_FRAMING,
      DRAFT_STAGE.IN_OVERLAY,
      DRAFT_STAGE.READY,
    ]);
    expect(buckets.map(b => b.projects.map(p => p.id))).toEqual([[1], [2], [5], [6]]);
  });

  it('a single-stage list yields a single bucket (callers treat 1 and N rows the same)', () => {
    const buckets = splitByStage([inFraming, inFramingExported]);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].stage).toBe(DRAFT_STAGE.IN_FRAMING);
    expect(buckets[0].projects).toHaveLength(2);
  });

  it('empty list yields no buckets', () => {
    expect(splitByStage([])).toEqual([]);
  });
});

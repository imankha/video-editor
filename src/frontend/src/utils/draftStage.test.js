import { describe, it, expect } from 'vitest';
import { DRAFT_STAGE, getDraftStage, rendersSourceAspect, splitByStage, stageRowsFor, phaseRowsFor } from './draftStage';
import { RATIO } from '../constants/aspectRatios';

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

describe('rendersSourceAspect (T6800/T6900)', () => {
  it('is true for a Not-Started draft (T6800)', () => {
    expect(rendersSourceAspect(notStarted)).toBe(true);
  });

  it('is true for an In-Framing draft with NO crop keyframes yet (T6900)', () => {
    expect(rendersSourceAspect({ ...inFraming, has_crop_keyframes: false })).toBe(true);
    // exported-but-uncropped is the same case: entered Framing, never cropped.
    expect(rendersSourceAspect({ ...inFramingExported, has_crop_keyframes: false })).toBe(true);
  });

  it('is FALSE once crop keyframes exist on an In-Framing draft (target aspect)', () => {
    expect(rendersSourceAspect({ ...inFraming, has_crop_keyframes: true })).toBe(false);
  });

  it('is false for In-Overlay and Ready drafts (always target aspect)', () => {
    expect(rendersSourceAspect(inOverlay)).toBe(false);
    expect(rendersSourceAspect(ready)).toBe(false);
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

describe('stageRowsFor', () => {
  it('Not-Started collapses to ONE null-ratio row regardless of target ratios (row-height invariant with DraftTile T6800)', () => {
    const rows = stageRowsFor([
      { ...notStarted, id: 10, aspect_ratio: RATIO.PORTRAIT },
      { ...notStarted, id: 11, aspect_ratio: RATIO.LANDSCAPE },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe(DRAFT_STAGE.NOT_STARTED);
    expect(rows[0].byAspect).toEqual([
      { ratio: null, projects: expect.arrayContaining([expect.objectContaining({ id: 10 }), expect.objectContaining({ id: 11 })]) },
    ]);
  });

  it('a mixed-aspect FRAMED stage splits into aspect sub-rows, portrait first', () => {
    // has_crop_keyframes: real crop applied -> tiles take their TARGET ratio, so
    // the stage splits by that ratio (T6900: only FRAMED drafts group by target).
    const rows = stageRowsFor([
      { ...inFraming, id: 20, aspect_ratio: RATIO.LANDSCAPE, has_crop_keyframes: true },
      { ...inFraming, id: 21, aspect_ratio: RATIO.PORTRAIT, has_crop_keyframes: true },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].byAspect.map(b => b.ratio)).toEqual([RATIO.PORTRAIT, RATIO.LANDSCAPE]);
  });

  // T6900 — an In-Framing draft that entered the Framing screen but has NO crop
  // keyframes yet renders LANDSCAPE (source aspect), so row grouping must bucket
  // it by that rendered shape, not its (invisible) target ratio, or a portrait
  // target would drop it into a portrait row of a different tile height.
  it('groups an unframed In-Framing draft into the landscape row regardless of target ratio (T6900)', () => {
    const rows = stageRowsFor([
      { ...inFraming, id: 22, aspect_ratio: RATIO.PORTRAIT, has_crop_keyframes: false },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe(DRAFT_STAGE.IN_FRAMING);
    expect(rows[0].byAspect).toHaveLength(1);
    expect(rows[0].byAspect[0].ratio).toBe(RATIO.LANDSCAPE);
  });

  it('splits framed vs unframed In-Framing drafts by rendered aspect, not target ratio (T6900)', () => {
    // An unframed portrait draft (renders landscape) shares the landscape row
    // with a framed landscape draft; a framed portrait draft gets its own row.
    const rows = stageRowsFor([
      { ...inFraming, id: 23, aspect_ratio: RATIO.PORTRAIT, has_crop_keyframes: false }, // -> landscape
      { ...inFraming, id: 24, aspect_ratio: RATIO.LANDSCAPE, has_crop_keyframes: true },  // -> landscape
      { ...inFraming, id: 25, aspect_ratio: RATIO.PORTRAIT, has_crop_keyframes: true },   // -> portrait
    ]);
    expect(rows[0].byAspect.map(b => b.ratio)).toEqual([RATIO.PORTRAIT, RATIO.LANDSCAPE]);
    const portrait = rows[0].byAspect.find(b => b.ratio === RATIO.PORTRAIT);
    const landscape = rows[0].byAspect.find(b => b.ratio === RATIO.LANDSCAPE);
    expect(portrait.projects.map(p => p.id)).toEqual([25]);
    expect(landscape.projects.map(p => p.id).sort()).toEqual([23, 24]);
  });

  it('a single-aspect non-Not-Started stage yields one ratio-labeled bucket (no chip forced by callers)', () => {
    const rows = stageRowsFor([{ ...ready, id: 30, aspect_ratio: RATIO.PORTRAIT }]);
    expect(rows[0].byAspect).toHaveLength(1);
    expect(rows[0].byAspect[0].ratio).toBe(RATIO.PORTRAIT);
  });

  it('mixed-stage list yields rows in pipeline order, each with its own aspect buckets', () => {
    const rows = stageRowsFor([
      { ...ready, id: 40, aspect_ratio: RATIO.PORTRAIT },
      { ...notStarted, id: 41, aspect_ratio: RATIO.PORTRAIT },
      { ...inOverlay, id: 42, aspect_ratio: RATIO.LANDSCAPE },
    ]);
    expect(rows.map(r => r.stage)).toEqual([
      DRAFT_STAGE.NOT_STARTED,
      DRAFT_STAGE.IN_OVERLAY,
      DRAFT_STAGE.READY,
    ]);
    expect(rows[0].byAspect[0].ratio).toBeNull();
    expect(rows[1].byAspect[0].ratio).toBe(RATIO.LANDSCAPE);
    expect(rows[2].byAspect[0].ratio).toBe(RATIO.PORTRAIT);
  });
});

describe('phaseRowsFor (T8080 — By Phase view)', () => {
  it('sections by pipeline stage, each sub-grouped by game, in the CALLER-supplied game order', () => {
    const gameA = { ...inFraming, id: 1 };       // Game A, In Framing
    const gameB1 = { ...ready, id: 2 };          // Game B, Ready
    const gameB2 = { ...notStarted, id: 3 };     // Game B, Not Started
    const rows = phaseRowsFor([
      { key: 'Game B', label: 'Game B', projects: [gameB1, gameB2] },
      { key: 'Game A', label: 'Game A', projects: [gameA] },
    ]);

    expect(rows.map(r => r.stage)).toEqual([
      DRAFT_STAGE.NOT_STARTED,
      DRAFT_STAGE.IN_FRAMING,
      DRAFT_STAGE.READY,
    ]);
    // Not Started section: only Game B has a draft in this stage.
    expect(rows[0].byGame.map(g => g.key)).toEqual(['Game B']);
    // Ready section: Game B ordering is preserved even though it's listed first.
    expect(rows[2].byGame.map(g => g.key)).toEqual(['Game B']);
    // In Framing section: only Game A.
    expect(rows[1].byGame.map(g => g.key)).toEqual(['Game A']);
  });

  it('drops a phase entirely when no game has a draft in it', () => {
    const rows = phaseRowsFor([
      { key: 'Game A', label: 'Game A', projects: [{ ...ready, id: 1 }] },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].stage).toBe(DRAFT_STAGE.READY);
  });

  it('drops a game row within a phase when that game has nothing in that stage', () => {
    const rows = phaseRowsFor([
      { key: 'Game A', label: 'Game A', projects: [{ ...ready, id: 1 }] },
      { key: 'Game B', label: 'Game B', projects: [{ ...notStarted, id: 2 }] },
    ]);
    const readyRow = rows.find(r => r.stage === DRAFT_STAGE.READY);
    expect(readyRow.byGame.map(g => g.key)).toEqual(['Game A']);
  });

  it('an ungrouped "Other reels" entry behaves like any other game group', () => {
    const rows = phaseRowsFor([
      { key: 'Game A', label: 'Game A', projects: [{ ...ready, id: 1 }] },
      { key: '__ungrouped__', label: 'Other reels', projects: [{ ...ready, id: 2 }] },
    ]);
    const readyRow = rows.find(r => r.stage === DRAFT_STAGE.READY);
    expect(readyRow.byGame.map(g => g.label)).toEqual(['Game A', 'Other reels']);
  });

  it('each game row carries the same aspect sub-split as stageRowsFor (shared invariant)', () => {
    const rows = phaseRowsFor([
      {
        key: 'Game A', label: 'Game A', projects: [
          { ...inFraming, id: 1, aspect_ratio: RATIO.LANDSCAPE, has_crop_keyframes: true },
          { ...inFraming, id: 2, aspect_ratio: RATIO.PORTRAIT, has_crop_keyframes: true },
        ],
      },
    ]);
    const framingRow = rows.find(r => r.stage === DRAFT_STAGE.IN_FRAMING);
    expect(framingRow.byGame[0].byAspect.map(b => b.ratio)).toEqual([RATIO.PORTRAIT, RATIO.LANDSCAPE]);
  });

  it('empty input yields no sections', () => {
    expect(phaseRowsFor([])).toEqual([]);
  });
});

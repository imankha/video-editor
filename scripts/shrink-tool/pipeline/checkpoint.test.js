import { describe, it, expect } from 'vitest';
import { newManifest, reduceSegment, planResume, outputNameFor } from './checkpoint.js';

function baseSegment(overrides = {}) {
  return {
    idx: 0,
    name: 'DJI_0001.MP4',
    size: 1000,
    lastModified: 123,
    durationSec: 10,
    framesTotal: 300,
    state: 'pending',
    outputName: null,
    outputBytes: null,
    framesDone: 0,
    savedToDisk: false,
    error: null,
    ...overrides,
  };
}

describe('newManifest', () => {
  it('creates one pending segment per input, indexed in order', () => {
    const m = newManifest({
      jobId: 'abc123',
      crop: { x: 0, y: 0, w: 1, h: 1 },
      preset: 'recommended',
      segments: [
        { name: 'a.mp4', size: 10, lastModified: 1 },
        { name: 'b.mp4', size: 20, lastModified: 2 },
      ],
    });
    expect(m.segments).toHaveLength(2);
    expect(m.segments[0]).toMatchObject({ idx: 0, name: 'a.mp4', state: 'pending' });
    expect(m.segments[1]).toMatchObject({ idx: 1, name: 'b.mp4', state: 'pending' });
    expect(m.jobId).toBe('abc123');
  });
});

describe('reduceSegment -- every §3.3 transition', () => {
  it('pending --start--> running', () => {
    const seg = reduceSegment(baseSegment({ state: 'pending' }), { type: 'start' });
    expect(seg.state).toBe('running');
  });

  it('running --finalizing--> finalizing, carrying framesDone/outputBytes', () => {
    const seg = reduceSegment(baseSegment({ state: 'running' }), {
      type: 'finalizing', framesDone: 300, outputBytes: 5000,
    });
    expect(seg.state).toBe('finalizing');
    expect(seg.framesDone).toBe(300);
    expect(seg.outputBytes).toBe(5000);
  });

  it('M9: running --finalizing--> finalizing sets outputName immediately, not only at finish', () => {
    // A crash between "bytes written" and "manifest says done" is exactly the
    // window `finalizing` exists to protect (design §3.6) -- verifyOutputs' crash
    // repair needs outputName to already be there to find the promoted file.
    const seg = reduceSegment(baseSegment({ state: 'running', name: 'DJI_0001.MP4' }), {
      type: 'finalizing', framesDone: 300, outputBytes: 5000,
    });
    expect(seg.outputName).toBe(outputNameFor(seg));
    expect(seg.outputName).toBe('DJI_0001.shrunk.mp4');
  });

  it('finalizing --finish--> done, setting outputName', () => {
    const seg = reduceSegment(baseSegment({ state: 'finalizing' }), {
      type: 'finish', outputName: 'a.shrunk.mp4',
    });
    expect(seg.state).toBe('done');
    expect(seg.outputName).toBe('a.shrunk.mp4');
    expect(seg.savedToDisk).toBe(false);
  });

  it('running --cancel--> pending (user Cancel, or crash detected on reload)', () => {
    const seg = reduceSegment(baseSegment({ state: 'running', framesDone: 150 }), { type: 'cancel' });
    expect(seg.state).toBe('pending');
    expect(seg.framesDone).toBe(0); // no mid-segment resume
  });

  it('running --fail--> failed, carrying the error message', () => {
    const seg = reduceSegment(baseSegment({ state: 'running' }), { type: 'fail', error: 'decoder crashed' });
    expect(seg.state).toBe('failed');
    expect(seg.error).toBe('decoder crashed');
  });

  it('failed --cancel--> pending (Retry)', () => {
    const seg = reduceSegment(baseSegment({ state: 'failed', error: 'boom' }), { type: 'cancel' });
    expect(seg.state).toBe('pending');
    expect(seg.error).toBeNull();
  });

  it('done --save--> done, setting savedToDisk (file stays in OPFS)', () => {
    const seg = reduceSegment(baseSegment({ state: 'done' }), { type: 'save' });
    expect(seg.state).toBe('done');
    expect(seg.savedToDisk).toBe(true);
  });

  it('done --orphan--> pending (verifyOutputs found the file missing/wrong size)', () => {
    const seg = reduceSegment(
      baseSegment({ state: 'done', outputName: 'a.shrunk.mp4', outputBytes: 5000 }),
      { type: 'orphan' },
    );
    expect(seg.state).toBe('pending');
    expect(seg.outputName).toBeNull();
    expect(seg.outputBytes).toBeNull();
  });

  it('finalizing --cancel--> pending (crash: promote never happened)', () => {
    const seg = reduceSegment(baseSegment({ state: 'finalizing' }), { type: 'cancel' });
    expect(seg.state).toBe('pending');
  });

  it('throws on an invalid transition rather than silently no-op-ing', () => {
    expect(() => reduceSegment(baseSegment({ state: 'pending' }), { type: 'finish' })).toThrow();
    expect(() => reduceSegment(baseSegment({ state: 'done' }), { type: 'start' })).toThrow();
    expect(() => reduceSegment(baseSegment({ state: 'failed' }), { type: 'start' })).toThrow();
  });
});

describe('planResume', () => {
  const manifest = newManifest({
    jobId: 'j1',
    crop: { x: 0, y: 0, w: 1, h: 1 },
    preset: 'recommended',
    segments: [
      { name: 'a.mp4', size: 100, lastModified: 1 },
      { name: 'b.mp4', size: 200, lastModified: 2 },
    ],
  });

  it('fresh: folder matches but nothing has run yet (all pending)', () => {
    const present = manifest.segments.map((s) => ({ name: s.name, size: s.size, lastModified: s.lastModified }));
    const plan = planResume(manifest, present);
    expect(plan.action).toBe('fresh');
    expect(plan.firstPendingIdx).toBe(0);
  });

  it('resume: folder matches and some segments have progress', () => {
    const inProgress = {
      ...manifest,
      segments: [
        reduceSegment(manifest.segments[0], { type: 'start' }),
        manifest.segments[1],
      ],
    };
    const present = inProgress.segments.map((s) => ({ name: s.name, size: s.size, lastModified: s.lastModified }));
    const plan = planResume(inProgress, present);
    expect(plan.action).toBe('resume');
    expect(plan.firstPendingIdx).toBe(0); // segment 0 is 'running', not 'done'
  });

  it('resume: skips already-done segments to find the first pending one', () => {
    const seg0Done = reduceSegment(
      reduceSegment(reduceSegment(manifest.segments[0], { type: 'start' }), { type: 'finalizing', framesDone: 1, outputBytes: 1 }),
      { type: 'finish', outputName: 'a.shrunk.mp4' },
    );
    const inProgress = { ...manifest, segments: [seg0Done, manifest.segments[1]] };
    const present = inProgress.segments.map((s) => ({ name: s.name, size: s.size, lastModified: s.lastModified }));
    const plan = planResume(inProgress, present);
    expect(plan.action).toBe('resume');
    expect(plan.firstPendingIdx).toBe(1);
  });

  it('mismatch: a different folder was picked (name/size/lastModified do not line up)', () => {
    const present = [
      { name: 'a.mp4', size: 999, lastModified: 1 }, // size differs
      { name: 'b.mp4', size: 200, lastModified: 2 },
    ];
    const plan = planResume(manifest, present);
    expect(plan.action).toBe('mismatch');
  });

  it('mismatch: folder has a different segment count', () => {
    const present = [{ name: 'a.mp4', size: 100, lastModified: 1 }];
    const plan = planResume(manifest, present);
    expect(plan.action).toBe('mismatch');
  });
});

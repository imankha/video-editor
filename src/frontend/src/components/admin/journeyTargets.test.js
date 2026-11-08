import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

import {
  JOURNEY_TARGETS, END_TO_END_KEY, TERMINAL_STAGE, SMALL_N_FLOOR,
  ragFor, journeyTransitions, endToEndTransition, stageTransition, worstTransition, foldedMark,
} from './journeyTargets';

// The real ladder, read from the backend so a new stage without a target fails here.
const analytics = readFileSync(resolve(process.cwd(), '../backend/app/analytics.py'), 'utf8');
const ladderSource = analytics.slice(analytics.indexOf('JOURNEY_LADDER = ['), analytics.indexOf('# Money side strip'));
const LADDER = [...ladderSource.matchAll(/"key": "(\w+)"/g)].map(m => m[1]);

// A conserving full-ladder payload: `lost` users drop at each stage, none in window.
function ladderNodes(start, lost = {}, overrides = {}) {
  let reached = start;
  return LADDER.map((key, i) => {
    const last = i === LADDER.length - 1;
    const stuck = last ? 0 : (lost[key] || 0);
    const continued = last ? 0 : reached - stuck;
    const n = { key, label: key, reached, continued, in_window: 0, stuck, gone: 0,
      partial_from: null, no_data: false, ...overrides[key] };
    reached = continued;
    return n;
  });
}

describe('ragFor (T14900)', () => {
  const key = 'clipped->frame_opened'; // baseline 62, target 78

  it('is green at the target, yellow at the baseline, red just below it', () => {
    expect(ragFor(key, 78, 100)).toBe('green');
    expect(ragFor(key, 77.99, 100)).toBe('yellow');
    expect(ragFor(key, 62, 100)).toBe('yellow');
    expect(ragFor(key, 61.99, 100)).toBe('red');
  });

  it('gives no colour under the small-N floor: 19 grey, 20 coloured', () => {
    expect(SMALL_N_FLOOR).toBe(20);
    expect(ragFor(key, 100, 19)).toBe('grey');
    expect(ragFor(key, 100, 20)).toBe('green');
  });

  it('throws on an unknown transition key instead of guessing', () => {
    expect(() => ragFor('nope->nothing', 50, 100)).toThrow(/nope->nothing/);
  });
});

describe('target table (T14900)', () => {
  it('holds the roadmap table of 2026-11-03', () => {
    const table = Object.fromEntries(Object.entries(JOURNEY_TARGETS).map(([k, t]) => [k, [t.baseline, t.target]]));
    expect(table).toEqual({
      'signed_up->started': [88, 92],
      'started->add_footage': [83, 88],
      'add_footage->footage_landed': [66, 78],
      'footage_landed->clipped': [78, 85],
      'clipped->frame_opened': [62, 78],
      'frame_opened->framed': [87, 92],
      'framed->exported': [45, 65],
      'exported->finished': [95, 96],
      'finished->took_away': [58, 80],
      'signed_up->took_away': [4, 18],
    });
  });

  it('covers every stage of the backend ladder and names no stage outside it', () => {
    expect(LADDER.length).toBe(16);
    expect(TERMINAL_STAGE).toBe(LADDER[LADDER.length - 1]);
    for (const stage of LADDER.slice(0, -1)) expect(stageTransition(stage)).toBeTruthy();
    for (const t of Object.values(JOURNEY_TARGETS)) {
      for (const stage of [t.from, ...(t.via || []), t.to]) expect(LADDER).toContain(stage);
    }
  });

  it('partitions the ladder: the steps chain from the first stage to the last', () => {
    const steps = Object.entries(JOURNEY_TARGETS).filter(([k]) => k !== END_TO_END_KEY).map(([, t]) => t);
    const walked = [steps[0].from, ...steps.flatMap(t => [...(t.via || []), t.to])];
    expect(walked).toEqual(LADDER);
  });

  it('refuses a payload stage with no target entry', () => {
    const nodes = [...ladderNodes(100), { key: 'brand_new', label: 'New', reached: 0, continued: 0, in_window: 0, stuck: 0, gone: 0 }];
    expect(() => journeyTransitions(nodes)).toThrow(/brand_new/);
  });
});

describe('journeyTransitions (T14900)', () => {
  const byKey = nodes => Object.fromEntries(journeyTransitions(nodes).map(t => [t.key, t]));

  it('rates a neighbour step exactly like the backend continue rate', () => {
    const t = byKey(ladderNodes(100, { signed_up: 10 }))['signed_up->started'];
    expect(t).toMatchObject({ k: 90, n: 100, pct: 90, rag: 'yellow', target: 92, label: 'signed_up to started' });
  });

  it('rates a span across its inner stages, leaving out users still in window', () => {
    const nodes = ladderNodes(200, { framed: 30, export_pressed: 20 }, {});
    const framed = nodes.find(n => n.key === 'framed');
    const pressed = nodes.find(n => n.key === 'export_pressed');
    framed.stuck -= 10; framed.in_window = 10;
    pressed.stuck -= 10; pressed.in_window = 10;
    const t = byKey(nodes)['framed->exported'];
    expect(t).toMatchObject({ k: 150, n: 180, rag: 'green' });
    expect(t.pct).toBeCloseTo(83.33, 2);
  });

  it('floors on judged users, so a pending-heavy stage stays grey', () => {
    const nodes = ladderNodes(30);
    nodes[0].in_window = 15; nodes[0].continued = 15;
    nodes[1].reached = 15;
    const t = byKey(nodes)['signed_up->started'];
    expect(t).toMatchObject({ n: 15, pct: null, rag: 'grey' });
  });

  it('badges a transition partial when either end is partial or has no data, never a colour', () => {
    const partialEnd = byKey(ladderNodes(100, {}, { exported: { partial_from: '2026-11-04' } }));
    expect(partialEnd['framed->exported']).toMatchObject({ rag: 'partial', partialFrom: '2026-11-04' });
    expect(partialEnd['exported->finished']).toMatchObject({ rag: 'partial', partialFrom: '2026-11-04' });
    expect(partialEnd['frame_opened->framed'].rag).toBe('green');
    const noData = byKey(ladderNodes(100, {}, { framed: { no_data: true } }));
    expect(noData['frame_opened->framed'].rag).toBe('partial');
  });

  it('keeps partial ahead of grey when both apply', () => {
    const t = byKey(ladderNodes(5, {}, { started: { partial_from: '2026-06-04' } }))['signed_up->started'];
    expect(t.rag).toBe('partial');
  });

  it('rates end to end from the first stage to the last', () => {
    const t = endToEndTransition(ladderNodes(100, { signed_up: 80 }));
    expect(t).toMatchObject({ key: END_TO_END_KEY, k: 20, n: 100, pct: 20, rag: 'green', target: 18 });
  });
});

describe('foldedMark (T14900)', () => {
  const t = (rag, pct, target = 90) => ({ rag, pct, target, n: 100, k: 1, key: `${rag}-${pct}` });

  it('colours a group only when every folded step was judged', () => {
    expect(foldedMark([t('green', 95), t('red', 10)])).toEqual({ rag: 'red', text: 'worst 10.00%' });
  });

  it('never shows a colour over an unmeasured step, and still prints the worst measured rate', () => {
    expect(foldedMark([t('green', 83.33), t('partial', null)])).toEqual({ rag: 'partial', text: 'partial, worst 83.33%' });
    expect(foldedMark([t('red', 10), t('partial', null)])).toEqual({ rag: 'partial', text: 'partial, worst 10.00%' });
  });

  it('never shows a colour over a step under the floor', () => {
    expect(foldedMark([t('green', 95), t('grey', null)])).toEqual({ rag: 'grey', text: 'n < 20, worst 95.00%' });
  });

  it('partial outranks grey, and a group with nothing measured prints the bare mark', () => {
    expect(foldedMark([t('grey', null), t('partial', null)])).toEqual({ rag: 'partial', text: 'partial' });
    expect(foldedMark([t('grey', null)])).toEqual({ rag: 'grey', text: 'n < 20' });
  });
});

describe('worstTransition (T14900)', () => {
  const t = (rag, pct, target) => ({ rag, pct, target, key: `${rag}-${pct}` });

  it('picks red over yellow over green over the uncoloured marks', () => {
    expect(worstTransition([t('green', 99, 90), t('red', 10, 90), t('yellow', 50, 90)]).rag).toBe('red');
    expect(worstTransition([t('partial', null, 90), t('grey', null, 90), t('green', 99, 90)]).rag).toBe('green');
    expect(worstTransition([t('partial', null, 90), t('grey', null, 90)]).rag).toBe('grey');
  });

  it('breaks a tie by the distance to target', () => {
    expect(worstTransition([t('red', 60, 65), t('red', 50, 90)]).pct).toBe(50);
  });
});

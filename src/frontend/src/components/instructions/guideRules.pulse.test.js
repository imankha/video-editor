import { describe, it, expect } from 'vitest';
import { GUIDE_RULES } from './resolveGuide';
import { GUIDE_PULSE } from './guideTargets';

// T12760: a guide sentence that names a control either pulses it or says why it cannot.
const sources = import.meta.glob(['../../**/*.{js,jsx}', '!../../**/*.test.*', '!../../**/instructions/**', '!../../e2e/**'], {
  query: '?raw', import: 'default', eager: true,
});
const pulseValues = Object.values(GUIDE_PULSE);

describe('GUIDE_RULES pulse invariant', () => {
  it.each(GUIDE_RULES.map((r) => [r.id, r]))('%s has exactly one of pulse / noPulse', (_id, rule) => {
    const hasPulse = rule.pulse != null;
    const hasNoPulse = typeof rule.noPulse === 'string' && rule.noPulse.trim().length > 0;
    expect(hasPulse !== hasNoPulse, `rule ${rule.id}: pulse=${rule.pulse} noPulse=${rule.noPulse}`).toBe(true);
    if (hasPulse) for (const t of [rule.pulse].flat()) expect(pulseValues).toContain(t);
  });

  it('every target a rule names is consumed as GUIDE_PULSE.<KEY> by a control', () => {
    const used = new Set(GUIDE_RULES.flatMap((r) => [r.pulse ?? []].flat()));
    const keys = Object.entries(GUIDE_PULSE).filter(([, v]) => used.has(v)).map(([k]) => k);
    const text = Object.values(sources).join('\n');
    const orphans = keys.filter((k) => !new RegExp(`GUIDE_PULSE\\.${k}\\b`).test(text));
    expect(orphans).toEqual([]);
  });
});

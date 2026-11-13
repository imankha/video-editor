import { describe, it, expect } from 'vitest';
import { retentionTriangleCsv } from './retentionChartCsv';

describe('retentionTriangleCsv (T7430:C5)', () => {
  it('builds one CSV row per cohort with the selected view\'s pct per week', () => {
    const cohorts = [
      {
        cohort_week: '2026-11-02',
        signups: 41,
        weeks: {
          '0': { classic: { pct: 100, hit: 41, aged: 41 }, unbounded: { pct: 100, hit: 41, aged: 41 } },
          '1': { classic: { pct: 12.2, hit: 5, aged: 41 }, unbounded: { pct: 30, hit: 12, aged: 41 } },
        },
      },
    ];
    const csv = retentionTriangleCsv(cohorts, 2, 'unbounded');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Cohort week,Signups,Week 0,Week 1');
    expect(lines[1]).toBe('2026-11-02,41,100,30');
  });

  it('leaves an unmeasurable week blank, never a fabricated 0', () => {
    const cohorts = [
      { cohort_week: '2026-11-09', signups: 12, weeks: { '0': { classic: null, unbounded: null } } },
    ];
    const csv = retentionTriangleCsv(cohorts, 1, 'unbounded');
    expect(csv.split('\r\n')[1]).toBe('2026-11-09,12,');
  });
});

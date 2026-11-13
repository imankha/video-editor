import { describe, it, expect } from 'vitest';
import { activationReportCsv } from './activationReportCsv';

describe('activationReportCsv (T7420:C3)', () => {
  it('builds one CSV row per cohort with both metrics', () => {
    const cohorts = [
      {
        cohort_month: '2026-05-01',
        signups: 20,
        maturing: false,
        export_completed: { pct: 45, hit: 9, aged: 20 },
        share_completed: { pct: 30, hit: 6, aged: 20 },
      },
    ];
    const csv = activationReportCsv(cohorts);
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Cohort month,Signups,Maturing,Export <=14d %,Export hit,Share <=14d %,Share hit');
    expect(lines[1]).toBe('2026-05-01,20,false,45,9,30,6');
  });

  it('leaves a maturing cohort\'s metrics blank, never a fabricated 0', () => {
    const cohorts = [
      { cohort_month: '2026-11-01', signups: 5, maturing: true, export_completed: null, share_completed: null },
    ];
    const csv = activationReportCsv(cohorts);
    expect(csv.split('\r\n')[1]).toBe('2026-11-01,5,true,,,,');
  });
});

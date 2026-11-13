import { describe, it, expect } from 'vitest';
import { activationReportCsv } from './activationReportCsv';

describe('activationReportCsv (T7420:C3)', () => {
  it('builds one CSV row per cohort with both metrics', () => {
    const cohorts = [
      {
        group: '2026-05-01',
        label: '2026-05-01',
        cohort_month: '2026-05-01',
        signups: 20,
        maturing: false,
        export_completed: { pct: 45, hit: 9, aged: 20 },
        share_completed: { pct: 30, hit: 6, aged: 20 },
      },
    ];
    const csv = activationReportCsv(cohorts, 'cohorts');
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('Cohort month,Signups,Maturing,Export <=14d %,Export hit,Share <=14d %,Share hit');
    expect(lines[1]).toBe('2026-05-01,20,false,45,9,30,6');
  });

  it('leaves a maturing cohort\'s metrics blank, never a fabricated 0', () => {
    const cohorts = [
      { group: '2026-11-01', label: '2026-11-01', cohort_month: '2026-11-01', signups: 5, maturing: true, export_completed: null, share_completed: null },
    ];
    const csv = activationReportCsv(cohorts, 'cohorts');
    expect(csv.split('\r\n')[1]).toBe('2026-11-01,5,true,,,,');
  });

  it('names the group column after the Dimension pill and prints each group\'s label', () => {
    const cohorts = [
      { group: 'c1', label: 'Spring Promo', signups: 4, maturing: false, export_completed: { pct: 50, hit: 2, aged: 4 }, share_completed: null },
    ];
    const lines = activationReportCsv(cohorts, 'campaigns').split('\r\n');
    expect(lines[0].startsWith('Campaign,Signups,')).toBe(true);
    expect(lines[1]).toBe('Spring Promo,4,false,50,2,,');
    expect(activationReportCsv(cohorts, 'builds').startsWith('Signup build,')).toBe(true);
  });
});

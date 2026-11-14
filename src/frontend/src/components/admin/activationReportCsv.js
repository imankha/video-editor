// T7420: the activation report as CSV, built client-side from the cohorts already
// on screen. Same cell-escaping rule as channelsCsv.js/retentionChartCsv.js.

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function pctCell(metric) {
  return metric ? metric.pct : '';
}

// The group column is named after the Dimension pill the report was loaded for.
export const ACTIVATION_GROUP_HEADERS = {
  cohorts: 'Cohort month',
  campaigns: 'Campaign',
  builds: 'Signup build',
};

/**
 * @param cohorts activationData.cohorts
 * @param group activationData.group ('cohorts' | 'campaigns' | 'builds')
 */
export function activationReportCsv(cohorts, group) {
  const lines = [
    [ACTIVATION_GROUP_HEADERS[group], 'Signups', 'Maturing', 'Export <=14d %', 'Export hit', 'Share <=14d %', 'Share hit'].join(','),
  ];
  for (const row of cohorts) {
    lines.push([
      cell(row.label),
      cell(row.signups),
      cell(row.maturing),
      cell(pctCell(row.export_completed)),
      cell(row.export_completed ? row.export_completed.hit : ''),
      cell(pctCell(row.share_completed)),
      cell(row.share_completed ? row.share_completed.hit : ''),
    ].join(','));
  }
  return lines.join('\r\n');
}

export function downloadActivationCsv(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `activation-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

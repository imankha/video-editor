// T7430: the retention triangle as CSV (classic view), built client-side from the
// cohorts already on screen. Same cell-escaping rule as channelsCsv.js -- dimension
// values are backend-derived dates here, but keep the guard for consistency.

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** @param cohorts triangle.cohorts; @param weeksTracked triangle.weeks_tracked */
export function retentionTriangleCsv(cohorts, weeksTracked, view) {
  const weekCols = Array.from({ length: weeksTracked }, (_, i) => `Week ${i}`);
  const lines = [['Cohort week', 'Signups', ...weekCols].join(',')];
  for (const row of cohorts) {
    const cells = weekCols.map((_, i) => {
      const c = row.weeks[String(i)]?.[view];
      return c ? c.pct : '';
    });
    lines.push([cell(row.cohort_week), cell(row.signups), ...cells.map(cell)].join(','));
  }
  return lines.join('\r\n');
}

export function downloadRetentionCsv(text, view) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `retention-${view}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

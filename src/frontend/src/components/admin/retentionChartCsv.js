// T7430: the retention chart's data as CSV (the selected classic/unbounded view, one row
// per curve group -- signup week, campaign or build, per the Dimension pill), built
// client-side from the data already loaded. Same cell-escaping rule as channelsCsv.js -- dimension
// values are backend-derived dates here, but keep the guard for consistency.

function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * @param cohorts triangle.cohorts; @param weeksTracked triangle.weeks_tracked
 * @param groupHeader first column's header, e.g. 'Campaign'
 */
export function retentionTriangleCsv(cohorts, weeksTracked, view, groupHeader) {
  const weekCols = Array.from({ length: weeksTracked }, (_, i) => `Week ${i}`);
  const lines = [[groupHeader, 'Signups', ...weekCols].join(',')];
  for (const row of cohorts) {
    const cells = weekCols.map((_, i) => {
      const c = row.weeks[String(i)]?.[view];
      return c ? c.pct : '';
    });
    lines.push([cell(row.label), cell(row.signups), ...cells.map(cell)].join(','));
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

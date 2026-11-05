// T15120: the Channels read-out as CSV, built client-side from the rows on screen.

const COLUMNS = [
  ['Campaign name', r => r.campaign_name],
  ['Signups', r => r.signups],
  ['Upload attempted', r => r.upload_attempted],
  ['Upload succeeded', r => r.upload_succeeded],
  ['Upload success %', r => r.upload_success_pct],
  ['First highlight aged', r => r.first_highlight_14d.aged],
  ['First highlight hit', r => r.first_highlight_14d.hit],
  ['First highlight %', r => r.first_highlight_14d.pct],
  ['Paywall shown', r => r.paywall_shown],
  ['Buy modal opened', r => r.buy_modal_opened],
  ['Payers', r => r.payers],
  ['Revenue USD', r => (r.revenue_cents / 100).toFixed(2)],
];

// Dimension values come from URLs anyone can craft, and a spreadsheet runs a cell that
// opens with one of these as a formula. Numbers are ours and never reach this prefix.
function cell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/** @param valueHeader first column's header; rows carry their value under `by`. */
export function channelsCsv(rows, by, valueHeader, unattributedRevenueCents) {
  const lines = [[valueHeader, ...COLUMNS.map(([header]) => header)].join(',')];
  for (const row of rows) {
    lines.push([cell(row[by]), ...COLUMNS.map(([, read]) => cell(read(row)))].join(','));
  }
  // T8650: the file reconciles to the ledger the same way the table does.
  if (unattributedRevenueCents) {
    const blanks = Array(COLUMNS.length - 1).fill('');
    lines.push(['Unattributed', ...blanks, (unattributedRevenueCents / 100).toFixed(2)].join(','));
  }
  return lines.join('\r\n');
}

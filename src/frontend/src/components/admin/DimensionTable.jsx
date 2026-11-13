// T13990: the ONE table every admin filter dimension (Campaigns, Cohorts, Builds) renders.
// Only the label column differs; the KPI columns are identical so switching dimension never
// changes what a column means. Rows come from the backend's shared `_segment_group_rows`.
import { fmtPct } from './formatNumber';
const STEP_COLS = [
  { key: 'uploaded_pct', label: 'Uploaded' },
  { key: 'clipped_pct', label: 'Clipped' },
  { key: 'exported_pct', label: 'Exported' },
  { key: 'shared_pct', label: 'Shared' },
  { key: 'purchased_pct', label: 'Purchased' },
];

// T15120: distinct-user counts, shown as plain numbers beside the percentages.
const COUNT_COLS = [
  { key: 'paywall_shown', label: 'Paywall' },
  { key: 'buy_modal_opened', label: 'Opened buy' },
  { key: 'payers', label: 'Payers' },
];
// Below this many aged sign-ups the rate is greyed: it reads as small N, not a result.
const MIN_AGED = 20;

function FirstHighlightCell({ value: { aged, hit, pct } }) {
  if (pct === null) {
    return <span className="text-gray-500 text-xs" title="No sign-ups 14 days old yet">--</span>;
  }
  return (
    <span className={`text-xs ${aged < MIN_AGED ? 'text-gray-500' : 'text-gray-200'}`}>
      {fmtPct(pct)} ({hit}/{aged})
    </span>
  );
}

function cellColor(pct) {
  if (pct >= 60) return 'bg-green-500/30 text-green-300';
  if (pct >= 40) return 'bg-green-500/15 text-green-400';
  if (pct >= 20) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/15 text-red-400';
}

function formatRevenue(cents) {
  return `$${((cents || 0) / 100).toFixed(2)}`;
}

/**
 * @param rows            backend rows (each carries the shared KPI keys)
 * @param labelHeader     first column's header text; labelTitle its tooltip
 * @param rowKey          row -> the value passed to onRowClick / compared to selectedKey
 * @param renderLabel     row -> first cell content
 * @param isSelectable    row -> whether a click selects it (default: all rows)
 * @param unattributedRevenueCents  T8650 remainder row, shown when nonzero
 */
export function DimensionTable({
  rows, labelHeader, labelTitle, rowKey, renderLabel, isSelectable = () => true,
  onRowClick, selectedKey, unattributedRevenueCents, emptyText,
}) {
  // T8650: still render when there are no rows but there IS an unattributed remainder,
  // so the money is never hidden behind the empty message.
  if (!rows?.length && !unattributedRevenueCents) {
    return <p className="text-gray-500 text-sm">{emptyText}</p>;
  }

  return (
    <div className="rounded-lg border border-white/10 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2.5" title={labelTitle}>{labelHeader}</th>
            <th className="text-right px-3 py-2.5">Signups</th>
            <th className="text-right px-3 py-2.5" title="Account deleted, analytics kept (T15290)">Deleted</th>
            <th className="text-right px-3 py-2.5">Revenue</th>
            <th className="text-center px-3 py-2.5">Upload Success</th>
            <th className="text-center px-3 py-2.5" title="Upload tries / successes, the counts Upload Success divides (a success with no recorded try counts as a try: uploads before 2026-09-22 never recorded one)">Upload tries</th>
            <th className="text-center px-3 py-2.5" title="Of sign-ups at least 14 days old, the share who rendered within 14 days (hit/aged)">First highlight 14d</th>
            {COUNT_COLS.map(c => (
              <th key={c.key} className="text-right px-3 py-2.5">{c.label}</th>
            ))}
            {STEP_COLS.map(c => (
              <th key={c.key} className="text-center px-3 py-2.5">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {(rows || []).map(row => {
            const key = rowKey(row);
            const selectable = isSelectable(row);
            return (
              <tr
                key={key}
                className={`border-b border-white/5 ${selectable ? 'cursor-pointer hover:bg-white/5' : ''} ${selectedKey === key ? 'bg-purple-500/15 border-l-2 border-l-purple-500' : ''}`}
                onClick={() => selectable && onRowClick && onRowClick(key)}
              >
                <td className="px-3 py-2 text-gray-200 text-xs whitespace-nowrap">{renderLabel(row)}</td>
                <td className="px-3 py-2 text-right text-gray-300 text-xs">{row.signups}</td>
                <td className="px-3 py-2 text-right text-gray-400 text-xs">{row.deleted || 0}</td>
                <td className="px-3 py-2 text-right text-green-400 text-xs">{formatRevenue(row.revenue_cents)}</td>
                <td className="px-1 py-1 text-center">
                  {row.upload_success_pct == null
                    ? <span className="text-gray-500 text-xs">--</span>
                    : (
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cellColor(row.upload_success_pct)}`}>
                        {fmtPct(row.upload_success_pct)}
                      </span>
                    )}
                </td>
                <td className="px-3 py-2 text-center text-gray-300 text-xs whitespace-nowrap">
                  {row.upload_tries} / {row.upload_successes}
                </td>
                <td className="px-3 py-2 text-center whitespace-nowrap">
                  <FirstHighlightCell value={row.first_highlight_14d} />
                </td>
                {COUNT_COLS.map(c => (
                  <td key={c.key} className="px-3 py-2 text-right text-gray-300 text-xs">{row[c.key]}</td>
                ))}
                {STEP_COLS.map(c => (
                  <td key={c.key} className="px-1 py-1 text-center">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cellColor(row[c.key])}`}>
                      {fmtPct(row[c.key])}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
          {unattributedRevenueCents ? (
            <tr className="border-t border-white/10">
              <td className="px-3 py-2 text-gray-400 text-xs italic" colSpan={3}>
                Unattributed <span className="text-gray-500">(deleted or out-of-window payers)</span>
              </td>
              <td className="px-3 py-2 text-right text-green-400 text-xs">{formatRevenue(unattributedRevenueCents)}</td>
              <td className="px-3 py-2" colSpan={3 + COUNT_COLS.length + STEP_COLS.length} />
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

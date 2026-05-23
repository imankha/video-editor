import React from 'react';

const STAGE_COLS = [
  { key: 'uploaded_pct', label: 'Uploaded' },
  { key: 'clipped_pct', label: 'Clipped' },
  { key: 'annotation_done_pct', label: 'Annotated' },
  { key: 'framing_opened_pct', label: 'Framing' },
  { key: 'framing_exported_pct', label: 'Framed' },
  { key: 'overlay_exported_pct', label: 'Overlay' },
  { key: 'gallery_viewed_pct', label: 'Gallery' },
  { key: 'downloaded_pct', label: 'Download' },
  { key: 'shared_pct', label: 'Shared' },
  { key: 'purchased_pct', label: 'Purchased' },
];

function cellColor(pct) {
  if (pct >= 60) return 'bg-green-500/30 text-green-300';
  if (pct >= 40) return 'bg-green-500/15 text-green-400';
  if (pct >= 20) return 'bg-yellow-500/20 text-yellow-400';
  return 'bg-red-500/15 text-red-400';
}

export function CohortGrid({ data }) {
  if (!data?.cohorts?.length) {
    return <p className="text-gray-500 text-sm">No cohort data available.</p>;
  }

  return (
    <div className="rounded-lg border border-white/10 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2.5">Cohort</th>
            <th className="text-right px-3 py-2.5">Signups</th>
            {STAGE_COLS.map(c => (
              <th key={c.key} className="text-center px-3 py-2.5">{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.cohorts.map(row => (
            <tr key={row.cohort_period} className="border-b border-white/5">
              <td className="px-3 py-2 text-gray-300 text-xs whitespace-nowrap">
                {row.cohort_period}
              </td>
              <td className="px-3 py-2 text-right text-gray-400 text-xs">{row.signups}</td>
              {STAGE_COLS.map(c => (
                <td key={c.key} className="px-1 py-1 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${cellColor(row[c.key])}`}>
                    {row[c.key]}%
                  </span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

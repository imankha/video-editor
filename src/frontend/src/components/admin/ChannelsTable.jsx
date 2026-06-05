import React from 'react';

function pctColor(pct) {
  if (pct >= 50) return 'text-green-400';
  if (pct >= 20) return 'text-yellow-400';
  return 'text-red-400';
}

function formatRevenue(cents) {
  if (!cents) return '$0';
  return `$${(cents / 100).toFixed(2)}`;
}

export function ChannelsTable({ data, onRowClick, selectedOrigin }) {
  if (!data?.channels?.length) {
    return <p className="text-gray-500 text-sm">No campaign data available.</p>;
  }

  return (
    <div className="rounded-lg border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2.5">Campaign</th>
            <th className="text-right px-3 py-2.5">Users</th>
            <th className="text-right px-3 py-2.5">Direct</th>
            <th className="text-right px-3 py-2.5">Viral</th>
            <th className="text-right px-3 py-2.5">Exported (%)</th>
            <th className="text-right px-3 py-2.5">Purchased (%)</th>
            <th className="text-right px-3 py-2.5">Revenue</th>
            <th className="text-right px-3 py-2.5">Avg Exports</th>
          </tr>
        </thead>
        <tbody>
          {data.channels.map((ch, i) => (
            <tr key={i} className={`border-b border-white/5 hover:bg-white/5 transition-colors cursor-pointer ${selectedOrigin === ch.origin ? 'bg-purple-500/15 border-l-2 border-l-purple-500' : ''}`} onClick={() => onRowClick && onRowClick(ch.origin)}>
              <td className="px-3 py-2.5 text-gray-200 text-xs">
                {ch.origin}
              </td>
              <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{ch.users}</td>
              <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{ch.direct}</td>
              <td className="px-3 py-2.5 text-right text-purple-400 text-xs">{ch.viral}</td>
              <td className={`px-3 py-2.5 text-right text-xs ${pctColor(ch.export_pct)}`}>
                {ch.exported} ({ch.export_pct}%)
              </td>
              <td className={`px-3 py-2.5 text-right text-xs ${pctColor(ch.purchase_pct)}`}>
                {ch.purchased} ({ch.purchase_pct}%)
              </td>
              <td className="px-3 py-2.5 text-right text-green-400 text-xs">{formatRevenue(ch.revenue_cents)}</td>
              <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{ch.avg_exports}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

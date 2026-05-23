import React from 'react';

function pctColor(pct) {
  if (pct >= 50) return 'text-green-400';
  if (pct >= 20) return 'text-yellow-400';
  return 'text-red-400';
}

export function ChannelsTable({ data }) {
  if (!data?.channels?.length) {
    return <p className="text-gray-500 text-sm">No channel data available.</p>;
  }

  return (
    <div className="rounded-lg border border-white/10">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2.5">Channel</th>
            <th className="text-right px-3 py-2.5">Signups</th>
            <th className="text-right px-3 py-2.5">Exported (%)</th>
            <th className="text-right px-3 py-2.5">Purchased (%)</th>
            <th className="text-right px-3 py-2.5">Avg Exports</th>
          </tr>
        </thead>
        <tbody>
          {data.channels.map((ch, i) => (
            <tr key={i} className="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td className="px-3 py-2.5 text-gray-200 text-xs">
                {ch.origin_type}
                {ch.origin_channel && <span className="text-gray-500 ml-1">/ {ch.origin_channel}</span>}
              </td>
              <td className="px-3 py-2.5 text-right text-gray-300 text-xs">{ch.signups}</td>
              <td className={`px-3 py-2.5 text-right text-xs ${pctColor(ch.export_pct)}`}>
                {ch.exported} ({ch.export_pct}%)
              </td>
              <td className={`px-3 py-2.5 text-right text-xs ${pctColor(ch.purchase_pct)}`}>
                {ch.purchased} ({ch.purchase_pct}%)
              </td>
              <td className="px-3 py-2.5 text-right text-gray-400 text-xs">{ch.avg_exports}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

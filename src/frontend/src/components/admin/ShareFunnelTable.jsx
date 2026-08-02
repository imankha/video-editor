import React from 'react';

// T5740: read-only per-link growth funnel for public game links.
// One row per link: views -> claims -> activated accounts.
export function ShareFunnelTable({ data }) {
  if (!data?.links?.length) {
    return <p className="text-gray-500 text-sm">No public game links yet.</p>;
  }

  return (
    <div className="rounded-lg border border-white/10 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-gray-400 text-xs uppercase tracking-wider">
            <th className="text-left px-3 py-2.5">Game</th>
            <th className="text-left px-3 py-2.5">Sharer</th>
            <th className="text-right px-3 py-2.5">Views</th>
            <th className="text-right px-3 py-2.5">Claims</th>
            <th className="text-right px-3 py-2.5">Activated</th>
            <th className="text-right px-3 py-2.5">Status</th>
          </tr>
        </thead>
        <tbody>
          {data.links.map((link) => (
            <tr key={link.share_token} className="border-b border-white/5 hover:bg-white/5 transition-colors">
              <td className="px-3 py-2.5 text-gray-200 text-xs max-w-[180px] truncate" title={link.game_name}>
                {link.game_name}
              </td>
              <td className="px-3 py-2.5 text-gray-400 text-xs max-w-[160px] truncate" title={link.sharer_email || ''}>
                {link.sharer_email || '—'}
              </td>
              <td className="px-3 py-2.5 text-right text-gray-300 text-xs tabular-nums">
                {link.views == null ? '—' : link.views}
              </td>
              <td className="px-3 py-2.5 text-right text-cyan-400 text-xs tabular-nums">{link.claims}</td>
              <td className="px-3 py-2.5 text-right text-green-400 text-xs tabular-nums">{link.activated}</td>
              <td className="px-3 py-2.5 text-right text-xs">
                {link.revoked
                  ? <span className="text-red-400">Revoked</span>
                  : <span className="text-green-400">Active</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[11px] text-gray-500 px-3 py-2">
        Activated = claimers who have completed an export ({data.activation_metric}). Views read
        from each sharer&rsquo;s logged share views; &ldquo;—&rdquo; means the count is unavailable.
      </p>
    </div>
  );
}

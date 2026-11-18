import { DimensionTable } from './DimensionTable';
import { OriginLabel } from './OriginLabel';
import { channelsCsv } from './channelsCsv';

// T15120: every value GET /analytics/channels accepts for `by`.
const DIMENSIONS = [
  { by: 'origin', label: 'Origin' },
  { by: 'utm_campaign', label: 'Campaign' },
  { by: 'utm_source', label: 'Source' },
  { by: 'utm_medium', label: 'Medium' },
  { by: 'utm_term', label: 'Term' },
  { by: 'utm_content', label: 'Content' },
  { by: 'click_source', label: 'Click source' },
  { by: 'referral_channel', label: 'Referral channel' },
  { by: 'referrer_host', label: 'Referring website' },
  { by: 'country', label: 'Country' },
];

// T16900: the day new sign-ups stopped getting `organic` (owner ruling). Move it to the
// prod deploy date if T16900 ships later.
const ORGANIC_RETIRED_ON = '2026-11-17';

function downloadCsv(text, by) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `channels-${by}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(url);
}

// Campaigns dimension: one row per `by` value, labeled by campaign name where the value
// can be a registry id (T13980). Only origin rows click through: GET /api/admin/users
// has no filter on the raw attribution fields (T15120).
export function ChannelsTable({ data, onRowClick, onCountryClick, selectedOrigin, selectedCountry, by = 'origin', onByChange }) {
  const { label } = DIMENSIONS.find(d => d.by === by);
  const rows = data?.channels ?? [];
  const remainder = data?.unattributed_revenue_cents;
  const filtersUsers = by === 'origin' || by === 'country';
  const showOrganicNote = by === 'origin' && rows.some(ch => ch.origin === 'organic');
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-gray-400">
          Group by
          <select
            value={by}
            onChange={e => onByChange(e.target.value)}
            className="rounded border border-white/10 bg-gray-900 px-2 py-1 text-xs text-gray-200"
          >
            {DIMENSIONS.map(d => <option key={d.by} value={d.by}>{d.label}</option>)}
          </select>
        </label>
        <button
          type="button"
          disabled={!rows.length}
          onClick={() => downloadCsv(channelsCsv(rows, by, label, remainder), by)}
          className="rounded border border-white/10 px-2 py-1 text-xs text-gray-300 hover:bg-white/5 disabled:opacity-40"
        >
          Download CSV
        </button>
        {!filtersUsers && (
          <span className="text-xs text-gray-500">Only Origin and Country rows filter the Users table.</span>
        )}
      </div>
      {showOrganicNote && (
        <p className="text-xs text-gray-500">
          organic: source unknown, for sign-ups before {ORGANIC_RETIRED_ON} and people they invited.
          Newer sign-ups with no campaign show as direct (no referring website) or other-website
          (a website not on our list).
        </p>
      )}
      <DimensionTable
        rows={data?.channels}
        labelHeader={by === 'origin' ? 'Campaign' : label}
        rowKey={ch => ch[by]}
        renderLabel={ch => <OriginLabel origin={ch[by]} campaignName={ch.campaign_name} group={ch.group} />}
        isSelectable={() => filtersUsers}
        onRowClick={by === 'country' ? onCountryClick : onRowClick}
        selectedKey={{ origin: selectedOrigin, country: selectedCountry }[by]}
        unattributedRevenueCents={remainder}
        emptyText="No campaign data available."
      />
    </div>
  );
}

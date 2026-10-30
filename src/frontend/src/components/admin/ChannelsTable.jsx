import { DimensionTable } from './DimensionTable';
import { OriginLabel } from './OriginLabel';

// Campaigns dimension: one row per origin, labeled by campaign name (T13980).
export function ChannelsTable({ data, onRowClick, selectedOrigin }) {
  return (
    <DimensionTable
      rows={data?.channels}
      labelHeader="Campaign"
      rowKey={ch => ch.origin}
      renderLabel={ch => <OriginLabel origin={ch.origin} campaignName={ch.campaign_name} />}
      onRowClick={onRowClick}
      selectedKey={selectedOrigin}
      unattributedRevenueCents={data?.unattributed_revenue_cents}
      emptyText="No campaign data available."
    />
  );
}

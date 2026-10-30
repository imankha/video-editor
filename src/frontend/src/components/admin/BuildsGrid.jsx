import { DimensionTable } from './DimensionTable';

const BUILD_TITLE =
  'The server build when the account signed up. A client still on an older app shell '
  + 'that signs up against a newer server counts under the server build.';

function BuildLabel({ row }) {
  if (row.build === 'unrecorded') {
    return <span className="italic text-gray-400">Unrecorded</span>;
  }
  return (
    <>
      <span>{`#${row.build} (${row.commit_sha ? row.commit_sha.slice(0, 7) : '?'})`}</span>
      <span className="ml-2 text-gray-500" title="First signup on this build">{row.first_signup_at.slice(0, 10)}</span>
    </>
  );
}

// T14000: Builds dimension, keyed by signup build (GET /api/admin/analytics/builds).
// "unrecorded" = accounts that signed up before build capture; it has no build to filter by.
export function BuildsGrid({ data, onRowClick, selectedBuild }) {
  return (
    <DimensionTable
      rows={data?.builds}
      labelHeader="Build"
      labelTitle={BUILD_TITLE}
      rowKey={row => row.build}
      renderLabel={row => <BuildLabel row={row} />}
      isSelectable={row => row.build !== 'unrecorded'}
      onRowClick={onRowClick}
      selectedKey={selectedBuild}
      unattributedRevenueCents={data?.unattributed_revenue_cents}
      emptyText="No build data available."
    />
  );
}

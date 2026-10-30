import { DimensionTable } from './DimensionTable';

// Cohorts dimension: one row per signup week.
export function CohortGrid({ data, onRowClick, selectedPeriod }) {
  return (
    <DimensionTable
      rows={data?.cohorts}
      labelHeader="Cohort"
      rowKey={row => row.cohort_period}
      renderLabel={row => row.cohort_period}
      onRowClick={onRowClick}
      selectedKey={selectedPeriod}
      unattributedRevenueCents={data?.unattributed_revenue_cents}
      emptyText="No cohort data available."
    />
  );
}

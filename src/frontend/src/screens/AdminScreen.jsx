import { useEffect, useRef, useState } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { ArrowLeft, ShieldCheck, ChevronDown, ChevronRight, Megaphone, X } from 'lucide-react';
import { useAdminStore } from '../stores/adminStore';
import { useAuthStore } from '../stores/authStore';
import { UserTable } from '../components/admin/UserTable';
import { PulseCards } from '../components/admin/PulseCards';
import { JourneyTab } from '../components/admin/JourneyTab';
import { ChannelsTable } from '../components/admin/ChannelsTable';
import { CountrySelect } from '../components/admin/CountrySelect';
import { CohortGrid } from '../components/admin/CohortGrid';
import { BuildsGrid } from '../components/admin/BuildsGrid';
import { OriginLabel } from '../components/admin/OriginLabel';
import { PlatformBreakdown } from '../components/admin/PlatformBreakdown';
import { UserDetailPanel } from '../components/admin/UserDetailPanel';
import { RevenueReconciliation } from '../components/admin/RevenueReconciliation';
import { UploadFailuresPanel } from '../components/admin/UploadFailuresPanel';
import { R2UsagePanel } from '../components/admin/R2UsagePanel';
import { PackMixTable } from '../components/admin/PackMixTable';
import { DayNRetentionTable } from '../components/admin/DayNRetentionTable';
import { RetentionView } from '../components/admin/RetentionView';
import { ActivationReport } from '../components/admin/ActivationReport';
import { BySportTable } from '../components/admin/BySportTable';
import { CampaignsModal } from '../components/admin/CampaignsModal';

// Pass `open` + `onToggle` when the screen must open the section itself (T14740: Users).
function CollapsibleSection({ title, defaultOpen = false, open: controlledOpen, onToggle, sectionRef, children }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen);
  const open = controlledOpen ?? localOpen;
  return (
    <div ref={sectionRef} className="bg-white/5 rounded-xl border border-white/10 mb-6 overflow-hidden">
      <button
        onClick={onToggle ?? (() => setLocalOpen(o => !o))}
        className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-white/5 transition-colors"
      >
        {open ? <ChevronDown size={16} className="text-gray-400" /> : <ChevronRight size={16} className="text-gray-400" />}
        <span className="text-gray-300 text-sm font-medium">{title}</span>
      </button>
      {open && <div className="px-5 pb-5">{children}</div>}
    </div>
  );
}

const JOURNEY_OUTCOME_WORDS = { in_window: 'in window', stuck: 'stuck', gone: 'gone', lost: 'lost' };

const ENV_STYLES = {
  dev: 'bg-green-500/20 text-green-400 border-green-500/40',
  staging: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  production: 'bg-red-500/20 text-red-400 border-red-500/40',
};

const USER_FILTERS = [
  { key: 'paying', label: 'Paying' },
  { key: 'active_7d', label: 'Active (7d)' },
  { key: 'has_exports', label: 'Has Exports' },
  { key: 'invited_others', label: 'Invited Others' },
  { key: 'was_invited', label: 'Was Invited' },
];

// T13990: mutually exclusive filter dimensions; exactly one table shows at a time.
const DIMENSIONS = [
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'cohorts', label: 'Cohorts' },
  { key: 'builds', label: 'Builds' },
];

export function AdminScreen({ onBack }) {
  const users = useAdminStore(s => s.users);
  const loading = useAdminStore(s => s.usersLoading);
  const error = useAdminStore(s => s.usersError);
  const funnelTotals = useAdminStore(s => s.funnelTotals);
  const segmentOrigin = useAdminStore(s => s.segmentOrigin);
  const segmentFrom = useAdminStore(s => s.segmentFrom);
  const segmentTo = useAdminStore(s => s.segmentTo);
  const segmentBuild = useAdminStore(s => s.segmentBuild);
  const segmentCountry = useAdminStore(s => s.segmentCountry);
  const setSegmentFilter = useAdminStore(s => s.setSegmentFilter);
  const setSegmentCountry = useAdminStore(s => s.setSegmentCountry);
  const dimension = useAdminStore(s => s.dimension);
  const setDimension = useAdminStore(s => s.setDimension);
  const clearSegmentFilter = useAdminStore(s => s.clearSegmentFilter);
  const userFilter = useAdminStore(s => s.userFilter);
  const setUserFilter = useAdminStore(s => s.setUserFilter);
  const journeyUserFilter = useAdminStore(s => s.journeyUserFilter);
  const clearJourneyUserFilter = useAdminStore(s => s.clearJourneyUserFilter);
  const excludeTest = useAdminStore(s => s.excludeTest);
  const setExcludeTest = useAdminStore(s => s.setExcludeTest);
  const userDetailData = useAdminStore(s => s.userDetailData);
  const userDetailLoading = useAdminStore(s => s.userDetailLoading);
  const fetchUserDetail = useAdminStore(s => s.fetchUserDetail);
  const clearUserDetail = useAdminStore(s => s.clearUserDetail);
  const environment = useAuthStore(s => s.adminEnvironment);

  const pulseData = useAdminStore(s => s.pulseData);
  const channelsData = useAdminStore(s => s.channelsData);
  const channelsLoading = useAdminStore(s => s.channelsLoading);
  const channelsBy = useAdminStore(s => s.channelsBy);
  const setChannelsBy = useAdminStore(s => s.setChannelsBy);
  const cohortsData = useAdminStore(s => s.cohortsData);
  const cohortsLoading = useAdminStore(s => s.cohortsLoading);
  const buildsData = useAdminStore(s => s.buildsData);
  const buildsLoading = useAdminStore(s => s.buildsLoading);
  const platformsData = useAdminStore(s => s.platformsData);
  const fetchDashboard = useAdminStore(s => s.fetchDashboard);

  // T10270: deliberately NOT part of fetchDashboard's combined mount fetch --
  // a separate, on-demand drill-down (AdminScreen.test.jsx asserts exactly
  // one mount request for /api/admin/dashboard).
  const uploadFailuresData = useAdminStore(s => s.uploadFailuresData);
  const uploadFailuresLoading = useAdminStore(s => s.uploadFailuresLoading);
  const uploadFailuresError = useAdminStore(s => s.uploadFailuresError);
  const fetchUploadFailures = useAdminStore(s => s.fetchUploadFailures);
  const r2UsageData = useAdminStore(s => s.r2UsageData);
  const r2UsageLoading = useAdminStore(s => s.r2UsageLoading);
  const r2UsageError = useAdminStore(s => s.r2UsageError);
  const fetchR2Usage = useAdminStore(s => s.fetchR2Usage);
  const packMixData = useAdminStore(s => s.packMixData);
  const packMixLoading = useAdminStore(s => s.packMixLoading);
  const packMixError = useAdminStore(s => s.packMixError);
  const fetchPackMix = useAdminStore(s => s.fetchPackMix);
  const retentionData = useAdminStore(s => s.retentionData);
  const retentionLoading = useAdminStore(s => s.retentionLoading);
  const retentionError = useAdminStore(s => s.retentionError);
  const fetchRetention = useAdminStore(s => s.fetchRetention);
  const retentionChartData = useAdminStore(s => s.retentionChartData);
  const retentionChartLoading = useAdminStore(s => s.retentionChartLoading);
  const retentionChartError = useAdminStore(s => s.retentionChartError);
  const retentionChartAction = useAdminStore(s => s.retentionChartAction);
  const setRetentionChartAction = useAdminStore(s => s.setRetentionChartAction);
  const fetchRetentionChart = useAdminStore(s => s.fetchRetentionChart);
  const activationData = useAdminStore(s => s.activationData);
  const activationLoading = useAdminStore(s => s.activationLoading);
  const activationError = useAdminStore(s => s.activationError);
  const fetchActivation = useAdminStore(s => s.fetchActivation);
  const bySportData = useAdminStore(s => s.bySportData);
  const bySportLoading = useAdminStore(s => s.bySportLoading);
  const bySportError = useAdminStore(s => s.bySportError);
  const fetchBySport = useAdminStore(s => s.fetchBySport);
  const actionRollup = useAdminStore(s => s.actionRollup);
  const runActionRollup = useAdminStore(s => s.runActionRollup);
  const fetchCampaigns = useAdminStore(s => s.fetchCampaigns);
  const [showCampaigns, setShowCampaigns] = useState(false);
  const [usersOpen, setUsersOpen] = useState(true);
  const usersSectionRef = useRef(null);
  // T14910: the Spend readiness upload-failure gate drills into this section.
  const [uploadFailuresOpen, setUploadFailuresOpen] = useState(false);
  const uploadFailuresSectionRef = useRef(null);

  // T8020: one combined round-trip on mount instead of 5 separate fetches. The
  // individual actions above stay wired for their other callers (pagination,
  // setSegmentFilter campaign click-through), which keep hitting their own endpoints.
  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const hasFilter = segmentOrigin || segmentFrom || segmentTo || segmentBuild !== null || segmentCountry || userFilter || journeyUserFilter;
  // A Journey list keeps users with no email: the map counts them, and the rows must equal
  // the number clicked.
  const knownUsers = journeyUserFilter ? users : users.filter(u => u.email);

  // T14740: a Journey drop-off count was clicked and its list landed. Open and render first:
  // a scroll against the shorter page stops short of the section.
  function showUsers() {
    flushSync(() => setUsersOpen(true));
    usersSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // T14910: a Spend readiness drill opens Upload Failures, loads it if it is still empty
  // (the click is the gesture), and scrolls to it.
  function showUploadFailures() {
    flushSync(() => setUploadFailuresOpen(true));
    if (!uploadFailuresData) fetchUploadFailures();
    uploadFailuresSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // T13980: the click is the gesture that loads the list (never on mount).
  function openCampaigns() {
    fetchCampaigns();
    setShowCampaigns(true);
  }

  // T13990: row selections are mutually exclusive across dimensions -- picking a
  // campaign clears the cohort and vice versa (and the build: setSegmentFilter's
  // omitted 4th arg clears it, T14000).
  function handleCampaignClick(origin) {
    if (segmentOrigin === origin) {
      setSegmentFilter(null, null, null);
    } else {
      setSegmentFilter(origin, null, null);
    }
  }

  function handleCohortClick(cohortPeriod) {
    if (segmentFrom === cohortPeriod) {
      setSegmentFilter(null, null, null);
    } else {
      const d = new Date(cohortPeriod);
      d.setDate(d.getDate() + 6);
      setSegmentFilter(null, cohortPeriod, d.toISOString().slice(0, 10));
    }
  }

  function handleBuildClick(build) {
    setSegmentFilter(null, null, null, segmentBuild === build ? null : build);
  }

  function handleCountryClick(country) {
    setSegmentCountry(segmentCountry === country ? null : country);
  }

  // T13990: the applied row selection, shown beside Clear all so a filter from a
  // hidden dimension is never invisible.
  let selectionChip = null;
  if (segmentOrigin) {
    const channel = channelsData?.channels.find(ch => ch.origin === segmentOrigin);
    selectionChip = <>Campaign: <OriginLabel origin={segmentOrigin} campaignName={channel?.campaign_name} /></>;
  } else if (segmentFrom) {
    selectionChip = <>Cohort: {segmentFrom}</>;
  } else if (segmentBuild !== null) {
    selectionChip = <>Build #{segmentBuild}</>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="mx-auto px-6 py-8 max-w-[1600px]">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button onClick={onBack} className="text-gray-400 hover:text-white transition-colors" title="Back">
            <ArrowLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <ShieldCheck size={20} className="text-purple-400" />
            <h1 className="text-white text-xl font-semibold">Admin Panel</h1>
            {environment && (
              <span className={`px-2 py-0.5 text-xs font-mono font-semibold rounded border uppercase ${ENV_STYLES[environment] || ENV_STYLES.dev}`}>
                {environment === 'production' ? 'PROD' : environment.toUpperCase()}
              </span>
            )}
          </div>
          <button
            onClick={openCampaigns}
            className="ml-2 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 transition-colors"
          >
            <Megaphone size={14} />
            Manage Campaigns
          </button>
        </div>

        {/* Filters -- one dimension at a time (T13990) */}
        <div className="bg-white/5 rounded-xl border border-white/10 mb-6 overflow-hidden">
          {/* User type pills */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 flex-wrap">
            <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Filter</span>
            {/* T8110: "Real" hides internal/test accounts. It toggles
                INDEPENDENTLY of the exclusive segment pills (composes -- Real +
                Paying = real paying users), so it sits apart with a divider and
                its own colour. Default ON. */}
            <button
              onClick={() => setExcludeTest(!excludeTest)}
              title="Hide internal / test accounts"
              className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                excludeTest
                  ? 'bg-emerald-500/30 text-emerald-300 border border-emerald-500/40'
                  : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
              }`}
            >
              Real
            </button>
            <span className="w-px h-4 bg-white/10 mx-1" aria-hidden="true" />
            {USER_FILTERS.map(f => (
              <button
                key={f.key}
                onClick={() => setUserFilter(userFilter === f.key ? null : f.key)}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  userFilter === f.key
                    ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                    : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
                }`}
              >
                {f.label}
              </button>
            ))}
            <span className="w-px h-4 bg-white/10 mx-1" aria-hidden="true" />
            <CountrySelect />
            {selectionChip && (
              <span
                data-testid="active-selection-chip"
                className="ml-auto px-2.5 py-1 text-xs rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30"
              >
                {selectionChip}
              </span>
            )}
            {hasFilter && (
              <button
                onClick={clearSegmentFilter}
                className={`text-gray-500 hover:text-white text-xs underline ${selectionChip ? '' : 'ml-auto'}`}
              >
                Clear all
              </button>
            )}
          </div>

          {/* T13990: dimension pills -- only the active dimension's table is mounted */}
          <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 flex-wrap">
            <span className="text-gray-500 text-xs uppercase tracking-wider mr-1">Dimension</span>
            {DIMENSIONS.map(d => (
              <button
                key={d.key}
                onClick={() => setDimension(d.key)}
                aria-pressed={dimension === d.key}
                className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                  dimension === d.key
                    ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                    : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <div className="px-5 py-3">
            {dimension === 'campaigns' && (channelsLoading
              ? <p className="text-gray-500 text-xs">Loading...</p>
              : <ChannelsTable
                  data={channelsData}
                  onRowClick={handleCampaignClick}
                  onCountryClick={handleCountryClick}
                  selectedOrigin={segmentOrigin}
                  selectedCountry={segmentCountry}
                  by={channelsBy}
                  onByChange={setChannelsBy}
                />
            )}
            {dimension === 'cohorts' && (cohortsLoading
              ? <p className="text-gray-500 text-xs">Loading...</p>
              : <CohortGrid data={cohortsData} onRowClick={handleCohortClick} selectedPeriod={segmentFrom} />
            )}
            {dimension === 'builds' && (buildsLoading
              ? <p className="text-gray-500 text-xs">Loading...</p>
              : <BuildsGrid data={buildsData} onRowClick={handleBuildClick} selectedBuild={segmentBuild} />
            )}
          </div>
        </div>

        {/* Results -- everything below reflects the active filters */}

        {/* Pulse */}
        <PulseCards data={pulseData} />

        {/* Platform Breakdown -- collapsed by default */}
        <CollapsibleSection title="Platform Breakdown">
          <PlatformBreakdown data={platformsData} />
        </CollapsibleSection>

        {/* Journey -- expanded by default (T14010: replaces the Funnel section). Owns its own
            filters and its read of /analytics/journey; funnelTotals stays for UserTable. */}
        <CollapsibleSection title="Journey" defaultOpen>
          <JourneyTab onShowUsers={showUsers} onShowUploadFailures={showUploadFailures} />
        </CollapsibleSection>

        {/* Users -- expanded by default */}
        <CollapsibleSection title="Users" open={usersOpen} onToggle={() => setUsersOpen(o => !o)} sectionRef={usersSectionRef}>
          {journeyUserFilter && (
            <div className="mb-3">
              <span
                data-testid="journey-user-chip"
                title={journeyUserFilter.count == null ? undefined : `${journeyUserFilter.count} ${journeyUserFilter.count === 1 ? 'user' : 'users'}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-full bg-purple-500/20 text-purple-300 border border-purple-500/30"
              >
                {journeyUserFilter.gate ? `${journeyUserFilter.label} (whole gate, segment filters not applied)` : <>Stopped at {journeyUserFilter.label}: {JOURNEY_OUTCOME_WORDS[journeyUserFilter.outcome]}{journeyUserFilter.count == null ? '' : ` (${journeyUserFilter.count})`}</>}
                <button
                  type="button"
                  onClick={clearJourneyUserFilter}
                  aria-label="Clear Journey filter"
                  className="text-purple-300 hover:text-white"
                >
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            </div>
          )}
          {loading && <p className="text-gray-500 text-sm">Loading users...</p>}
          {error && <p className="text-red-400 text-sm">Error: {error}</p>}
          {!loading && !error && knownUsers.length === 0 && (
            <p className="text-gray-500 text-sm">No users found{hasFilter ? ' for this filter' : ''}.</p>
          )}
          {!loading && !error && knownUsers.length > 0 && (
            <UserTable users={knownUsers} onUserClick={(userId) => fetchUserDetail(userId)} funnelTotals={funnelTotals} />
          )}
        </CollapsibleSection>

        {/* Revenue reconciliation -- Stripe as source of truth (T5760). Collapsed by
            default; the Stripe pass only runs when the admin clicks inside. */}
        <CollapsibleSection title="Revenue Reconciliation (Stripe)">
          <RevenueReconciliation />
        </CollapsibleSection>

        {/* T13330: pack mix from the payments ledger. Collapsed, on-demand fetch. */}
        <CollapsibleSection title="Pack Mix">
          <PackMixTable
            data={packMixData}
            loading={packMixLoading}
            error={packMixError}
            onRefresh={() => fetchPackMix()}
          />
        </CollapsibleSection>

        {/* T16070: day-1/3/7/14/28 retention by signup week. Collapsed, on-demand fetch. */}
        <CollapsibleSection title="Day N Retention">
          <DayNRetentionTable
            data={retentionData}
            loading={retentionLoading}
            error={retentionError}
            onRefresh={() => fetchRetention()}
          />
        </CollapsibleSection>

        {/* T7430: investor-grade retention chart -- triangle, curves, WAU, return-after-gap.
            Collapsed, on-demand fetch. */}
        <CollapsibleSection title="Retention Chart">
          <RetentionView
            data={retentionChartData}
            loading={retentionChartLoading}
            error={retentionChartError}
            onRefresh={() => fetchRetentionChart()}
            action={retentionChartAction}
            onActionChange={setRetentionChartAction}
          />
        </CollapsibleSection>

        {/* T7420: activation report -- export/share <=14d by monthly signup cohort.
            Collapsed, on-demand fetch. */}
        <CollapsibleSection title="Activation">
          <ActivationReport
            data={activationData}
            loading={activationLoading}
            error={activationError}
            onRefresh={() => fetchActivation()}
          />
        </CollapsibleSection>

        {/* T14950: total exports by sport, from T7400's analytics.sqlite rollup.
            Collapsed, on-demand fetch -- reads the existing rollup, never triggers one. */}
        <CollapsibleSection title="By Sport">
          <BySportTable
            data={bySportData}
            loading={bySportLoading}
            error={bySportError}
            onRefresh={() => fetchBySport()}
            actionRollup={actionRollup}
            onRunRollup={() => runActionRollup()}
          />
        </CollapsibleSection>

        {/* T10270: Upload Failures drill-down. Collapsed by default, separate
            on-demand fetch (never folded into the combined dashboard mount). */}
        <CollapsibleSection title="Upload Failures" open={uploadFailuresOpen}
                            onToggle={() => setUploadFailuresOpen(o => !o)} sectionRef={uploadFailuresSectionRef}>
          <UploadFailuresPanel
            data={uploadFailuresData}
            loading={uploadFailuresLoading}
            error={uploadFailuresError}
            onRefresh={() => fetchUploadFailures()}
          />
        </CollapsibleSection>

        {/* T13931: R2 operations by source vs the free tier. Collapsed, on-demand fetch. */}
        <CollapsibleSection title="R2 Usage">
          <R2UsagePanel
            data={r2UsageData}
            loading={r2UsageLoading}
            error={r2UsageError}
            onRefresh={() => fetchR2Usage()}
          />
        </CollapsibleSection>

        {/* T14730: a person clicked in a full-screen Journey must open inside that element;
            only it and its children are visible. */}
        {(userDetailData || userDetailLoading) && createPortal(
          <UserDetailPanel data={userDetailData} onClose={clearUserDetail} />,
          document.fullscreenElement ?? document.body,
        )}

        {showCampaigns && <CampaignsModal onClose={() => setShowCampaigns(false)} />}
      </div>
    </div>
  );
}

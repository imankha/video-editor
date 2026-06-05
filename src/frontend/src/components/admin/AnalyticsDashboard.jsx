import React, { useEffect, useState } from 'react';
import { useAdminStore } from '../../stores/adminStore';
import { PulseCards } from './PulseCards';
import { FunnelChart } from './FunnelChart';
import { ChannelsTable } from './ChannelsTable';
import { CohortGrid } from './CohortGrid';

const SUB_TABS = [
  { key: 'funnel', label: 'Funnel' },
  { key: 'channels', label: 'Campaigns' },
  { key: 'cohorts', label: 'Cohorts' },
];

export function AnalyticsDashboard() {
  const [subTab, setSubTab] = useState('funnel');

  const fetchPulse = useAdminStore(s => s.fetchPulse);
  const fetchFunnel = useAdminStore(s => s.fetchFunnel);
  const fetchChannels = useAdminStore(s => s.fetchChannels);
  const fetchCohorts = useAdminStore(s => s.fetchCohorts);

  const pulseData = useAdminStore(s => s.pulseData);
  const pulseLoading = useAdminStore(s => s.pulseLoading);
  const funnelData = useAdminStore(s => s.funnelData);
  const funnelLoading = useAdminStore(s => s.funnelLoading);
  const channelsData = useAdminStore(s => s.channelsData);
  const channelsLoading = useAdminStore(s => s.channelsLoading);
  const cohortsData = useAdminStore(s => s.cohortsData);
  const cohortsLoading = useAdminStore(s => s.cohortsLoading);

  useEffect(() => {
    fetchPulse();
  }, [fetchPulse]);

  useEffect(() => {
    if (subTab === 'funnel' && !funnelData) fetchFunnel();
    if (subTab === 'channels' && !channelsData) fetchChannels();
    if (subTab === 'cohorts' && !cohortsData) fetchCohorts();
  }, [subTab, funnelData, channelsData, cohortsData, fetchFunnel, fetchChannels, fetchCohorts]);

  return (
    <div>
      {pulseLoading && <p className="text-gray-500 text-sm mb-4">Loading pulse...</p>}
      <PulseCards data={pulseData} />

      <div className="flex items-center gap-1 mb-4">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setSubTab(t.key)}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              subTab === t.key
                ? 'bg-purple-500/30 text-purple-300 border border-purple-500/40'
                : 'text-gray-400 hover:text-gray-300 border border-white/10 hover:border-white/20'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white/5 rounded-xl p-5 border border-white/10">
        {subTab === 'funnel' && (
          funnelLoading
            ? <p className="text-gray-500 text-sm">Loading funnel...</p>
            : <FunnelChart data={funnelData} />
        )}
        {subTab === 'channels' && (
          channelsLoading
            ? <p className="text-gray-500 text-sm">Loading channels...</p>
            : <ChannelsTable data={channelsData} />
        )}
        {subTab === 'cohorts' && (
          cohortsLoading
            ? <p className="text-gray-500 text-sm">Loading cohorts...</p>
            : <CohortGrid data={cohortsData} />
        )}
      </div>
    </div>
  );
}

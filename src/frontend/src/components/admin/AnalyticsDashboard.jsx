import React, { useEffect, useState } from 'react';
import { useAdminStore } from '../../stores/adminStore';
import { PulseCards } from './PulseCards';
import { JourneyTab } from './JourneyTab';
import { ChannelsTable } from './ChannelsTable';
import { CohortGrid } from './CohortGrid';
import { ShareFunnelTable } from './ShareFunnelTable';

const SUB_TABS = [
  { key: 'journey', label: 'Journey' },
  { key: 'channels', label: 'Campaigns' },
  { key: 'cohorts', label: 'Cohorts' },
  { key: 'shares', label: 'Share Links' },
];

export function AnalyticsDashboard() {
  const [subTab, setSubTab] = useState('journey');

  const fetchPulse = useAdminStore(s => s.fetchPulse);
  const fetchChannels = useAdminStore(s => s.fetchChannels);
  const fetchCohorts = useAdminStore(s => s.fetchCohorts);
  const fetchShareFunnel = useAdminStore(s => s.fetchShareFunnel);

  const pulseData = useAdminStore(s => s.pulseData);
  const pulseLoading = useAdminStore(s => s.pulseLoading);
  const shareFunnelData = useAdminStore(s => s.shareFunnelData);
  const shareFunnelLoading = useAdminStore(s => s.shareFunnelLoading);
  const channelsData = useAdminStore(s => s.channelsData);
  const channelsLoading = useAdminStore(s => s.channelsLoading);
  const cohortsData = useAdminStore(s => s.cohortsData);
  const cohortsLoading = useAdminStore(s => s.cohortsLoading);

  useEffect(() => {
    fetchPulse();
  }, [fetchPulse]);

  useEffect(() => {
    if (subTab === 'channels' && !channelsData) fetchChannels();
    if (subTab === 'cohorts' && !cohortsData) fetchCohorts();
    if (subTab === 'shares' && !shareFunnelData) fetchShareFunnel();
  }, [subTab, channelsData, cohortsData, shareFunnelData, fetchChannels, fetchCohorts, fetchShareFunnel]);

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
        {subTab === 'journey' && <JourneyTab />}
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
        {subTab === 'shares' && (
          shareFunnelLoading
            ? <p className="text-gray-500 text-sm">Loading share links...</p>
            : <ShareFunnelTable data={shareFunnelData} />
        )}
      </div>
    </div>
  );
}

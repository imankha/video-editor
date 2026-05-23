import React from 'react';
import { X } from 'lucide-react';

const EVENT_LABELS = {
  signup_completed: 'Signup',
  game_created: 'Upload',
  clip_created: 'Clip',
  annotation_completed: 'Annotate',
  framing_opened: 'Open Framing',
  framing_exported: 'Frame Export',
  export_completed: 'Export',
  overlay_exported: 'Overlay Export',
  gallery_viewed: 'Gallery',
  video_downloaded: 'Download',
  share_completed: 'Share',
  credit_purchased: 'Purchase',
  pwa_installed: 'PWA Install',
  export_failed: 'Export Fail',
  credits_consumed: 'Credits Used',
};

function formatGap(ms) {
  if (ms < 60000) return '<1m';
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  if (ms < 86400000) return `${Math.round(ms / 3600000)}h`;
  return `${Math.round(ms / 86400000)}d`;
}

export function JourneyTimeline({ data, onClose }) {
  if (!data) return null;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-white/10 max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-white font-medium">{data.email}</h3>
            <div className="text-gray-400 text-xs mt-0.5">
              {data.origin_type}{data.origin_channel ? ` / ${data.origin_channel}` : ''}
              {' · '}Joined {data.install_day}
              {' · '}{data.session_count} sessions
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">
            <X size={18} />
          </button>
        </div>

        <div className="flex items-start gap-0 overflow-x-auto pb-4 pt-6">
          {data.milestones.map((m, i) => {
            const completed = !!m.at;
            const prev = i > 0 ? data.milestones[i - 1] : null;
            const gap = completed && prev?.at
              ? formatGap(new Date(m.at) - new Date(prev.at))
              : null;

            return (
              <div key={m.event} className="flex items-start">
                {i > 0 && (
                  <div className="flex flex-col items-center mt-3">
                    {gap && (
                      <span className="text-gray-500 text-[10px] mb-1 -mt-5">{gap}</span>
                    )}
                    <div className={`w-10 h-px ${completed ? 'bg-purple-500' : 'bg-gray-700'}`} />
                  </div>
                )}
                <div className="flex flex-col items-center min-w-[70px]">
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    completed
                      ? 'bg-purple-500 border-purple-400'
                      : 'bg-transparent border-gray-600'
                  }`}>
                    {completed && (
                      <div className="w-2 h-2 bg-white rounded-full" />
                    )}
                  </div>
                  <span className={`text-[10px] mt-1 text-center ${completed ? 'text-gray-300' : 'text-gray-600'}`}>
                    {EVENT_LABELS[m.event] || m.event}
                  </span>
                  {m.count != null && m.count > 0 && (
                    <span className="text-purple-400 text-[10px]">x{m.count}</span>
                  )}
                  {completed && (
                    <span className="text-gray-600 text-[9px] mt-0.5">
                      {new Date(m.at).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {data.last_active_at && (
          <div className="text-gray-500 text-xs mt-4 border-t border-white/5 pt-3">
            Last active: {new Date(data.last_active_at).toLocaleString()}
          </div>
        )}
      </div>
    </div>
  );
}

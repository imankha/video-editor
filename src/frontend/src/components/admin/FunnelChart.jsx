import React from 'react';

const STAGES = [
  { key: 'signed_up', label: 'Signed Up' },
  { key: 'session', label: 'Session' },
  // T7890: pre-upload funnel stages. "Add Game Opened" (entry gesture) and
  // "File Selected" (file chosen, pre-prepare) localize the signup->first-upload
  // cliff that was dark before game_created. Keys derive from the backend label
  // (label.lower().replace(' ','_')) — see analytics.FLOW_EVENTS/FUNNEL_STEPS.
  { key: 'add_game_opened', label: 'Add Game Opened' },
  { key: 'file_selected', label: 'File Selected' },
  // T7510: attempt vs durable-outcome are now distinct stages. "Upload Attempted"
  // (game_created, pending insert) precedes "Uploaded" (game_upload_succeeded,
  // R2-verified) so the attempt->durable drop-off gap is visible.
  { key: 'upload_attempted', label: 'Upload Attempted' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'clipped', label: 'Clipped' },
  // T11010: clip_uploaded ("Clip Uploaded") has been a FUNNEL_STEPS member since
  // T8370 but was never listed here, so the entire direct clip-upload flow was
  // invisible on this chart while its users still counted toward later steps.
  { key: 'clip_uploaded', label: 'Clip Uploaded' },
  // T7930: was 'annotation_done'/'Annotation Done'. This step fires on
  // finish-annotation (viewed_duration > 0), NOT on a clip being saved, so the
  // old label misread as content creation. Key derives from the backend label
  // (label.lower().replace(' ','_')), so it moved to 'watched_annotate_video'.
  { key: 'watched_annotate_video', label: 'Watched Annotate Video' },
  // T11010: these keys were 'framing_opened'/'framing_exported' and matched
  // NOTHING. The backend derives every funnel key from the event LABEL
  // (label.lower().replace(' ','_') -- admin.py analytics_funnel), and these
  // events are labelled "Focus Opened"/"Focus Exported", so both rows rendered a
  // hardcoded 0 while the user table happily showed accounts sitting AT Focus
  // Opened. Keys must be label-derived, never the event name.
  { key: 'focus_opened', label: 'Focus Opened' },
  { key: 'focus_exported', label: 'Focus Exported' },
  { key: 'overlay_exported', label: 'Overlay Exported' },
  { key: 'export_started', label: 'Export Started' },
  { key: 'exported', label: 'Exported' },
  { key: 'gallery_viewed', label: 'Gallery Viewed' },
  { key: 'downloaded', label: 'Downloaded' },
  { key: 'shared', label: 'Shared' },
  { key: 'invited', label: 'Invited' },
  { key: 'share_viewed', label: 'Share Viewed' },
  { key: 'purchased', label: 'Purchased' },
];

export function FunnelChart({ data }) {
  if (!data?.funnel?.length) {
    return <p className="text-gray-500 text-sm">No funnel data available.</p>;
  }

  const totals = data.funnel.find(r => r.origin === 'all') || data.funnel[0];
  const signedUp = totals[STAGES[0].key] || 1;

  return (
    <div className="space-y-2">
      {/* T11010: every bar is a DISTINCT-USER count (backend: COUNT(DISTINCT
          a.user_id) over user_actions), never a count of how many times the
          action happened -- one user who uploaded nine games is 1 here. Said out
          loud because the old step-over-step percentages below regularly read
          above 100% (114%, 138%, 700%), which looks exactly like event counting. */}
      <p className="text-gray-500 text-[11px] pb-1">
        Each bar counts <span className="text-gray-400">distinct users</span> who ever reached
        that step, not how many times the action happened. Percentages are share of signed-up users.
      </p>
      {STAGES.map((stage, i) => {
        const val = totals[stage.key] || 0;
        // Share of SIGNED UP, not of the previous step. These steps are not
        // nested -- a user can watch the Annotate video without saving a clip,
        // or export an overlay without ever exporting from Focus -- so
        // step-over-step conversion produced meaningless >100% rows. Against a
        // fixed denominator every row is comparable and bounded.
        const pct = Math.round((val / signedUp) * 100);

        return (
          <div key={stage.key} className="flex items-center gap-3">
            <div className="w-24 text-right text-gray-400 text-xs shrink-0">{stage.label}</div>
            <div className="flex-1 bg-white/5 rounded-full h-7 overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-600 to-purple-400 flex items-center px-3 transition-all"
                style={{ width: `${Math.max(pct, 2)}%` }}
              >
                <span className="text-white text-xs font-medium whitespace-nowrap">
                  {val}
                </span>
              </div>
            </div>
            <div className="w-16 text-gray-500 text-xs shrink-0">
              {i > 0 ? `${pct}%` : ''}
            </div>
          </div>
        );
      })}
    </div>
  );
}

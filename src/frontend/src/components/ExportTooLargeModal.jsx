import { AlertTriangle, Scissors, Layers } from 'lucide-react';
import { Button } from './shared/Button';
import { EXPORT_TOO_LARGE } from '../config/displayNames';

/**
 * ExportTooLargeModal (T11330) — explanatory popup shown when the T11320 preflight cost
 * guard rejects an export as too large for the video processor to finish in time.
 *
 * Bug 58p: a user retried the identical over-budget export four times over 13 hours because
 * a bare "Export failed" gave him nothing to act on. This popup names the WHY, the concrete
 * levers (crop in on the worst clips — listed by name — and/or split the batch), and the
 * honest credit outcome (net zero: reserved credits are refunded — T11330 Step 4 decision a).
 *
 * The rejection detail is the raw T11320 guard payload from the WS error frame
 * (`code === 'export_too_large'`); see export_cost_guard.py `to_error_detail()`.
 *
 * Convention: NO backdrop-close (CLAUDE.md UI rule + task file). The only exits are the
 * explicit "Got it" button and the corner control, so the guidance can't be dismissed by a
 * stray click. The backdrop is inert (no onClick), matching InsufficientCreditsModal.
 */
const MAX_CONTRIBUTORS_SHOWN = 3;

export function ExportTooLargeModal({ isOpen, rejection, projectName, onDismiss }) {
  if (!isOpen || !rejection) return null;

  // `biggest_contributors` is a backend-guaranteed list, but this is a UI boundary consuming a
  // WS frame: a malformed/absent list should degrade the popup, not crash the render, so we
  // tolerate it here rather than fail loud (the guard/tests enforce the shape upstream).
  const allContributors = Array.isArray(rejection.biggest_contributors)
    ? rejection.biggest_contributors
    : [];
  const contributors = allContributors.slice(0, MAX_CONTRIBUTORS_SHOWN);
  // The split suggestion only helps when more than one clip contributed cost; the single-clip
  // /render path hits this same guard, where "export fewer clips" isn't actionable (minor 2).
  const isMultiClip = allContributors.length > 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="export-too-large-title"
        data-testid="export-too-large-modal"
        className="relative bg-gray-800 rounded-xl shadow-2xl w-full max-w-md border border-gray-700 overflow-hidden"
      >
        <div className="flex items-start gap-3 p-5 border-b border-gray-700">
          <div className="p-2 bg-yellow-600/20 rounded-lg shrink-0">
            <AlertTriangle size={20} className="text-yellow-400" />
          </div>
          <div className="min-w-0">
            <h2 id="export-too-large-title" className="text-lg font-semibold text-white">
              {EXPORT_TOO_LARGE.TITLE}
            </h2>
            {projectName && (
              <p className="text-xs text-gray-400 mt-0.5 truncate">{projectName}</p>
            )}
          </div>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-300 leading-relaxed" data-testid="export-too-large-why">
            {EXPORT_TOO_LARGE.WHY}
          </p>

          <div className="space-y-2">
            <p className="text-sm font-medium text-white">{EXPORT_TOO_LARGE.WHAT_TO_DO_HEADING}</p>
            <ul className="space-y-2 text-sm text-gray-300">
              <li className="flex items-start gap-2">
                <Scissors size={16} className="text-blue-400 shrink-0 mt-0.5" />
                <span>{EXPORT_TOO_LARGE.SUGGESTION_CROP}</span>
              </li>
              {isMultiClip && (
                <li className="flex items-start gap-2" data-testid="export-too-large-split">
                  <Layers size={16} className="text-blue-400 shrink-0 mt-0.5" />
                  <span>{EXPORT_TOO_LARGE.SUGGESTION_SPLIT}</span>
                </li>
              )}
            </ul>
          </div>

          {contributors.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                {EXPORT_TOO_LARGE.CONTRIBUTORS_HEADING}
              </p>
              <ul className="space-y-1" data-testid="export-too-large-contributors">
                {contributors.map((c) => (
                  <li
                    key={`${c.clip_index}-${c.clip_name || ''}`}
                    className="text-xs text-gray-300 bg-gray-900/50 rounded px-2 py-1.5 break-words"
                  >
                    {EXPORT_TOO_LARGE.contributorLine(c)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-green-400" data-testid="export-too-large-credit-note">
            {EXPORT_TOO_LARGE.CREDIT_NOTE}
          </p>
        </div>

        <div className="p-4 border-t border-gray-700 flex justify-end">
          <Button variant="primary" size="md" onClick={onDismiss} data-testid="export-too-large-dismiss">
            {EXPORT_TOO_LARGE.DISMISS}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default ExportTooLargeModal;

import { Film, Sliders, Undo2, Eye, Download, Loader } from 'lucide-react';
import PrimaryCta from '../../../components/PrimaryCta';
import { FOCUS_COCKPIT } from '../../../config/displayNames';

/**
 * A single 44px rail button: icon over a 10px label. Right-thumb arc (D / §7).
 * Explicit `h-11` (44px) — the cockpit is coarse by definition, never relying on
 * the `coarse-pointer:` variant.
 */
function RailButton({ icon: Icon, label, onClick, active = false, disabled = false, testId }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-pressed={active}
      className={`flex h-11 w-16 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors disabled:opacity-40 ${
        active ? 'bg-blue-600/20 text-blue-300' : 'text-gray-400 hover:bg-white/10'
      }`}
    >
      <Icon size={18} aria-hidden="true" />
      <span className="text-[10px] leading-none">{label}</span>
    </button>
  );
}

/**
 * ActionRail (T10840, Zone D) — the 72px right edge rail. Four rail buttons
 * (Clips / Setup / Undo / Preview) top, then the `~N cr` estimate and the
 * compact primary CTA in the bottom-right corner (the best-reachable point, §7).
 *
 * The rail sits above the sheet scrim's z-index (`relative z-50`) so the CTA is
 * never dimmed while a sheet is open — matching the existing ActionBand contract
 * (D6). `px-1` keeps a missed CTA tap on padding, not on Android's system Back
 * button that abuts the right edge (D8).
 */
export default function ActionRail({
  activeSheet,
  onOpenClips,
  onOpenSetup,
  canUndo,
  onUndo,
  previewing,
  onTogglePreview,
  // Export CTA (D9/D13)
  ctaMode,
  estimatedCredits,
  ctaDisabled,
  ctaExporting,
  onGenerate,
  onBackToPreview,
  backToPreviewLoading,
}) {
  const isPreviewCta = ctaMode === 'preview';
  const cta = isPreviewCta ? (
    <PrimaryCta
      compact
      accent="focus"
      icon={backToPreviewLoading ? Loader : Eye}
      iconClassName={backToPreviewLoading ? 'animate-spin' : ''}
      onClick={onBackToPreview}
      disabled={backToPreviewLoading}
      title={`${FOCUS_COCKPIT.BACK_TO_PREVIEW_LINE_1} ${FOCUS_COCKPIT.BACK_TO_PREVIEW_LINE_2}`}
    >
      <span>{FOCUS_COCKPIT.BACK_TO_PREVIEW_LINE_1}</span>
      <span>{FOCUS_COCKPIT.BACK_TO_PREVIEW_LINE_2}</span>
    </PrimaryCta>
  ) : (
    <PrimaryCta
      compact
      accent="focus"
      icon={ctaExporting ? Loader : Download}
      iconClassName={ctaExporting ? 'animate-spin' : ''}
      onClick={onGenerate}
      disabled={ctaDisabled}
      title={`${FOCUS_COCKPIT.GENERATE_LINE_1} ${FOCUS_COCKPIT.GENERATE_LINE_2}`}
    >
      <span>{FOCUS_COCKPIT.GENERATE_LINE_1}</span>
      <span>{FOCUS_COCKPIT.GENERATE_LINE_2}</span>
    </PrimaryCta>
  );

  return (
    <div
      data-testid="cockpit-actions"
      className="relative z-50 flex w-[72px] flex-none flex-col items-center justify-between border-l border-gray-700 bg-[#0f172a] px-1 py-1.5"
    >
      <div className="flex flex-col items-center gap-1.5">
        <RailButton
          testId="cockpit-clips-btn"
          icon={Film}
          label={FOCUS_COCKPIT.CLIPS}
          onClick={onOpenClips}
          active={activeSheet === 'clips'}
        />
        <RailButton
          testId="cockpit-setup-btn"
          icon={Sliders}
          label={FOCUS_COCKPIT.SETUP}
          onClick={onOpenSetup}
          active={activeSheet === 'setup'}
        />
        <RailButton
          testId="cockpit-undo-btn"
          icon={Undo2}
          label={FOCUS_COCKPIT.UNDO}
          onClick={onUndo}
          disabled={!canUndo}
        />
        <RailButton
          testId="cockpit-preview-btn"
          icon={Eye}
          label={FOCUS_COCKPIT.PREVIEW}
          onClick={onTogglePreview}
          active={previewing}
        />
      </div>

      <div className="flex flex-col items-center gap-1">
        {estimatedCredits != null && !ctaExporting && (
          <span data-testid="cockpit-credit-estimate" className="text-[10px] text-gray-400">
            {`~${estimatedCredits} cr`}
          </span>
        )}
        {cta}
      </div>
    </div>
  );
}

import { useState } from 'react';
import { X } from 'lucide-react';
import { useGuidanceSettings, useSettingsStore } from '../../stores/settingsStore';
import { FRAMING_GUIDE } from './catalog';

/**
 * T12790: the guide sentence for full-bleed editors (the landscape cockpit, Focus
 * fullscreen) where the floating coach card would cover the stage. Same resolved
 * guide as everywhere else, drawn as a slim strip the screen positions itself:
 * no shade, no Got it, and pointer-events pass through to the video except the
 * Turn off guidance button. The pulse on the named control still comes from the
 * screen's GuideScope.
 */
export default function CompactGuide({ guide, testId = 'compact-guide', className = '' }) {
  const { coachEnabled } = useGuidanceSettings();
  const setCoachEnabled = useSettingsStore(s => s.setCoachEnabled);
  const [closeError, setCloseError] = useState('');
  if (!guide || !coachEnabled) return null;
  const handleClose = async (e) => {
    e.stopPropagation();
    setCloseError('');
    try { await setCoachEnabled(false); }
    catch { setCloseError('Could not save guidance. Try again.'); }
  };
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={testId}
      data-guide-id={guide.id}
      data-tone={guide.tone}
      className={`pointer-events-none flex items-start gap-2 rounded-xl border border-white/20 border-l-2 border-l-violet-400/80 bg-gray-900/90 py-1.5 pl-3 pr-1 text-white shadow-[0_6px_20px_rgb(0_0_0_/35%)] backdrop-blur ${className}`}
    >
      {guide.step != null && (
        <span className="mt-1 shrink-0 rounded-full bg-amber-400/20 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
          {FRAMING_GUIDE.STEP_LABEL(guide.step, 5)}
        </span>
      )}
      <div className="min-w-0 flex-1 py-1">
        <p data-testid={`${testId}-text`} className="text-sm font-semibold leading-snug">{guide.message.title}</p>
        {closeError && <p role="alert" className="mt-1 text-xs text-red-300">{closeError}</p>}
      </div>
      <button
        type="button"
        aria-label="Turn off guidance"
        title="Turn off guidance"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={handleClose}
        className="pointer-events-auto -my-1.5 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white/60 hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

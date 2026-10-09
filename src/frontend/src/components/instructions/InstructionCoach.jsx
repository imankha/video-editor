import { forwardRef, useState } from 'react';
import { X } from 'lucide-react';
import { useGuidanceSettings, useSettingsStore } from '../../stores/settingsStore';

/** Shared contextual instruction surface. Workflow state stays with each screen. */
export const InstructionCoach = forwardRef(function InstructionCoach({
  children,
  className = '',
  tone = 'coach',
  phase,
  placement = 'top',
  ...props
}, targetRef) {
  const { coachEnabled } = useGuidanceSettings();
  const setCoachEnabled = useSettingsStore(s => s.setCoachEnabled);
  const [closeError, setCloseError] = useState('');
  if (!coachEnabled) return null;
  // T12290: a failed save reverts the store, so the coach would silently reappear; say so (same copy as GuidanceToggle).
  const handleClose = async (e) => {
    e.stopPropagation();
    setCloseError('');
    try { await setCoachEnabled(false); }
    catch { setCloseError('Could not save guidance. Try again.'); }
  };
  return (
    <div
      ref={targetRef}
      role="status"
      aria-live="polite"
      data-testid="instruction-coach"
      data-phase={phase}
      data-placement={placement}
      data-tone={tone}
      className={`relative rounded-xl border border-white/20 border-l-2 border-l-violet-400/80 bg-gray-900/95 px-4 py-3 pr-11 text-white shadow-[0_10px_30px_rgb(0_0_0_/28%)] backdrop-blur ${tone === 'strong' || tone === 'error' ? 'ring-1 ring-violet-300/50' : ''} ${className}`}
      {...props}
    >
      <button type="button" aria-label="Turn off guidance" title="Turn off guidance"
        className="pointer-events-auto absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md text-white/60 transition-colors hover:bg-white/10 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={handleClose}>
        <X size={16} aria-hidden="true" />
      </button>
      {children}
      {closeError && <p role="alert" className="mt-2 text-xs text-red-300">{closeError}</p>}
    </div>
  );
});

export default InstructionCoach;

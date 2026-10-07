import { forwardRef } from 'react';
import { useGuidanceSettings } from '../../stores/settingsStore';

/** Shared contextual instruction surface. Workflow state stays with each screen. */
export const InstructionCoach = forwardRef(function InstructionCoach({
  children,
  className = '',
  tone = 'coach',
  phase,
  placement = 'top',
  targetRect,
  ...props
}, targetRef) {
  const { coachEnabled = true, setCoachEnabled } = useGuidanceSettings();

  const guidanceToggle = (
    <button
      type="button"
      data-testid="guidance-toggle"
      aria-label={`Helpful instructions ${coachEnabled ? 'on' : 'off'}. Click to turn ${coachEnabled ? 'off' : 'on'}.`}
      aria-pressed={coachEnabled}
      onClick={() => setCoachEnabled?.(!coachEnabled)}
      className="fixed bottom-4 right-4 z-[120] rounded-full border border-white/20 bg-gray-900/95 px-3 py-1.5 text-xs font-semibold text-gray-200 shadow-lg backdrop-blur hover:bg-gray-800"
    >
      Guidance {coachEnabled ? 'On' : 'Off'}
    </button>
  );

  if (!coachEnabled) return guidanceToggle;
  const style = targetRect ? {
    position: 'fixed',
    left: `${Math.max(12, targetRect.left)}px`,
    top: `${Math.max(12, placement === 'bottom' ? targetRect.bottom + 12 : targetRect.top - 12)}px`,
  } : undefined;
  return (
    <div
      ref={targetRef}
      role="status"
      aria-live="polite"
      data-testid="instruction-coach"
      data-phase={phase}
      data-placement={placement}
      data-tone={tone}
      className={`rounded-xl border border-white/20 border-l-2 border-l-violet-400/80 bg-gray-900/95 px-4 py-3 text-white shadow-[0_10px_30px_rgb(0_0_0_/28%)] backdrop-blur ${tone === 'strong' ? 'ring-1 ring-violet-300/50' : ''} ${className}`}
      style={style}
      {...props}
    >
      {children}
      {guidanceToggle}
    </div>
  );
});

export default InstructionCoach;

import { createContext, useContext, useMemo } from 'react';
import { useGuidanceSettings } from '../../stores/settingsStore';
import { GUIDE_PULSE_CLASS } from './guideTargets';

// Outside any scope nothing pulses (a screen that forgets its scope fails visibly, never pulses wrongly).
const NONE = new Set();
const GuidePulseContext = createContext(NONE);

/**
 * T12730: THE Guidance on/off gate for pulsing. A screen wraps its tree in
 * `<GuideScope guides={[guide]}>`; the active targets are the `pulse` values of those guides
 * (Overlay passes both of its channels). Innermost scope wins, so a modal never inherits the
 * screen's pulses. Pure render output: nothing is stored or persisted.
 */
export function GuideScope({ guides, children }) {
  const { coachEnabled } = useGuidanceSettings();
  const key = coachEnabled ? guides.map((g) => g?.pulse ?? '').join('|') : '';
  const active = useMemo(() => new Set(key.split('|').filter(Boolean)), [key]);
  return <GuidePulseContext.Provider value={active}>{children}</GuidePulseContext.Provider>;
}

/**
 * The only code that knows the pulse class. Returns the class when `target` (or any of an array
 * of targets) is active in the nearest scope and the control is not `suppress`ed (busy, disabled,
 * dragging, fullscreen...); '' otherwise.
 */
export function useGuidePulse(target, { suppress = false } = {}) {
  const active = useContext(GuidePulseContext);
  const targets = Array.isArray(target) ? target : [target];
  return !suppress && targets.some((t) => active.has(t)) ? GUIDE_PULSE_CLASS : '';
}

import { createContext } from 'react';
import { create } from 'zustand';

/**
 * T12580: which guide rules the user has dismissed with "Got it". View state only:
 * memory, never persisted (no request, no storage); it dies with the tab. Keyed by
 * rule id, so a rule shades once and the next rule opens Focused again.
 */
export const useGuideFocusStore = create((set) => ({
  acked: {},
  acknowledge: (id) => set((s) => (s.acked[id] ? s : { acked: { ...s.acked, [id]: true } })),
  resetAcks: () => set({ acked: {} }),
}));

/** Provided by FloatingCoach while a step is Focused; InstructionCoach renders "Got it" from it. */
export const GuideFocusContext = createContext(null);

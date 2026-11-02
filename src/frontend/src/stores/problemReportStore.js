import { create } from 'zustand';

/**
 * T14370: lets code outside ReportProblemButton open the Report a problem form
 * (a "play not saved" toast action). `openRequest` is a counter, not a flag:
 * every requestOpen() is a distinct gesture, so a second request after the
 * user closed the form opens it again. Memory-only view state.
 */
export const useProblemReportStore = create((set) => ({
  openRequest: 0,
  requestOpen: () => set((s) => ({ openRequest: s.openRequest + 1 })),
}));

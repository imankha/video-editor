/**
 * T8280: single named constant shared by the export credit-estimate note
 * (ExportButtonView) and the container that surfaces sourceFps
 * (ExportButtonContainer) -- must match the backend mirror,
 * app/highlight_transform.py's HIGH_FPS_THRESHOLD.
 *
 * 31 strictly excludes 29.97 (the fleet majority) while catching genuine
 * high-fps sources (50/60fps). Design doc docs/plans/tasks/T8280-design.md Q3.
 */
export const HIGH_FPS_THRESHOLD = 31;

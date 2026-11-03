// Admin dashboard rule: every non-count number renders with exactly 2 decimals.
export const fmt2 = (v) => Number(v).toFixed(2);
export const fmtPct = (v) => `${fmt2(v)}%`;

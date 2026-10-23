// Mirror of storage_credits.py (T13310): 1 credit per GB per 30 days, GB rounded up,
// minimum 1. Decoupled from the credit-pack ladder; the preview, the modal and the backend
// charge must always agree (parity fixtures: src/backend/tests/test_t13310_storage_per_gb.py).
export const STORAGE_DURATION_DAYS = 30;
const BYTES_PER_GB = 1024 ** 3;
const AUTO_EXPORT_SURCHARGE = 1;

const gbRoundedUp = (fileSizeBytes) => Math.ceil(fileSizeBytes / BYTES_PER_GB);

export function calculateStorageCost(fileSizeBytes, days = STORAGE_DURATION_DAYS) {
  return Math.max(1, Math.ceil((gbRoundedUp(fileSizeBytes) * days) / 30));
}

export function calculateUploadCost(fileSizeBytes, days = STORAGE_DURATION_DAYS) {
  return calculateStorageCost(fileSizeBytes, days) + AUTO_EXPORT_SURCHARGE;
}

export function calculateExtensionCost(fileSizeBytes, days) {
  return calculateStorageCost(fileSizeBytes, days);
}

/** Largest day count one credit buys (at least 1). */
export function daysPerCredit(fileSizeBytes) {
  const gb = gbRoundedUp(fileSizeBytes);
  if (gb <= 0) return STORAGE_DURATION_DAYS;
  return Math.max(1, Math.floor(STORAGE_DURATION_DAYS / gb));
}

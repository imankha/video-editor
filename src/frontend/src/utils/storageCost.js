const R2_RATE_PER_GB_MONTH = 0.015;
const CREDIT_VALUE = 0.072;
const MARGIN = 0.10;
const STORAGE_DURATION_DAYS = 30;

export function calculateUploadCost(fileSizeBytes, days = STORAGE_DURATION_DAYS) {
  const sizeGb = fileSizeBytes / (1024 ** 3);
  return Math.max(1, Math.ceil(
    sizeGb * R2_RATE_PER_GB_MONTH * (days / 30) * (1 + MARGIN) / CREDIT_VALUE
  ));
}

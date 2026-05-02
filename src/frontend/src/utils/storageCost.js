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

export function calculateExtensionCost(fileSizeBytes, days) {
  return calculateUploadCost(fileSizeBytes, days);
}

export function daysPerCredit(fileSizeBytes) {
  const sizeGb = fileSizeBytes / (1024 ** 3);
  if (sizeGb <= 0) return STORAGE_DURATION_DAYS;
  return Math.max(1, Math.floor(
    STORAGE_DURATION_DAYS * CREDIT_VALUE / (sizeGb * R2_RATE_PER_GB_MONTH * (1 + MARGIN))
  ));
}

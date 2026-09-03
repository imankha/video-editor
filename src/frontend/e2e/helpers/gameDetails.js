import { expect } from '@playwright/test';

/**
 * T8500: the Add Game modal is video-first - opponent/date/type/format live
 * inside a collapsed <details> disclosure ("Game details (optional...)").
 * Any spec that types metadata must open it first. Sets .open directly
 * (idempotent) instead of clicking the summary so a repeated call can never
 * toggle the disclosure closed again.
 */
export async function openGameDetailsDisclosure(page) {
  const details = page.getByTestId('game-details-disclosure');
  await expect(details).toBeAttached({ timeout: 10000 });
  await details.evaluate((el) => { el.open = true; });
}

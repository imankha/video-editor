import { expect } from '@playwright/test';

/**
 * T8500: the Add Game modal was video-first - opponent/date/type/format used
 * to live inside a collapsed <details> disclosure ("Game details (optional...)").
 * T8955 removed that disclosure entirely (Game Type joined Opponent/Date as an
 * always-visible field) - this helper is now a no-op guard kept so the ~14
 * existing specs calling it don't all need editing; a future disclosure-free
 * layout finds nothing to open and returns immediately. Sets .open directly
 * (idempotent) instead of clicking the summary so a repeated call can never
 * toggle the disclosure closed again, for as long as any layout still has one.
 */
export async function openGameDetailsDisclosure(page) {
  const details = page.getByTestId('game-details-disclosure');
  if ((await details.count()) === 0) return;
  await expect(details).toBeAttached({ timeout: 10000 });
  await details.evaluate((el) => { el.open = true; });
}

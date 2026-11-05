// T15150 live drive: two game uploads from two tabs of one session finish together.
// Run against the running dev stack (real R2):
//   cd src/frontend && E2E_BASE_URL=http://localhost:5173 \
//     T15150_VIDEO_A=<path> T15150_VIDEO_B=<path> \
//     npx playwright test e2e/T15150-two-finish.livedrive.spec.js --project=chromium --reporter=line
// Prints per-tab request timings for prepare-upload, finalize-upload and activate; read
// [WRITE_LOCK_WAIT] and [REQ_TIMING] from the backend log for the server side.
import { test, expect } from '@playwright/test';
import { loginAsRealUser } from './helpers/realAuth';

const EMAIL = process.env.T15150_EMAIL || 'imankh+devfixture@gmail.com';
const PROFILE = process.env.T15150_PROFILE || '9fa7378c';
const VIDEO_A = process.env.T15150_VIDEO_A;
const VIDEO_B = process.env.T15150_VIDEO_B;
const WATCHED = ['/api/games/prepare-upload', '/api/games/finalize-upload', '/activate'];

function watch(page, tag, timings) {
  page.on('request', (req) => {
    const url = req.url();
    const key = WATCHED.find((w) => url.includes(w));
    if (key) timings.push({ tag, key, url: url.replace(/^.*\/api/, '/api'), start: Date.now() });
  });
  page.on('response', (res) => {
    const url = res.url();
    const key = WATCHED.find((w) => url.includes(w));
    if (!key) return;
    const row = [...timings].reverse().find((t) => t.tag === tag && t.key === key && t.end === undefined);
    if (row) {
      row.end = Date.now();
      row.status = res.status();
    }
  });
}

async function startUpload(page, file) {
  await page.goto('/home');
  await page.getByRole('button', { name: 'Upload game' }).first().click();
  await page.getByTestId('footage-file-input').setInputFiles(file);
  const submit = page.locator('form').getByRole('button', { name: 'Upload game' });
  await expect(submit).toBeEnabled();
  return submit;
}

test('two finishes at once', async ({ context, page }) => {
  test.setTimeout(300000);
  expect(VIDEO_A && VIDEO_B, 'set T15150_VIDEO_A and T15150_VIDEO_B').toBeTruthy();
  await loginAsRealUser(context, EMAIL, PROFILE);
  const pageB = await context.newPage();
  const timings = [];
  watch(page, 'A', timings);
  watch(pageB, 'B', timings);

  const [submitA, submitB] = await Promise.all([startUpload(page, VIDEO_A), startUpload(pageB, VIDEO_B)]);
  const activatedA = page.waitForResponse((r) => r.url().includes('/activate'), { timeout: 240000 });
  const activatedB = pageB.waitForResponse((r) => r.url().includes('/activate'), { timeout: 240000 });
  const t0 = Date.now();
  await Promise.all([submitA.click(), submitB.click()]);
  const [resA, resB] = await Promise.all([activatedA, activatedB]);

  const rows = timings
    .filter((t) => t.end !== undefined)
    .map((t) => `${t.tag} ${t.key.padEnd(27)} status=${t.status} start=+${((t.start - t0) / 1000).toFixed(2)}s dur=${((t.end - t.start) / 1000).toFixed(2)}s`);
  console.log('[T15150] client timings\n' + rows.join('\n'));
  expect(resA.status(), await resA.text()).toBe(200);
  expect(resB.status(), await resB.text()).toBe(200);
});

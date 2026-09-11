/**
 * T8824 QA (a) — the epic's headline scenario, end to end against a REAL backend
 * and REAL R2: a main camera + a genuinely overlapping second camera go through
 * the real "Upload game" upload path and come out the other side as an ANGLE, not a
 * discarded/blind chain.
 *
 * Before T8824 this was unreachable (docs/plans/tasks/T8824-design.md §1.3.1):
 * intake's wholesale-discard rule (EPIC decision 1) threw the timestamps away on
 * any chain overlap, so a real overlapping upload never produced `recorded_at`
 * and Annotate never saw an angle. This spec proves the whole pipeline now
 * agrees: picker lanes -> persisted `recorded_at`/`offset_seconds` -> Annotate's
 * angle strip, using the SAME `assignLanes` on both ends (invariant P, §2.1).
 *
 * Fixtures: two REAL, valid ffmpeg MP4s with an explicit mvhd creation_time
 * (T8820's recipe) — `main.mp4` (640x480, 30s) and `sideline.mp4` (320x240, 6s)
 * whose recorded span sits wholly inside main's (different camera family AND
 * containment -> auto-angle, no question asked). `sideline.mp4`'s real filename
 * threads through as the angle's display name (T8892).
 *
 * Uses REAL-ACCOUNT auth (dev-login), not the empty test-login bypass: a fresh
 * `POST /api/games/{id}/activate` for a synthetic test-login identity 500s in
 * this environment (`game_storage_refs`/`user_actions` foreign keys expect a
 * real Postgres `users` row — a pre-existing gap unrelated to T8824, out of
 * scope here; no other games e2e spec has exercised test-login through a real
 * submit, which is why this was undiscovered). The created game is deleted in
 * `afterEach` so this run leaves no residue on the shared dev account.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8824-angle-upload.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loginAsRealUser } from './helpers/realAuth.js';
import { assertNoHorizontalOverflow, saveEvidence } from './helpers/qa.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';

const MAIN_AT = '2026-09-05T18:00:00';
const SIDELINE_AT = '2026-09-05T18:00:10'; // 10s into main's 30s span

let mainPath;
let sidelinePath;
let createdGameId = null;

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 't8824-angle-'));
  const gen = (name, color, size, dur, at) => {
    const out = path.join(dir, name);
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=${size}:d=${dur}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-metadata', `creation_time=${at}`, out,
    ], { stdio: 'ignore' });
    return out;
  };
  mainPath = gen('main.mp4', 'blue', '640x480', 30, MAIN_AT);
  sidelinePath = gen('sideline.mp4', 'red', '320x240', 6, SIDELINE_AT);
});

test.describe('T8824 — real overlapping upload becomes a real angle', () => {
  test.afterEach(async ({ page }) => {
    if (!createdGameId) return;
    await page.request.delete(`/api/games/${createdGameId}`).catch(() => {});
    createdGameId = null;
  });

  test('picker shows 2 lanes; the real upload persists recorded_at + overlapping offsets; Annotate shows the angle', async ({ context, page }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);

    await page.goto('/home/games', { waitUntil: 'domcontentloaded' });
    const addCta = page.getByRole('button', { name: /^Add Game$/ }).first();
    await addCta.waitFor({ state: 'visible', timeout: 30000 });
    await addCta.click();
    await expect(page.getByRole('heading', { name: 'Upload game' })).toBeVisible();

    // Feed BOTH real files through the real intake probe.
    await page.setInputFiles('[data-testid="footage-file-input"]', [mainPath, sidelinePath]);
    await expect(page.getByTestId('footage-list')).toBeVisible({ timeout: 30000 });

    // AC: picker shows 2 lanes -- lane 0 = main only, angle section = sideline.
    await expect(page.getByTestId('footage-row')).toHaveCount(1);
    await expect(page.getByTestId('footage-angle-section')).toBeVisible();
    const angleRows = page.getByTestId('footage-angle-row');
    await expect(angleRows).toHaveCount(1);
    await expect(angleRows.first()).toContainText('sideline.mp4');
    await expect(page.getByTestId('footage-trust-line')).toContainText('1 angle filmed at the same time');
    await saveEvidence(page, 't8824-picker-2-lanes');

    // No horizontal overflow while the angle section is showing (360/390/428px).
    for (const width of [360, 390, 428]) {
      await page.setViewportSize({ width, height: 780 });
      await page.waitForTimeout(200);
      await assertNoHorizontalOverflow(page);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Submit the REAL upload (real R2, real backend) and capture the created game id.
    const submit = page.getByRole('button', { name: /^Add Game$/ }).last();
    const [createRes] = await Promise.all([
      page.waitForResponse(
        (res) => /\/api\/games$/.test(res.url()) && res.request().method() === 'POST',
        { timeout: 60000 },
      ),
      submit.click(),
    ]);
    const created = await createRes.json();
    const gameId = created.game_id;
    expect(gameId).toBeTruthy();
    createdGameId = gameId; // afterEach cleans this up regardless of outcome below

    // Wait for the second video's real attach (T8700's append path) to land.
    await page.waitForResponse(
      (res) => new RegExp(`/api/games/${gameId}/videos$`).test(res.url()) && res.request().method() === 'POST' && res.ok(),
      { timeout: 60000 },
    );

    // AC: GET /api/games/{id} has non-null recorded_at on BOTH + overlapping offsets.
    const gameRes = await page.request.get(`/api/games/${gameId}`);
    expect(gameRes.ok()).toBe(true);
    const gameJson = await gameRes.json();
    const videos = gameJson.videos.sort((a, b) => a.sequence - b.sequence);
    expect(videos).toHaveLength(2);
    for (const v of videos) {
      expect(v.recorded_at, `video ${v.sequence} recorded_at`).not.toBeNull();
      expect(v.offset_seconds, `video ${v.sequence} offset_seconds`).not.toBeNull();
    }
    const [main, sideline] = videos;
    // Genuine overlap on the real-time axis: sideline starts after main and ends
    // before it (containment), never a coincidental prefix-sum concatenation.
    expect(sideline.offset_seconds).toBeGreaterThan(main.offset_seconds);
    expect(sideline.offset_seconds + sideline.duration).toBeLessThanOrEqual(main.offset_seconds + main.duration + 1);
    expect(sideline.original_filename).toBe('sideline.mp4');

    // AC: Annotate shows the angle, named from the real filename (T8892), not a hash.
    await page.goto('/');
    await page.evaluate((id) => sessionStorage.setItem('pendingGameId', String(id)), gameId);
    await page.goto('/annotate', { waitUntil: 'domcontentloaded' });
    const bar = page.getByTestId(`angle-bar-${sideline.sequence}`);
    await expect(bar).toBeVisible({ timeout: 30000 });
    await expect(bar).toHaveAttribute('title', 'sideline');
    await saveEvidence(page, 't8824-annotate-angle');
  });
});

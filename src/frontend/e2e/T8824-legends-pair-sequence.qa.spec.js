/**
 * T8824 QA (b) — the Legends/Trace export pair: two REAL, valid ffmpeg MP4s
 * named like one-recording halves ("1st-half.mp4" / "2nd-half.mp4"), stamped
 * with OVERLAPPING creation_time (export-time artifacts, exactly like the real
 * fixture EPIC.md's evidence table was built on) and named in REVERSE of their
 * embedded-time order, so a name-blind chain check would get the order wrong.
 *
 * Proves the disambiguation rule resolves this to an ARTIFACT (A1, decisive
 * half-word naming), not an angle: the picker shows ONE lane, ordered by name,
 * and — critically — the real upload sends NO recorded_at for either video, so
 * the backend places them by prefix-sum (games.py compute_video_offsets), the
 * exact behaviour the epic's original fixture needed and T8872 protected.
 *
 * Uses REAL-ACCOUNT auth (dev-login), not the empty test-login bypass — see
 * T8824-angle-upload.qa.spec.js's docstring for why (a pre-existing, unrelated
 * Postgres FK gap 500s `activate_game` for a synthetic test-login identity).
 * The created game is deleted in `afterEach`.
 *
 * Run: bash scripts/dev-verify.sh e2e/T8824-legends-pair-sequence.qa.spec.js
 */
import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loginAsRealUser } from './helpers/realAuth.js';
import { saveEvidence } from './helpers/qa.js';

const REAL_EMAIL = process.env.E2E_REAL_EMAIL || 'imankh@gmail.com';
const PROFILE_ID = process.env.E2E_PROFILE_ID || '9fa7378c';

// Reversed vs. embedded time AND genuinely overlapping: 2nd-half is stamped
// EARLIER than 1st-half, and 1st-half's start sits inside 2nd-half's span, so
// only the half-word naming (not the clock) can put them in the right order.
const SEGMENTS = [
  { name: '2nd-half.mp4', at: '2026-09-05T10:00:00', dur: 12 }, // 10:00:00 - 10:00:12
  { name: '1st-half.mp4', at: '2026-09-05T10:00:05', dur: 12 }, // 10:00:05 - 10:00:17, overlaps by 7s
];

let fixturePaths;
let createdGameId = null;

test.beforeAll(() => {
  const dir = mkdtempSync(path.join(tmpdir(), 't8824-legends-'));
  fixturePaths = SEGMENTS.map((seg) => {
    const out = path.join(dir, seg.name);
    execFileSync('ffmpeg', [
      '-y', '-f', 'lavfi', '-i', `color=c=green:s=320x240:d=${seg.dur}`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      '-metadata', `creation_time=${seg.at}`, out,
    ], { stdio: 'ignore' });
    return out;
  });
});

test.describe('T8824 — Legends-shaped overlap is an artifact, not an angle', () => {
  test.afterEach(async ({ page }) => {
    if (!createdGameId) return;
    await page.request.delete(`/api/games/${createdGameId}`).catch(() => {});
    createdGameId = null;
  });

  test('picker shows 1 lane, name order; the real upload sends null recorded_at, prefix-sum offsets', async ({ context, page }) => {
    test.setTimeout(180_000);
    await loginAsRealUser(context, REAL_EMAIL, PROFILE_ID);

    await page.goto('/home/games', { waitUntil: 'domcontentloaded' });
    const addCta = page.getByRole('button', { name: /^Add Game$/ }).first();
    await addCta.waitFor({ state: 'visible', timeout: 30000 });
    await addCta.click();
    await expect(page.getByText('Add New Game')).toBeVisible();

    await page.setInputFiles('[data-testid="footage-file-input"]', fixturePaths);
    await expect(page.getByTestId('footage-list')).toBeVisible({ timeout: 30000 });

    // AC: 1 lane, ordered by name (1st-half first despite being embedded-time later),
    // no angle section, the new artifact-naming trust line + its override link.
    await expect(page.getByTestId('footage-row')).toHaveCount(2);
    await expect(page.getByTestId('footage-angle-section')).toHaveCount(0);
    const rows = page.getByTestId('footage-row');
    await expect(rows.nth(0)).toContainText('1st-half.mp4');
    await expect(rows.nth(1)).toContainText('2nd-half.mp4');
    await expect(page.getByTestId('footage-trust-line')).toHaveText(
      'These look like two parts of one recording - put in order by their names',
    );
    await expect(page.getByTestId('footage-override-link')).toHaveText(
      'Were they filmed at the same time? Show them as angles',
    );
    await saveEvidence(page, 't8824-legends-picker');

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

    await page.waitForResponse(
      (res) => new RegExp(`/api/games/${gameId}/videos$`).test(res.url()) && res.request().method() === 'POST' && res.ok(),
      { timeout: 60000 },
    );

    // AC: recorded_at null on BOTH (T8872's invariant, now driven by placement);
    // prefix-sum offsets by payload order (1st-half sent first -> offset 0).
    const gameRes = await page.request.get(`/api/games/${gameId}`);
    expect(gameRes.ok()).toBe(true);
    const gameJson = await gameRes.json();
    const videos = gameJson.videos.sort((a, b) => a.sequence - b.sequence);
    expect(videos).toHaveLength(2);
    for (const v of videos) {
      expect(v.recorded_at, `video ${v.sequence} recorded_at`).toBeNull();
    }
    expect(videos[0].offset_seconds).toBe(0);
    expect(videos[0].original_filename).toBe('1st-half.mp4');
    expect(videos[1].offset_seconds).toBeCloseTo(videos[0].duration, 1);
    expect(videos[1].original_filename).toBe('2nd-half.mp4');
  });
});

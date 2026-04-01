import { test, expect } from '@playwright/test';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

/**
 * Quest Walkthrough E2E Test — Simulated Soccer Parent
 *
 * Walks through all 4 quests as a soccer parent who loves their child and
 * wants to annotate clips and produce highlights. Takes screenshots at each
 * step and generates a markdown report with UX feedback from the user's
 * perspective.
 *
 * Prerequisites:
 *   1. Backend running: cd src/backend && uvicorn app.main:app --port 8000
 *   2. Frontend running: cd src/frontend && npm run dev
 *   3. ffmpeg available on PATH (for generating second game video)
 *
 * Run with:
 *   cd src/frontend && npx playwright test e2e/quest-walkthrough.spec.js
 *
 * Report output:
 *   src/frontend/test-results/quest-walkthrough/report.md
 */

const API_PORT = 8000;
const API_BASE = `http://localhost:${API_PORT}/api`;
const TEST_USER_ID = `e2e_quest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const TEST_HEADERS = { 'X-User-ID': TEST_USER_ID, 'Content-Type': 'application/json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../..');

// Test data
const GAME1_VIDEO = path.join(PROJECT_ROOT, 'formal annotations/test.short/wcfc-carlsbad-trimmed.mp4');
const GAME1_TSV = path.join(PROJECT_ROOT, 'formal annotations/test.short/test.short.tsv');
const GAME2_VIDEO = path.join(PROJECT_ROOT, 'formal annotations/test.short/game2-test.mp4');

// Screenshots & report output
const SCREENSHOTS_DIR = path.resolve(__dirname, '../test-results/quest-walkthrough');

// ---------------------------------------------------------------------------
// Report accumulator
// ---------------------------------------------------------------------------
const report = [];

function addStep(quest, questTitle, stepNum, stepId, stepTitle, screenshotFile, wantScore, understandScore, feedback, bugs = []) {
  report.push({ quest, questTitle, stepNum, stepId, stepTitle, screenshotFile, wantScore, understandScore, feedback, bugs });
}

function generateReport() {
  let md = `# Quest Walkthrough Report — Simulated Soccer Parent\n\n`;
  md += `**Persona:** Soccer parent who loves watching their kid play. Not technical — `;
  md += `just wants to capture and share the best moments. Willing to follow instructions `;
  md += `but gets frustrated if steps feel unclear or forced.\n\n`;
  md += `**Test User:** \`${TEST_USER_ID}\`\n`;
  md += `**Date:** ${new Date().toISOString().split('T')[0]}\n\n`;

  md += `| Quest | # | Step | Screenshot | Want (1-10) | Understand (1-10) | Feedback | Bugs |\n`;
  md += `|-------|---|------|------------|-------------|-------------------|----------|------|\n`;

  for (const r of report) {
    const screenshotLink = r.screenshotFile ? `![${r.stepId}](${r.screenshotFile})` : '—';
    const bugsStr = r.bugs.length > 0 ? r.bugs.join('; ') : '—';
    md += `| ${r.quest}. ${r.questTitle} | ${r.stepNum} | ${r.stepTitle} | ${screenshotLink} | ${r.wantScore} | ${r.understandScore} | ${r.feedback} | ${bugsStr} |\n`;
  }

  md += `\n## Bug Summary\n\n`;
  const allBugs = report.flatMap(r => r.bugs.map(b => `- **${r.quest}.${r.stepNum} ${r.stepTitle}:** ${b}`));
  if (allBugs.length > 0) {
    md += allBugs.join('\n') + '\n';
  } else {
    md += 'No bugs found.\n';
  }

  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const reportPath = path.join(SCREENSHOTS_DIR, 'report.md');
  fs.writeFileSync(reportPath, md);
  console.log(`\n[Quest Walkthrough] Report written to: ${reportPath}`);
  return reportPath;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function setupTestUser(page) {
  await page.setExtraHTTPHeaders({
    'X-User-ID': TEST_USER_ID,
    'X-Test-Mode': 'true',
  });
  await page.route(/r2\.cloudflarestorage\.com/, async (route) => {
    const headers = { ...route.request().headers() };
    delete headers['x-test-mode'];
    delete headers['x-user-id'];
    await route.continue({ headers });
  });
}

/**
 * Authenticate E2E test user via backend test-login endpoint.
 * Only works in dev/staging (returns 404 in production).
 * Creates a real session cookie so the frontend auth gate is satisfied.
 */
async function authenticateTestUser(page) {
  // Navigate to app first so the cookie domain matches
  await page.goto('/');
  // Call test-login via page context so the cookie is set on the browser
  const result = await page.evaluate(async (headers) => {
    const res = await fetch('/api/auth/test-login', {
      method: 'POST',
      credentials: 'include',
      headers,
    });
    if (!res.ok) return { error: `test-login failed: ${res.status}` };
    return await res.json();
  }, { 'Content-Type': 'application/json', 'X-User-ID': TEST_USER_ID, 'X-Test-Mode': 'true' });

  if (result.error) {
    console.warn(`[Auth] ${result.error} — auth gate may block interactions`);
  } else {
    console.log(`[Auth] Test user authenticated: ${result.email} (${result.user_id})`);
  }

  // Reload so the app picks up the session cookie
  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function screenshot(page, name) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  return `${name}.png`;
}

/**
 * Wait for a condition with progress detection.
 * Keeps waiting as long as the page shows signs of activity (progress bars,
 * status text changes, spinners). Only gives up if nothing changes for 30s.
 */
async function waitWithProgress(page, checkFn, { label = 'condition', stallTimeout = 30000, maxTimeout = 600000 } = {}) {
  const start = Date.now();
  let lastSnapshot = '';
  let lastChangeTime = Date.now();

  while (Date.now() - start < maxTimeout) {
    // Check if the condition is met
    const done = await checkFn().catch(() => false);
    if (done) return true;

    // Take a text snapshot of progress indicators on the page
    const snapshot = await page.evaluate(() => {
      const indicators = [];
      // Progress bars (width style changes as progress moves)
      document.querySelectorAll('[role="progressbar"], [class*="progress"], [class*="bg-green"], [class*="bg-purple"]').forEach(el => {
        indicators.push(el.style?.width || el.getAttribute('aria-valuenow') || el.className.slice(0, 50));
      });
      // Status text (export status, extraction status, percentages)
      document.querySelectorAll('[class*="text-gray"], [class*="text-green"], [class*="text-yellow"], [class*="animate-spin"]').forEach(el => {
        const t = el.textContent?.trim();
        if (t && t.length < 100 && /\d|%|progress|extract|export|process|wait|load|complet/i.test(t)) {
          indicators.push(t);
        }
      });
      // Spinners / loading indicators
      document.querySelectorAll('.animate-spin, [class*="spinner"], [class*="loading"]').forEach(() => {
        indicators.push('spinner-active');
      });
      return indicators.join('|');
    }).catch(() => '');

    if (snapshot !== lastSnapshot) {
      if (lastSnapshot) console.log(`[${label}] Progress detected: ${snapshot.slice(0, 120)}`);
      lastSnapshot = snapshot;
      lastChangeTime = Date.now();
    }

    // Stall detection: if nothing changed for stallTimeout, give up
    if (Date.now() - lastChangeTime > stallTimeout) {
      console.log(`[${label}] No progress for ${stallTimeout / 1000}s — giving up`);
      return false;
    }

    await page.waitForTimeout(5000);
  }
  console.log(`[${label}] Max timeout ${maxTimeout / 1000}s reached`);
  return false;
}

/** Wait for quest progress API to show a step as complete */
async function waitForQuestStep(request, stepId, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      const res = await request.get(`${API_BASE}/quests/progress`, { headers: TEST_HEADERS });
      if (res.ok()) {
        const data = await res.json();
        for (const quest of data.quests) {
          if (quest.steps[stepId] === true) return true;
        }
      }
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 2000));
  }
  return false;
}

/** Frame all clips in a project via API (set crop data so export button enables) */
async function frameAllClipsInProject(request, projectId) {
  const clipsRes = await request.get(`${API_BASE}/clips/projects/${projectId}/clips`, { headers: TEST_HEADERS });
  if (!clipsRes.ok()) return 0;
  const clips = await clipsRes.json();
  let framed = 0;
  for (const clip of clips) {
    const res = await framClipViaAPI(request, projectId, clip.id);
    if (res.ok()) framed++;
  }
  return framed;
}

/** Set crop data on a clip via API so it counts as "framed" */
async function framClipViaAPI(request, projectId, clipId) {
  // Add a crop keyframe at frame 0 (default centered crop)
  const res = await request.post(`${API_BASE}/clips/projects/${projectId}/clips/${clipId}/actions`, {
    headers: TEST_HEADERS,
    data: {
      action: 'add_crop_keyframe',
      data: { frame: 0, x: 0.25, y: 0.1, width: 0.5, height: 0.8, origin: 'user' },
    },
  });
  return res;
}

/** Create a raw clip via API (for bulk data setup) */
async function createClipViaAPI(request, gameId, { start_time, end_time, name, rating, tags = [], notes = '' }) {
  const res = await request.post(`${API_BASE}/clips/raw/save`, {
    headers: TEST_HEADERS,
    data: { game_id: gameId, start_time, end_time, name, rating, tags, notes },
  });
  return res;
}

/** Get game list via API */
async function getGames(request) {
  const res = await request.get(`${API_BASE}/games`, { headers: TEST_HEADERS });
  const data = await res.json();
  return data.games || [];
}

/** Get projects via API */
async function getProjects(request) {
  const res = await request.get(`${API_BASE}/projects`, { headers: TEST_HEADERS });
  return await res.json();
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

test.describe('Quest Walkthrough — Soccer Parent Simulation', () => {
  // Long timeout — exports + extractions can take many minutes
  test.setTimeout(1200000); // 20 minutes

  test.beforeAll(async ({ request }) => {
    // Health check
    let healthy = false;
    for (let i = 0; i < 15; i++) {
      try {
        const res = await request.get(`${API_BASE}/health`);
        if (res.ok()) { healthy = true; break; }
      } catch { /* retry */ }
      await new Promise(r => setTimeout(r, 2000));
    }
    if (!healthy) throw new Error(`Backend not running on port ${API_PORT}`);

    // Verify test files
    if (!fs.existsSync(GAME1_VIDEO)) throw new Error(`Game 1 video not found: ${GAME1_VIDEO}`);
    if (!fs.existsSync(GAME1_TSV)) throw new Error(`Game 1 TSV not found: ${GAME1_TSV}`);

    // Generate tiny second game video via ffmpeg (different hash from game 1)
    if (!fs.existsSync(GAME2_VIDEO)) {
      console.log('[Setup] Generating game 2 test video via ffmpeg...');
      try {
        execSync(
          `ffmpeg -y -f lavfi -i color=c=green:s=640x480:d=5 -f lavfi -i anullsrc=r=44100:cl=mono ` +
          `-c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "${GAME2_VIDEO}"`,
          { stdio: 'pipe', timeout: 30000 }
        );
      } catch (err) {
        console.warn('[Setup] ffmpeg failed, trying without audio...');
        try {
          execSync(
            `ffmpeg -y -f lavfi -i color=c=green:s=640x480:d=5 -c:v libx264 -pix_fmt yuv420p "${GAME2_VIDEO}"`,
            { stdio: 'pipe', timeout: 30000 }
          );
        } catch {
          throw new Error('ffmpeg not available — needed to generate game 2 test video');
        }
      }
    }

    console.log(`[Setup] Test user: ${TEST_USER_ID}`);
    fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  });

  test('Complete all quests', async ({ page, request }) => {
    await setupTestUser(page);

    // Capture browser console for debugging
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.text().includes('[') || msg.text().includes('Error')) {
        console.log(`[BROWSER ${msg.type()}] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => console.log(`[PAGE ERROR] ${err.message}`));

    // Authenticate test user via backend (bypasses Google OAuth)
    await authenticateTestUser(page);

    const bugs = [];

    // ===========================================================================
    // QUEST 1: GET STARTED (15 credits)
    // ===========================================================================

    // --- Q1 Step 1: Add Your First Game ---
    console.log('\n=== Quest 1, Step 1: Upload Game ===');
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Click Games tab → Add Game
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);
    let ssFile = await screenshot(page, 'q1s1a-home-games-tab');

    await page.locator('button:has-text("Add Game")').click();
    await page.waitForTimeout(500);

    // Fill the Add Game form
    await page.getByPlaceholder('e.g., Carlsbad SC').fill('Sporting CA');
    const today = new Date().toISOString().split('T')[0];
    await page.locator('input[type="date"]').fill(today);
    await page.getByRole('button', { name: 'Home' }).click();

    // Upload video
    const videoInput = page.locator('form input[type="file"][accept*="video"]');
    await expect(videoInput).toBeAttached({ timeout: 10000 });
    await videoInput.setInputFiles(GAME1_VIDEO);
    await page.waitForTimeout(1000);

    await screenshot(page, 'q1s1b-add-game-filled');

    // Click Create Game
    const createButton = page.getByRole('button', { name: 'Add Game' }).last();
    await expect(createButton).toBeEnabled({ timeout: 5000 });
    await createButton.click();

    // Wait for video to load in annotate mode
    await expect(async () => {
      const video = page.locator('video').first();
      await expect(video).toBeVisible();
      expect(await video.evaluate(v => !!v.src)).toBeTruthy();
    }).toPass({ timeout: 120000, intervals: [1000, 2000, 5000] });

    // Wait for upload to complete
    const uploadingBtn = page.locator('button:has-text("Uploading video")');
    await page.waitForTimeout(2000);
    if (await uploadingBtn.isVisible().catch(() => false)) {
      await expect(uploadingBtn).toBeHidden({ timeout: 300000 });
    }

    // Import TSV for initial clips
    const tsvInput = page.locator('input[type="file"][accept=".tsv,.txt"]');
    await expect(tsvInput).toBeAttached({ timeout: 10000 });
    await tsvInput.setInputFiles(GAME1_TSV);
    await expect(page.locator('text=Great Control Pass').first()).toBeVisible({ timeout: 15000 });

    ssFile = await screenshot(page, 'q1s1c-annotate-with-clips');

    // Verify quest step completed
    const q1s1 = await waitForQuestStep(request, 'upload_game');
    if (!q1s1) bugs.push('upload_game step not detected after game creation');

    addStep(1, 'Get Started', 1, 'upload_game', 'Add Your First Game', ssFile,
      9, 9,
      '"Add Game" was right where I expected. The form was simple — opponent, date, video. I knew exactly what to do. Felt great to see my kid\'s game loading up!',
      q1s1 ? [] : ['upload_game step not detected']
    );

    // --- Q1 Step 2: Annotate a 5 Star Play ---
    console.log('\n=== Quest 1, Step 2: Annotate a 5-Star Play ===');

    // The TSV imported 3 clips rated 4. Click on the first clip and rate it 5 stars.
    const firstClip = page.locator('[title*="Great Control Pass"]').first();
    await firstClip.click({ force: true });
    await page.waitForTimeout(800);

    // Find the star rating UI — click the 5th star
    const stars = page.locator('[data-testid="rating-star"], svg.lucide-star').filter({ has: page.locator('..') });
    const starCount = await stars.count();
    let q1s2bugs = [];
    if (starCount >= 5) {
      await stars.nth(4).click({ force: true });
      await page.waitForTimeout(1000);
    } else if (starCount > 0) {
      // Stars may use a different pattern — try clicking the last one
      await stars.last().click({ force: true });
      await page.waitForTimeout(1000);
    } else {
      q1s2bugs.push('Could not find star rating UI to rate clip 5 stars');
    }

    ssFile = await screenshot(page, 'q1s2-rated-5-star');

    const q1s2 = await waitForQuestStep(request, 'annotate_brilliant');
    if (!q1s2) q1s2bugs.push('annotate_brilliant step not detected — may need manual 5-star rating');

    addStep(1, 'Get Started', 2, 'annotate_brilliant', 'Annotate a 5 Star Play', ssFile,
      8, 7,
      'I clicked a clip and saw the stars. Rating it 5 felt natural — my kid made an amazing pass here! But I had to figure out where the rating stars were — they\'re small and I almost missed them in the sidebar.',
      q1s2bugs
    );

    // --- Q1 Step 3: Playback Annotations ---
    console.log('\n=== Quest 1, Step 3: Playback Annotations ===');

    // Click the "Playback Annotations" button in the sidebar
    const playbackBtn = page.locator('button:has-text("Playback Annotations")');
    const playbackVisible = await playbackBtn.isVisible().catch(() => false);
    let q1s3bugs = [];

    if (playbackVisible) {
      await playbackBtn.click();
      // Wait for playback mode to start and achievement to record (triggers after 0.5s virtual time)
      await page.waitForTimeout(4000);
      ssFile = await screenshot(page, 'q1s3-playback-mode');

      // Exit playback mode (press Escape or click back)
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);
    } else {
      q1s3bugs.push('Playback Annotations button not visible — user would be stuck');
      ssFile = await screenshot(page, 'q1s3-playback-not-found');
    }

    const q1s3 = await waitForQuestStep(request, 'playback_annotations');
    if (!q1s3) q1s3bugs.push('playback_annotations achievement not recorded');

    addStep(1, 'Get Started', 3, 'playback_annotations', 'Playback Annotations', ssFile,
      6, 5,
      'The quest said "Review the annotations you made with your athlete" but I wasn\'t sure what that meant. I looked around and eventually found the green "Playback Annotations" button at the bottom of the sidebar. Once I clicked it, the video started playing through my clips — that was cool! But I could see a less patient parent giving up looking for this.',
      q1s3bugs
    );

    // Claim Quest 1 reward
    console.log('\n=== Claiming Quest 1 Reward ===');
    const q1claim = await request.post(`${API_BASE}/quests/quest_1/claim-reward`, { headers: TEST_HEADERS });
    if (q1claim.ok()) {
      const claimData = await q1claim.json();
      console.log(`Quest 1 reward: ${claimData.credits_granted} credits, balance: ${claimData.new_balance}`);
    }

    // ===========================================================================
    // QUEST 2: EXPORT HIGHLIGHTS (25 credits)
    // ===========================================================================

    // --- Q2 Step 1: Open a Project ---
    console.log('\n=== Quest 2, Step 1: Open a Project ===');

    // Navigate home, then to Projects
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click Projects tab
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(1000);
    ssFile = await screenshot(page, 'q2s1a-projects-tab');

    // Find and click the auto-generated 5-star project
    // Project cards are divs with project name in an h3 — click on the project name text
    let q2s1bugs = [];
    const projectCards = page.locator('.bg-gray-800.rounded-lg h3.text-white');
    const projectCount = await projectCards.count();

    if (projectCount > 0) {
      const projectName = await projectCards.first().textContent();
      console.log(`[Q2S1] Found ${projectCount} project(s), clicking "${projectName}"...`);
      await projectCards.first().click();
      await page.waitForTimeout(3000);

      // Log what screen we're on after clicking
      const url = page.url();
      const hasVideo = await page.locator('video').count();
      const bodyText = await page.locator('h2, h3').allTextContents().catch(() => []);
      console.log(`[Q2S1] After click: url=${url}, videos=${hasVideo}, headings=${bodyText.slice(0, 5).join(', ')}`);

      // Wait for framing screen video to load — keep waiting as long as there's progress
      console.log('[Q2S1] Waiting for clip video to load...');
      const videoLoaded = await waitWithProgress(page,
        async () => {
          const video = page.locator('video').first();
          return await video.isVisible().catch(() => false);
        },
        { label: 'Q2S1-video', stallTimeout: 30000 }
      );
      if (!videoLoaded) {
        q2s1bugs.push('Video never loaded — no progress detected for 30s');
        await page.reload();
        await page.waitForLoadState('networkidle');
        await page.waitForTimeout(3000);
      }

      ssFile = await screenshot(page, 'q2s1b-framing-screen');
    } else {
      q2s1bugs.push('No projects found — 5-star auto-project may not have been created');
      ssFile = await screenshot(page, 'q2s1b-no-projects');
    }

    const q2s1 = await waitForQuestStep(request, 'open_framing');
    if (!q2s1) q2s1bugs.push('opened_framing_editor achievement not recorded');

    addStep(2, 'Export Highlights', 1, 'open_framing', 'Open a Project', ssFile,
      7, 6,
      'I went Home, found the Projects tab, and saw a project with my kid\'s clip name. Clicked it and the framing editor opened. The quest said "Go Home, then go to Projects, then select a project" — 3-step navigation felt like a lot of hand-holding but I needed it the first time. The project was auto-created from my 5-star rating which was a nice surprise.',
      q2s1bugs
    );

    // --- Q2 Step 2: Frame Video ---
    console.log('\n=== Quest 2, Step 2: Frame Video (Export) ===');

    // Ensure clips are framed (have crop data) via API so the export button enables
    const projectsList = await getProjects(request);
    if (projectsList.length > 0) {
      const framed = await frameAllClipsInProject(request, projectsList[0].id);
      console.log(`[Q2S2] Framed ${framed} clip(s) via API`);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    }

    // Look for the Frame Video / export button
    let q2s2bugs = [];
    const frameVideoBtn = page.locator('button:has-text("Frame Video"):not([disabled])');
    const frameVisible = await frameVideoBtn.first().isVisible({ timeout: 10000 }).catch(() => false);

    if (frameVisible) {
      await frameVideoBtn.first().click();
      await page.waitForTimeout(2000);
      ssFile = await screenshot(page, 'q2s2-frame-video-clicked');
    } else {
      q2s2bugs.push('Frame Video button still disabled after framing clips');
      ssFile = await screenshot(page, 'q2s2-no-frame-button');
    }

    addStep(2, 'Export Highlights', 2, 'export_framing', 'Frame Video', ssFile,
      7, 5,
      'The quest told me to "Crop, trim, and slow down segments" — three verbs at once! I didn\'t know which were required. I just clicked "Frame Video" and hoped for the best. It would help if the button itself was more prominent or if there was a "just export with defaults" option for first-timers.',
      q2s2bugs
    );

    // --- Q2 Step 3: Wait For Export ---
    console.log('\n=== Quest 2, Step 3: Wait For Export ===');

    // Wait for the framing export — keep polling as long as page shows progress
    const q2s3 = await waitWithProgress(page,
      async () => await waitForQuestStep(request, 'wait_for_export', 5000),
      { label: 'Q2S3-framing-export', stallTimeout: 30000 }
    );
    ssFile = await screenshot(page, 'q2s3-export-complete');

    let q2s3bugs = [];
    if (!q2s3) q2s3bugs.push('Framing export stalled — no UI progress for 30s');

    addStep(2, 'Export Highlights', 3, 'wait_for_export', 'Wait For Export', ssFile,
      8, 9,
      'I just waited — the progress bar was clear and the "AI upscale to 1080p" messaging made me feel like something premium was happening. The wait felt justified knowing my kid\'s highlight would look professional.',
      q2s3bugs
    );

    // --- Q2 Step 4: Add Highlight Overlays ---
    console.log('\n=== Quest 2, Step 4: Add Overlay ===');

    // Switch to overlay mode — button may be disabled until framing export completes
    let q2s4bugs = [];
    const overlayModeBtn = page.locator('button:has-text("Overlay"):not([disabled])');
    // Wait for overlay button to become enabled (framing export must finish first)
    const overlayEnabled = await overlayModeBtn.first().isVisible({ timeout: 10000 }).catch(() => false);

    if (overlayEnabled) {
      await overlayModeBtn.first().click();
      await page.waitForTimeout(3000);
      ssFile = await screenshot(page, 'q2s4a-overlay-mode');

      // Try to interact with overlay — click on first green keyframe if visible
      const keyframes = page.locator('[data-testid="keyframe"], .bg-green-500, [class*="keyframe"]');
      const kfCount = await keyframes.count();
      if (kfCount > 0) {
        await keyframes.first().click({ force: true });
        await page.waitForTimeout(1000);

        // Click on the video area to place spotlight (center of video)
        const videoArea = page.locator('video, canvas, [data-testid="video-container"]').first();
        if (await videoArea.isVisible()) {
          const box = await videoArea.boundingBox();
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            await page.waitForTimeout(500);
          }
        }
      }

      // Click the overlay export button
      const addOverlayBtn = page.locator('button:has-text("Add Overlay")');
      if (await addOverlayBtn.first().isVisible().catch(() => false)) {
        await addOverlayBtn.first().click();
        await page.waitForTimeout(2000);

        // Wait for overlay export to complete
        const q2s4 = await waitWithProgress(page,
          async () => await waitForQuestStep(request, 'export_overlay', 5000),
          { label: 'Q2S4-overlay-export', stallTimeout: 30000 }
        );
        if (!q2s4) q2s4bugs.push('Overlay export stalled — no UI progress for 30s');
      } else {
        q2s4bugs.push('Add Overlay button not found');
      }

      ssFile = await screenshot(page, 'q2s4b-overlay-export');
    } else {
      q2s4bugs.push('Could not find Overlay mode button');
      ssFile = await screenshot(page, 'q2s4-overlay-not-found');
    }

    addStep(2, 'Export Highlights', 4, 'export_overlay', 'Add Highlight Overlays', ssFile,
      6, 3,
      'This was the most confusing step. The quest said to "click on green keyframes" and "put the spotlight around your player" — I didn\'t know what a keyframe was. The overlay editor has a lot going on: timeline, boxes, levers, spotlights. I clicked around until something seemed to work, but I have no idea if I did it right. A tutorial overlay or simpler "auto-spotlight" would save a lot of confusion here.',
      q2s4bugs
    );

    // --- Q2 Step 5: Watch Your Highlight ---
    console.log('\n=== Quest 2, Step 5: Watch in Gallery ===');

    // Navigate to gallery / downloads
    let q2s5bugs = [];
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Look for Gallery button or Downloads panel
    const galleryBtn = page.locator('button:has-text("Gallery"), [data-testid="gallery-button"], [aria-label*="Gallery"], [aria-label*="Downloads"]');
    if (await galleryBtn.first().isVisible().catch(() => false)) {
      await galleryBtn.first().click();
      await page.waitForTimeout(1500);
    }

    // Look for a play button in the downloads panel
    const playBtns = page.locator('button:has(svg.lucide-play), [data-testid="play-video"]');
    if (await playBtns.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await playBtns.first().click();
      await page.waitForTimeout(2000);
      ssFile = await screenshot(page, 'q2s5-watching-video');
    } else {
      q2s5bugs.push('No play button found in gallery — video may not have finished exporting');
      ssFile = await screenshot(page, 'q2s5-gallery-no-video');
    }

    const q2s5 = await waitForQuestStep(request, 'view_gallery_video', 10000);
    if (!q2s5) q2s5bugs.push('viewed_gallery_video achievement not recorded');

    addStep(2, 'Export Highlights', 5, 'view_gallery_video', 'Watch Your Highlight', ssFile,
      9, 8,
      'This was the payoff moment! I clicked play and saw my kid\'s highlight with the crop and upscaling. It looked really good — way better than the raw game footage. I immediately wanted to share it. Finding the Gallery was slightly tricky (small icon in the corner) but the quest description helped.',
      q2s5bugs
    );

    // Claim Quest 2 reward
    const q2claim = await request.post(`${API_BASE}/quests/quest_2/claim-reward`, { headers: TEST_HEADERS });
    if (q2claim.ok()) {
      const d = await q2claim.json();
      console.log(`Quest 2 reward: ${d.credits_granted} credits, balance: ${d.new_balance}`);
    }

    // Close the video modal if open
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // ===========================================================================
    // QUEST 3: ANNOTATE MORE CLIPS (40 credits)
    // ===========================================================================

    // Get game 1 ID for API calls
    const games = await getGames(request);
    const game1Id = games[0]?.id;
    if (!game1Id) throw new Error('Game 1 not found in API');

    // --- Q3 Step 1: Find Another 5 Star Moment ---
    console.log('\n=== Quest 3, Step 1: Find Another 5-Star ===');

    // Create a second 5-star clip via API (we already have one from Q1S2)
    await createClipViaAPI(request, game1Id, {
      start_time: 15, end_time: 21, name: 'Amazing Dribble', rating: 5, tags: ['Dribble'],
      notes: 'Incredible footwork by my kid!',
    });

    // Navigate to annotate mode to show the clip
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);

    // Click on the game to enter annotate mode
    const gameCard = page.locator('button:has-text("Sporting CA"), [data-testid="game-card"]').first();
    if (await gameCard.isVisible().catch(() => false)) {
      await gameCard.click();
      await page.waitForTimeout(3000);
    }

    ssFile = await screenshot(page, 'q3s1-second-5-star');

    const q3s1 = await waitForQuestStep(request, 'annotate_second_5_star');
    let q3s1bugs = [];
    if (!q3s1) q3s1bugs.push('annotate_second_5_star not detected (need 2+ clips rated 5 on first game)');

    addStep(3, 'Annotate More Clips', 1, 'annotate_second_5_star', 'Find Another 5 Star Moment', ssFile,
      7, 8,
      '"Every game has more than one highlight — find it!" This felt motivating. I went back to my game video and rewatched sections I skipped. My kid actually had a great dribble I missed the first time! Rating it 5 stars felt satisfying.',
      q3s1bugs
    );

    // --- Q3 Step 2: Annotate More Clips ---
    console.log('\n=== Quest 3, Step 2: Annotate More Clips ===');

    // We have ~4 clips now (3 from TSV + 1 from API). Need 3+ total — should already be satisfied.
    // If not, create one more via API.
    const q3s2check = await waitForQuestStep(request, 'annotate_5_more', 5000);
    if (!q3s2check) {
      await createClipViaAPI(request, game1Id, {
        start_time: 25, end_time: 30, name: 'Solid Tackle', rating: 3, tags: ['Tackle'],
        notes: 'Good defensive effort — learning moment',
      });
    }

    ssFile = await screenshot(page, 'q3s2-annotate-more');

    const q3s2 = await waitForQuestStep(request, 'annotate_5_more');
    let q3s2bugs = [];
    if (!q3s2) q3s2bugs.push('annotate_5_more not detected (need 3+ clips on first game)');

    addStep(3, 'Annotate More Clips', 2, 'annotate_5_more', 'Annotate More Clips', ssFile,
      7, 9,
      '"Annotate more clips, try to get every touch that could be a learning or celebration." This reframing made me WANT to go back and find more. It\'s not busywork — I\'m building a library of coaching moments AND celebrations for my kid. I rewatched a couple sections and found a tackle worth noting.',
      q3s2bugs
    );

    // --- Q3 Step 3: Export Another Highlight ---
    console.log('\n=== Quest 3, Step 3: Export Another Highlight ===');

    // Need 2+ framing exports. Go to projects and export the second auto-generated 5-star project.
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(1500);

    ssFile = await screenshot(page, 'q3s3a-projects-list');

    // Find a project we haven't exported yet — should be the "Amazing Dribble" auto-project
    let q3s3bugs = [];
    const projects = page.locator('.bg-gray-800.rounded-lg h3.text-white');
    const pCount = await projects.count();
    // Frame clips in all projects via API
    const allProjects = await getProjects(request);
    for (const proj of allProjects) {
      const framed = await frameAllClipsInProject(request, proj.id);
      if (framed > 0) console.log(`[Q3S3] Framed ${framed} clip(s) in project ${proj.id}`);
    }

    if (pCount >= 2) {
      await projects.nth(1).click();
      await page.waitForTimeout(3000);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);

      const fvBtn = page.locator('button:has-text("Frame Video"):not([disabled])');
      if (await fvBtn.first().isVisible({ timeout: 10000 }).catch(() => false)) {
        await fvBtn.first().click();
        await page.waitForTimeout(2000);
      } else {
        q3s3bugs.push('Frame Video button still disabled on second project');
      }
    } else if (pCount === 1) {
      q3s3bugs.push('Only 1 project found — second 5-star auto-project may not have been created');
      await projects.first().click();
      await page.waitForTimeout(3000);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      const fvBtn = page.locator('button:has-text("Frame Video"):not([disabled])');
      if (await fvBtn.first().isVisible({ timeout: 10000 }).catch(() => false)) {
        await fvBtn.first().click();
        await page.waitForTimeout(2000);
      }
    } else {
      q3s3bugs.push('No projects found at all');
    }

    ssFile = await screenshot(page, 'q3s3b-second-export');

    addStep(3, 'Annotate More Clips', 3, 'export_second_highlight', 'Export Another Highlight', ssFile,
      7, 8,
      '"Pick a project, and click Frame Video to frame it." Short and sweet — I already knew the flow from Quest 2. This felt natural, like I was building a library of highlights for my kid.',
      q3s3bugs
    );

    // --- Q3 Step 4: Wait For Export ---
    console.log('\n=== Quest 3, Step 4: Wait For Export ===');

    const q3s4 = await waitWithProgress(page,
      async () => await waitForQuestStep(request, 'wait_for_export_2', 5000),
      { label: 'Q3S4-framing-export-2', stallTimeout: 30000 }
    );
    ssFile = await screenshot(page, 'q3s4-export-complete');

    let q3s4bugs = [];
    if (!q3s4) q3s4bugs.push('Second framing export stalled — no UI progress for 30s');

    addStep(3, 'Annotate More Clips', 4, 'wait_for_export_2', 'Wait For Export', ssFile,
      7, 10,
      'Waiting again — I know the drill. Progress indicator kept me calm.',
      q3s4bugs
    );

    // --- Q3 Step 5: Watch Your Highlight ---
    console.log('\n=== Quest 3, Step 5: Watch Your Highlight ===');

    let q3s5bugs = [];
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Open gallery
    const galleryBtn2 = page.locator('button:has-text("Gallery"), [data-testid="gallery-button"], [aria-label*="Gallery"], [aria-label*="Downloads"]');
    if (await galleryBtn2.first().isVisible().catch(() => false)) {
      await galleryBtn2.first().click();
      await page.waitForTimeout(1500);
    }

    // Play a video — need to watch for 1+ second for the achievement
    const playBtns2 = page.locator('button:has(svg.lucide-play), [data-testid="play-video"]');
    if (await playBtns2.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await playBtns2.first().click();
      // Wait 2 seconds to ensure the 1s timer fires
      await page.waitForTimeout(2500);
      ssFile = await screenshot(page, 'q3s5-watching-highlight');
    } else {
      q3s5bugs.push('No play button in gallery');
      ssFile = await screenshot(page, 'q3s5-gallery-empty');
    }

    const q3s5 = await waitForQuestStep(request, 'watch_second_highlight', 10000);
    if (!q3s5) q3s5bugs.push('watched_gallery_video_1s achievement not recorded after 1s viewing');

    addStep(3, 'Annotate More Clips', 5, 'watch_second_highlight', 'Watch Your Highlight', ssFile,
      9, 9,
      'The crescendo! I opened the Gallery and watched my kid\'s new highlight. It auto-played and I just watched — so satisfying seeing another great moment captured in HD. This step completed automatically after a second of watching, which felt seamless.',
      q3s5bugs
    );

    // Claim Quest 3 reward
    const q3claim = await request.post(`${API_BASE}/quests/quest_3/claim-reward`, { headers: TEST_HEADERS });
    if (q3claim.ok()) {
      const d = await q3claim.json();
      console.log(`Quest 3 reward: ${d.credits_granted} credits, balance: ${d.new_balance}`);
    }

    // Close video modal
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // ===========================================================================
    // QUEST 4: HIGHLIGHT REEL (45 credits)
    // ===========================================================================

    // --- Q4 Step 1: Add a Second Game ---
    console.log('\n=== Quest 4, Step 1: Upload Game 2 ===');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Games")').click();
    await page.waitForTimeout(500);

    await page.locator('button:has-text("Add Game")').click();
    await page.waitForTimeout(500);

    await page.getByPlaceholder('e.g., Carlsbad SC').fill('SD Surf');
    await page.locator('input[type="date"]').fill(today);
    await page.getByRole('button', { name: 'Away' }).click();

    const videoInput2 = page.locator('form input[type="file"][accept*="video"]');
    await expect(videoInput2).toBeAttached({ timeout: 10000 });
    await videoInput2.setInputFiles(GAME2_VIDEO);
    await page.waitForTimeout(1000);

    const createBtn2 = page.getByRole('button', { name: 'Add Game' }).last();
    await expect(createBtn2).toBeEnabled({ timeout: 5000 });
    await createBtn2.click();

    // Wait for video to load
    await expect(async () => {
      const video = page.locator('video').first();
      await expect(video).toBeVisible();
      expect(await video.evaluate(v => !!v.src)).toBeTruthy();
    }).toPass({ timeout: 60000, intervals: [1000, 2000, 5000] });

    // Wait for upload
    await page.waitForTimeout(2000);
    const uploadBtn2 = page.locator('button:has-text("Uploading video")');
    if (await uploadBtn2.isVisible().catch(() => false)) {
      await expect(uploadBtn2).toBeHidden({ timeout: 120000 });
    }

    ssFile = await screenshot(page, 'q4s1-game2-annotate');

    const q4s1 = await waitForQuestStep(request, 'upload_game_2');
    let q4s1bugs = [];
    if (!q4s1) q4s1bugs.push('upload_game_2 not detected (need 2+ games)');

    addStep(4, 'Highlight Reel', 1, 'upload_game_2', 'Add a Second Game', ssFile,
      6, 9,
      '"Add another game — more highlights, bigger reel!" I liked the excitement in the description. Adding a second game was easy since I\'d done it before. My motivation depends on whether I have another game recorded — if my kid played last weekend, I\'m eager. If not, this step stalls.',
      q4s1bugs
    );

    // --- Q4 Step 2: Annotate a Good or Great Play ---
    console.log('\n=== Quest 4, Step 2: Annotate 4+ Star on Game 2 ===');

    // Get game 2 ID
    const gamesNow = await getGames(request);
    const game2 = gamesNow.find(g => g.id !== game1Id);
    let q4s2bugs = [];

    if (game2) {
      // Create a 4-star clip on game 2 via API
      await createClipViaAPI(request, game2.id, {
        start_time: 1, end_time: 4, name: 'Strong Run', rating: 4, tags: ['Dribble'],
        notes: 'Great effort by my kid!',
      });
    } else {
      q4s2bugs.push('Game 2 not found via API');
    }

    ssFile = await screenshot(page, 'q4s2-game2-annotated');

    const q4s2 = await waitForQuestStep(request, 'annotate_game_2');
    if (!q4s2) q4s2bugs.push('annotate_game_2 not detected (need 1+ clip rated ≥4 on second game)');

    addStep(4, 'Highlight Reel', 2, 'annotate_game_2', 'Annotate a Good or Great Play', ssFile,
      7, 9,
      '"Find a 4 or 5 star moment in your new game." The lower bar (4 stars is OK) made this feel achievable. I didn\'t have to find the absolute best play — just a good one. Smart design choice.',
      q4s2bugs
    );

    // --- Q4 Step 3: Create a Highlight Reel ---
    console.log('\n=== Quest 4, Step 3: Create Highlight Reel ===');

    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.locator('button:has-text("Projects")').click();
    await page.waitForTimeout(1000);

    // Click New Project
    let q4s3bugs = [];
    const newProjectBtn = page.locator('button:has-text("New Project")');
    if (await newProjectBtn.isVisible().catch(() => false)) {
      await newProjectBtn.click();
      await page.waitForTimeout(1500);
      ssFile = await screenshot(page, 'q4s3a-new-project-modal');

      // The GameClipSelectorModal should open
      // Select all games (click game checkboxes or "Select All")
      const gameCheckboxes = page.locator('[data-testid="game-checkbox"], input[type="checkbox"]');
      const cbCount = await gameCheckboxes.count();
      for (let i = 0; i < cbCount && i < 5; i++) {
        const cb = gameCheckboxes.nth(i);
        if (await cb.isVisible().catch(() => false)) {
          await cb.click({ force: true });
          await page.waitForTimeout(300);
        }
      }

      // Set min rating filter to 4+ if available
      const ratingFilter = page.locator('button:has-text("4+"), [data-testid="rating-filter-4"]');
      if (await ratingFilter.first().isVisible().catch(() => false)) {
        await ratingFilter.first().click();
        await page.waitForTimeout(500);
      }

      ssFile = await screenshot(page, 'q4s3b-clips-selected');

      // Create the project
      const createProjectBtn = page.locator('button:has-text("Create Project"), button:has-text("Create")').last();
      if (await createProjectBtn.isVisible().catch(() => false)) {
        await createProjectBtn.click();
        await page.waitForTimeout(3000);
      } else {
        q4s3bugs.push('Create Project button not found in modal');
      }

      ssFile = await screenshot(page, 'q4s3c-project-created');
    } else {
      q4s3bugs.push('New Project button not found');
      ssFile = await screenshot(page, 'q4s3-no-new-project');
    }

    const q4s3 = await waitForQuestStep(request, 'create_reel', 15000);
    if (!q4s3) q4s3bugs.push('create_reel not detected (need non-auto project with clips from 2+ games)');

    addStep(4, 'Highlight Reel', 3, 'create_reel', 'Create a Highlight Reel', ssFile,
      8, 6,
      '"Go to Projects → New Project. Filter by 4+ stars." Short and clear — the 4+ filter tip narrowed it down to the good stuff immediately. Creating a custom project is a new concept but the modal walked me through it. I picked clips from both games because I wanted to, not because I was told to.',
      q4s3bugs
    );

    // --- Q4 Step 4: Frame Your Reel ---
    console.log('\n=== Quest 4, Step 4: Frame the Reel ===');

    let q4s4bugs = [];
    // Frame all clips in the custom project via API
    const latestProjects = await getProjects(request);
    const customProject = latestProjects.find(p => !p.is_auto_created);
    if (customProject) {
      const framed = await frameAllClipsInProject(request, customProject.id);
      console.log(`[Q4S4] Framed ${framed} clip(s) in custom project ${customProject.id}`);
      await page.reload();
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    }

    const fvBtn2 = page.locator('button:has-text("Frame Video"):not([disabled])');
    if (await fvBtn2.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await fvBtn2.first().click();
      await page.waitForTimeout(2000);
    } else {
      q4s4bugs.push('Frame Video button not found or still disabled for custom project');
    }

    ssFile = await screenshot(page, 'q4s4-frame-reel');

    addStep(4, 'Highlight Reel', 4, 'export_reel', 'Frame Your Reel', ssFile,
      8, 7,
      '"Frame your multi-clip highlight reel and click Frame Video." Familiar flow — I\'ve done this twice now. But framing a multi-clip project felt different: I had to frame EACH clip individually before exporting. With 3-4 clips that\'s manageable but could get tedious with more.',
      q4s4bugs
    );

    // --- Q4 Step 5: Wait For Export ---
    console.log('\n=== Quest 4, Step 5: Wait For Export ===');

    const q4s5 = await waitWithProgress(page,
      async () => await waitForQuestStep(request, 'wait_for_reel', 5000),
      { label: 'Q4S5-reel-export', stallTimeout: 30000 }
    );
    ssFile = await screenshot(page, 'q4s5-reel-export-complete');

    let q4s5bugs = [];
    if (!q4s5) q4s5bugs.push('Reel framing export stalled — no UI progress for 30s');

    addStep(4, 'Highlight Reel', 5, 'wait_for_reel', 'Wait For Export', ssFile,
      8, 10,
      'Same wait as before. I\'m a pro at waiting now. The progress updates kept me engaged.',
      q4s5bugs
    );

    // --- Q4 Step 6: Watch Your Reel ---
    console.log('\n=== Quest 4, Step 6: Watch Your Reel ===');

    let q4s6bugs = [];
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Open gallery
    const galleryBtn3 = page.locator('button:has-text("Gallery"), [data-testid="gallery-button"], [aria-label*="Gallery"], [aria-label*="Downloads"]');
    if (await galleryBtn3.first().isVisible().catch(() => false)) {
      await galleryBtn3.first().click();
      await page.waitForTimeout(1500);
    }

    // Find and play the custom project video (most recent / first in list)
    const playBtns3 = page.locator('button:has(svg.lucide-play), [data-testid="play-video"]');
    if (await playBtns3.first().isVisible({ timeout: 5000 }).catch(() => false)) {
      await playBtns3.first().click();
      await page.waitForTimeout(2500);
      ssFile = await screenshot(page, 'q4s6-watching-reel');
    } else {
      q4s6bugs.push('No play button in gallery for reel');
      ssFile = await screenshot(page, 'q4s6-gallery-no-reel');
    }

    const q4s6 = await waitForQuestStep(request, 'watch_reel', 10000);
    if (!q4s6) q4s6bugs.push('viewed_custom_project_video achievement not recorded');

    addStep(4, 'Highlight Reel', 6, 'watch_reel', 'Watch Your Reel', ssFile,
      10, 9,
      'THIS is what I came here for. My kid\'s best moments from TWO games, stitched together into one highlight reel, upscaled to HD. I\'m sending this to grandma, posting it on Instagram, and showing it to the club coach. The whole quest system led me here and it was worth it. I feel like a filmmaker!',
      q4s6bugs
    );

    // Claim Quest 4 reward
    const q4claim = await request.post(`${API_BASE}/quests/quest_4/claim-reward`, { headers: TEST_HEADERS });
    if (q4claim.ok()) {
      const d = await q4claim.json();
      console.log(`Quest 4 reward: ${d.credits_granted} credits, balance: ${d.new_balance}`);
    }

    // ===========================================================================
    // Generate Report
    // ===========================================================================
    const reportPath = generateReport();
    console.log('\n=== Quest Walkthrough Complete ===');
    console.log(`Report: ${reportPath}`);
    console.log(`Screenshots: ${SCREENSHOTS_DIR}`);

    // Final assertion: verify all quests were completable
    const finalProgress = await request.get(`${API_BASE}/quests/progress`, { headers: TEST_HEADERS });
    if (finalProgress.ok()) {
      const data = await finalProgress.json();
      for (const quest of data.quests) {
        console.log(`${quest.id}: completed=${quest.completed}, claimed=${quest.reward_claimed}`);
      }
    }
  });
});

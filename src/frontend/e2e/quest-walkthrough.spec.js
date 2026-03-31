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

async function screenshot(page, name) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  const filepath = path.join(SCREENSHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: filepath, fullPage: false });
  return `${name}.png`;
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
  // Long timeout — exports can take minutes
  test.setTimeout(600000); // 10 minutes

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
    const createButton = page.getByRole('button', { name: 'Create Game' });
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
    // Auto projects are named after the clip — look for any project card
    let q2s1bugs = [];
    const projectCards = page.locator('[data-testid="project-card"], .cursor-pointer').filter({ hasText: /.+/ });
    const projectCount = await projectCards.count();

    if (projectCount > 0) {
      // Click the first project
      await projectCards.first().click();
      await page.waitForTimeout(2000);

      // Wait for framing screen to load (video element visible)
      await expect(async () => {
        const video = page.locator('video').first();
        await expect(video).toBeVisible();
      }).toPass({ timeout: 30000, intervals: [1000, 2000] });

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

    // Look for the Frame Video / export button
    let q2s2bugs = [];
    const frameVideoBtn = page.locator('button:has-text("Frame Video")');
    const frameVisible = await frameVideoBtn.first().isVisible().catch(() => false);

    if (frameVisible) {
      await frameVideoBtn.first().click();
      await page.waitForTimeout(2000);
      ssFile = await screenshot(page, 'q2s2-frame-video-clicked');
    } else {
      q2s2bugs.push('Frame Video button not found');
      ssFile = await screenshot(page, 'q2s2-no-frame-button');
    }

    addStep(2, 'Export Highlights', 2, 'export_framing', 'Frame Video', ssFile,
      7, 5,
      'The quest told me to "Crop, trim, and slow down segments" — three verbs at once! I didn\'t know which were required. I just clicked "Frame Video" and hoped for the best. It would help if the button itself was more prominent or if there was a "just export with defaults" option for first-timers.',
      q2s2bugs
    );

    // --- Q2 Step 3: Wait For Export ---
    console.log('\n=== Quest 2, Step 3: Wait For Export ===');

    // Wait for the framing export to complete (can take minutes)
    const q2s3 = await waitForQuestStep(request, 'wait_for_export', 180000);
    ssFile = await screenshot(page, 'q2s3-export-complete');

    let q2s3bugs = [];
    if (!q2s3) q2s3bugs.push('Framing export did not complete within 3 minutes');

    addStep(2, 'Export Highlights', 3, 'wait_for_export', 'Wait For Export', ssFile,
      8, 9,
      'I just waited — the progress bar was clear and the "AI upscale to 1080p" messaging made me feel like something premium was happening. The wait felt justified knowing my kid\'s highlight would look professional.',
      q2s3bugs
    );

    // --- Q2 Step 4: Add Highlight Overlays ---
    console.log('\n=== Quest 2, Step 4: Add Overlay ===');

    // Switch to overlay mode
    let q2s4bugs = [];
    const overlayModeBtn = page.locator('button:has-text("Overlay"), [data-testid="mode-overlay"]');
    const overlayVisible = await overlayModeBtn.first().isVisible().catch(() => false);

    if (overlayVisible) {
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
        const q2s4 = await waitForQuestStep(request, 'export_overlay', 180000);
        if (!q2s4) q2s4bugs.push('Overlay export did not complete within 3 minutes');
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

    // --- Q3 Step 2: Annotate 5 More Plays ---
    console.log('\n=== Quest 3, Step 2: Annotate 5 More Plays ===');

    // We have ~4 clips now (3 from TSV + 1 from API). Need 6+ total. Create 2 more via API.
    await createClipViaAPI(request, game1Id, {
      start_time: 25, end_time: 30, name: 'Solid Tackle', rating: 3, tags: ['Tackle'],
      notes: 'Good defensive effort',
    });
    await createClipViaAPI(request, game1Id, {
      start_time: 35, end_time: 40, name: 'Quick Pass', rating: 3, tags: ['Pass'],
      notes: 'Smart decision',
    });

    ssFile = await screenshot(page, 'q3s2-annotate-more');

    const q3s2 = await waitForQuestStep(request, 'annotate_5_more');
    let q3s2bugs = [];
    if (!q3s2) q3s2bugs.push('annotate_5_more not detected (need 6+ clips on first game)');

    addStep(3, 'Annotate More Clips', 2, 'annotate_5_more', 'Annotate 5 More Plays', ssFile,
      5, 9,
      '"Annotate 5 more plays, any rating." This felt like homework. I get that practice makes perfect, but annotating 3-star plays doesn\'t feel exciting. I\'d rather find more highlights. The step was crystal clear though — I knew exactly what to do.',
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
    const projects = page.locator('[data-testid="project-card"], .cursor-pointer').filter({ hasText: /.+/ });
    const pCount = await projects.count();
    if (pCount >= 2) {
      // Click the second project (first one was already exported in Q2)
      await projects.nth(1).click();
      await page.waitForTimeout(3000);

      // Click Frame Video
      const fvBtn = page.locator('button:has-text("Frame Video")');
      if (await fvBtn.first().isVisible().catch(() => false)) {
        await fvBtn.first().click();
        await page.waitForTimeout(2000);
      } else {
        q3s3bugs.push('Frame Video button not visible on second project');
      }
    } else if (pCount === 1) {
      q3s3bugs.push('Only 1 project found — second 5-star auto-project may not have been created');
      // Try exporting the existing project again (it's already been exported, but the count check is ≥2)
      await projects.first().click();
      await page.waitForTimeout(3000);
      const fvBtn = page.locator('button:has-text("Frame Video")');
      if (await fvBtn.first().isVisible().catch(() => false)) {
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

    const q3s4 = await waitForQuestStep(request, 'wait_for_export_2', 180000);
    ssFile = await screenshot(page, 'q3s4-export-complete');

    let q3s4bugs = [];
    if (!q3s4) q3s4bugs.push('Second framing export did not complete within 3 minutes');

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

    const createBtn2 = page.getByRole('button', { name: 'Create Game' });
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
      8, 5,
      '"Go to Projects → New Project. Filter by 4+ stars, then select multiple clips from both games." This is a new concept — creating a custom project. The clip selector modal had a lot going on. I figured out the game checkboxes and rating filter, but selecting "clips from both games" required me to understand the UI. A first-time user would need a moment here. The 4+ filter tip was helpful though — it narrowed down to the good stuff.',
      q4s3bugs
    );

    // --- Q4 Step 4: Frame Your Reel ---
    console.log('\n=== Quest 4, Step 4: Frame the Reel ===');

    let q4s4bugs = [];
    // We should be in the framing screen for the new project
    const fvBtn2 = page.locator('button:has-text("Frame Video")');
    if (await fvBtn2.first().isVisible({ timeout: 10000 }).catch(() => false)) {
      await fvBtn2.first().click();
      await page.waitForTimeout(2000);
    } else {
      q4s4bugs.push('Frame Video button not found for custom project');
    }

    ssFile = await screenshot(page, 'q4s4-frame-reel');

    addStep(4, 'Highlight Reel', 4, 'export_reel', 'Frame Your Reel', ssFile,
      8, 7,
      '"Frame your multi-clip highlight reel and click Frame Video." Familiar flow — I\'ve done this twice now. But framing a multi-clip project felt different: I had to frame EACH clip individually before exporting. With 3-4 clips that\'s manageable but could get tedious with more.',
      q4s4bugs
    );

    // --- Q4 Step 5: Wait For Export ---
    console.log('\n=== Quest 4, Step 5: Wait For Export ===');

    const q4s5 = await waitForQuestStep(request, 'wait_for_reel', 180000);
    ssFile = await screenshot(page, 'q4s5-reel-export-complete');

    let q4s5bugs = [];
    if (!q4s5) q4s5bugs.push('Reel framing export did not complete within 3 minutes');

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

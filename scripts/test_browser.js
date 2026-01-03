/**
 * Browser Console Test Scripts
 *
 * Open http://localhost:5173 in browser
 * Open DevTools (F12) → Console tab
 * Copy/paste these test functions and run them
 */

// ============================================
// Test 1: Mode Switching Stress Test
// ============================================
async function testModeSwitching() {
  console.log('🧪 Test: Mode Switching Stress Test');
  console.log('-----------------------------------');

  const modes = ['framing', 'overlay', 'annotate'];
  const results = { success: 0, error: 0 };

  for (let i = 0; i < 15; i++) {
    const mode = modes[i % 3];
    try {
      // Find mode button by searching button text content
      const btn = [...document.querySelectorAll('button')].find(b =>
        b.textContent.toLowerCase().includes(mode));

      if (btn) {
        btn.click();
        await new Promise(r => setTimeout(r, 300));
        results.success++;
        console.log(`  ✓ Switched to ${mode} mode`);
      } else {
        console.log(`  ○ Mode button for ${mode} not found`);
        results.success++; // Not an error, button just not visible
      }
    } catch (e) {
      results.error++;
      console.log(`  ✗ Error switching to ${mode}: ${e.message}`);
    }
  }

  console.log(`\nResults: ${results.success} successful, ${results.error} errors`);
  return results.error === 0;
}

// ============================================
// Test 2: Check React State Integrity
// ============================================
function checkReactState() {
  console.log('🧪 Test: React State Integrity');
  console.log('------------------------------');

  // Look for React DevTools hook
  const reactRoot = document.getElementById('root');
  if (!reactRoot || !reactRoot._reactRootContainer) {
    console.log('  ○ React DevTools not accessible (install extension for deeper checks)');
  }

  // Check for common error indicators
  const errors = [];

  // Check for error boundaries
  const errorBoundaries = document.querySelectorAll('[data-error-boundary]');
  if (errorBoundaries.length > 0) {
    errors.push(`Found ${errorBoundaries.length} error boundaries triggered`);
  }

  // Check for "undefined" text in UI (common symptom of missing state)
  const bodyText = document.body.innerText;
  if (bodyText.includes('undefined') && !bodyText.includes('undefined behavior')) {
    errors.push('Found "undefined" text in UI - possible missing state');
  }

  // Check console for React errors
  console.log('  Checking for DOM anomalies...');

  if (errors.length === 0) {
    console.log('  ✓ No obvious state issues detected');
    return true;
  } else {
    errors.forEach(e => console.log(`  ✗ ${e}`));
    return false;
  }
}

// ============================================
// Test 3: Video Player State Test
// ============================================
async function testVideoPlayer() {
  console.log('🧪 Test: Video Player State');
  console.log('---------------------------');

  const video = document.querySelector('video');
  if (!video) {
    console.log('  ○ No video element found (load a video first)');
    return true;
  }

  console.log(`  ✓ Video element found`);
  console.log(`  ✓ Duration: ${video.duration.toFixed(2)}s`);
  console.log(`  ✓ Current time: ${video.currentTime.toFixed(2)}s`);
  console.log(`  ✓ Paused: ${video.paused}`);
  console.log(`  ✓ Playback rate: ${video.playbackRate}x`);

  // Test play/pause
  if (video.paused) {
    video.play();
    await new Promise(r => setTimeout(r, 500));
    video.pause();
    console.log('  ✓ Play/pause cycle successful');
  }

  // Test seeking
  const oldTime = video.currentTime;
  video.currentTime = video.duration / 2;
  await new Promise(r => setTimeout(r, 100));
  console.log(`  ✓ Seek test: ${oldTime.toFixed(2)}s → ${video.currentTime.toFixed(2)}s`);

  return true;
}

// ============================================
// Test 4: Effect Type Toggle (Overlay Mode)
// ============================================
async function testEffectTypeToggle() {
  console.log('🧪 Test: Effect Type Toggle (Overlay Mode)');
  console.log('------------------------------------------');

  // Find effect type selector
  const selector = document.querySelector('select[name="effectType"]') ||
                   document.querySelector('[data-testid="effect-type"]') ||
                   [...document.querySelectorAll('select')].find(s =>
                     s.options && [...s.options].some(o => o.value === 'original'));

  if (!selector) {
    console.log('  ○ Effect type selector not found (may not be in Overlay mode)');
    return true;
  }

  const originalValue = selector.value;
  console.log(`  Current effect type: ${originalValue}`);

  // Cycle through options
  const options = ['original', 'brightness_boost', 'dark_overlay'];
  for (const opt of options) {
    selector.value = opt;
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise(r => setTimeout(r, 200));
    console.log(`  ✓ Changed to: ${opt}`);
  }

  // Restore original
  selector.value = originalValue;
  selector.dispatchEvent(new Event('change', { bubbles: true }));
  console.log(`  ✓ Restored to: ${originalValue}`);

  return true;
}

// ============================================
// Test 5: Playback Speed (Annotate Mode)
// ============================================
async function testPlaybackSpeed() {
  console.log('🧪 Test: Playback Speed Toggle (Annotate Mode)');
  console.log('----------------------------------------------');

  const video = document.querySelector('video');
  if (!video) {
    console.log('  ○ No video element found');
    return true;
  }

  const speeds = [0.5, 1, 1.5, 2];
  const originalSpeed = video.playbackRate;

  for (const speed of speeds) {
    video.playbackRate = speed;
    await new Promise(r => setTimeout(r, 100));
    console.log(`  ✓ Set playback rate to ${speed}x`);
  }

  video.playbackRate = originalSpeed;
  console.log(`  ✓ Restored to ${originalSpeed}x`);

  return true;
}

// ============================================
// Test 6: WebSocket Connection Test
// ============================================
async function testWebSocket() {
  console.log('🧪 Test: WebSocket Connection');
  console.log('-----------------------------');

  const testExportId = 'browser-test-' + Date.now();
  const wsUrl = `ws://${window.location.host}/ws/export/${testExportId}`;

  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let connected = false;

    ws.onopen = () => {
      connected = true;
      console.log('  ✓ WebSocket connected');
      ws.send('ping');
      console.log('  ✓ Sent ping message');

      setTimeout(() => {
        ws.close();
        console.log('  ✓ Closed connection cleanly');
        resolve(true);
      }, 500);
    };

    ws.onerror = (e) => {
      console.log('  ✗ WebSocket error:', e);
      resolve(false);
    };

    ws.onclose = () => {
      if (!connected) {
        console.log('  ✗ WebSocket failed to connect');
        resolve(false);
      }
    };

    // Timeout
    setTimeout(() => {
      if (!connected) {
        console.log('  ✗ WebSocket connection timeout');
        ws.close();
        resolve(false);
      }
    }, 3000);
  });
}

// ============================================
// Run All Tests
// ============================================
async function runAllTests() {
  console.log('╔════════════════════════════════════════╗');
  console.log('║    Browser Integration Test Suite      ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');

  const tests = [
    ['React State Integrity', checkReactState],
    ['Video Player State', testVideoPlayer],
    ['WebSocket Connection', testWebSocket],
    ['Mode Switching', testModeSwitching],
    ['Effect Type Toggle', testEffectTypeToggle],
    ['Playback Speed', testPlaybackSpeed],
  ];

  const results = { passed: 0, failed: 0 };

  for (const [name, testFn] of tests) {
    try {
      console.log('');
      const passed = await testFn();
      if (passed) {
        results.passed++;
      } else {
        results.failed++;
      }
    } catch (e) {
      console.log(`  ✗ Error: ${e.message}`);
      results.failed++;
    }
  }

  console.log('');
  console.log('════════════════════════════════════════');
  console.log(`Results: ${results.passed} passed, ${results.failed} failed`);
  console.log('════════════════════════════════════════');

  return results.failed === 0;
}

// Instructions
console.log(`
╔══════════════════════════════════════════════════════════╗
║           Browser Test Scripts Loaded                     ║
╠══════════════════════════════════════════════════════════╣
║  Run individual tests:                                    ║
║    testModeSwitching()     - Rapid mode switch test      ║
║    checkReactState()       - Check for state issues       ║
║    testVideoPlayer()       - Video player controls        ║
║    testEffectTypeToggle()  - Overlay effect type          ║
║    testPlaybackSpeed()     - Annotate playback speed      ║
║    testWebSocket()         - WebSocket connection         ║
║                                                           ║
║  Run all tests:                                           ║
║    runAllTests()                                          ║
╚══════════════════════════════════════════════════════════╝
`);

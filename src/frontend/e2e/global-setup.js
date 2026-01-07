/**
 * Global setup for Playwright E2E tests
 *
 * Simple setup - just displays info.
 * No port checking needed since reuseExistingServer: true handles everything.
 */

import net from 'net';

/**
 * Check if a port is in use
 * @param {number} port
 * @returns {Promise<boolean>}
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        resolve(true);
      } else {
        resolve(false);
      }
    });

    server.once('listening', () => {
      server.close();
      resolve(false);
    });

    server.listen(port);
  });
}

export default async function globalSetup() {
  console.log('\n=== E2E Test Setup ===\n');

  // Check if dev servers are already running (informational)
  const backendRunning = await isPortInUse(8000);
  const frontendRunning = await isPortInUse(5173);

  if (backendRunning && frontendRunning) {
    console.log('✓ Using your running dev servers (fast!)');
    console.log('  Backend:  http://localhost:8000');
    console.log('  Frontend: http://localhost:5173\n');
  } else if (backendRunning || frontendRunning) {
    console.log('⚠ Partial dev servers detected:');
    console.log(`  Backend:  ${backendRunning ? 'running' : 'will start'}`);
    console.log(`  Frontend: ${frontendRunning ? 'running' : 'will start'}\n`);
  } else {
    console.log('ℹ No dev servers running - Playwright will start them');
    console.log('  Tip: Start dev servers first for faster test runs!\n');
  }
}

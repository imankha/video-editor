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

  // Always use dev ports - simpler configuration
  const backendPort = 8000;
  const frontendPort = 5173;
  const modeLabel = 'Dev ports (8000/5173)';

  // Check if servers are already running (informational)
  const backendRunning = await isPortInUse(backendPort);
  const frontendRunning = await isPortInUse(frontendPort);

  console.log(`Mode: ${modeLabel}\n`);

  if (backendRunning && frontendRunning) {
    console.log('✓ Using your running servers (fast!)');
    console.log(`  Backend:  http://localhost:${backendPort}`);
    console.log(`  Frontend: http://localhost:${frontendPort}\n`);
  } else if (backendRunning || frontendRunning) {
    console.log('⚠ Partial servers detected:');
    console.log(`  Backend:  ${backendRunning ? 'running' : 'will start'} (port ${backendPort})`);
    console.log(`  Frontend: ${frontendRunning ? 'running' : 'will start'} (port ${frontendPort})\n`);
  } else {
    console.log('ℹ No servers running - Playwright will start them');
    console.log(`  Backend:  port ${backendPort}`);
    console.log(`  Frontend: port ${frontendPort}`);
    console.log('  Tip: Start servers first for faster test runs!\n');
  }
}

/**
 * Global setup for Playwright E2E tests
 *
 * Runs before all tests to display test configuration info.
 * E2E tests use port 8001 so they don't conflict with the manual dev server (8000).
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

  // Check if E2E backend port (8001) is in use
  const e2ePortInUse = await isPortInUse(8001);

  if (e2ePortInUse) {
    console.error(`
╔════════════════════════════════════════════════════════════════════╗
║                      PORT 8001 IN USE                              ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  E2E tests need port 8001 for their isolated backend server.       ║
║  Something is already using this port.                             ║
║                                                                    ║
║  Check what's using port 8001:                                     ║
║    netstat -ano | findstr :8001  (Windows)                         ║
║    lsof -i :8001                 (Linux/Mac)                       ║
║                                                                    ║
║  Note: Your manual dev server on port 8000 is fine - E2E tests     ║
║  run on a separate port to avoid conflicts.                        ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
`);
    throw new Error('Port 8001 is already in use. E2E tests need this port for isolation.');
  }

  // Check E2E frontend port (5174)
  const e2eFrontendPortInUse = await isPortInUse(5174);
  if (e2eFrontendPortInUse) {
    console.error(`
╔════════════════════════════════════════════════════════════════════╗
║                      PORT 5174 IN USE                              ║
╠════════════════════════════════════════════════════════════════════╣
║                                                                    ║
║  E2E tests need port 5174 for their frontend dev server.           ║
║  Something is already using this port.                             ║
║                                                                    ║
╚════════════════════════════════════════════════════════════════════╝
`);
    throw new Error('Port 5174 is already in use. E2E tests need this port.');
  }

  // Check manual dev server status (informational)
  const devBackendRunning = await isPortInUse(8000);
  const devFrontendRunning = await isPortInUse(5173);

  console.log('✓ Port 8001 is available for E2E test backend');
  console.log('✓ Port 5174 is available for E2E test frontend');
  if (devBackendRunning) {
    console.log('ℹ Dev backend running on port 8000 (E2E tests use separate port)');
  }
  if (devFrontendRunning) {
    console.log('ℹ Dev frontend running on port 5173 (E2E tests use separate port)');
  }
  console.log('✓ E2E tests will use an isolated test database\n');
}

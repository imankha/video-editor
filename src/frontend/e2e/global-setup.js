/**
 * Global setup for Playwright E2E tests
 *
 * Simple setup - just displays info.
 * No port checking needed since reuseExistingServer: true handles everything.
 */

import net from 'net';
import { IS_DEPLOYED_TARGET, LOCAL_ONLY_SPECS, STAGING_GATE_SPECS } from './helpers/targetEnv.js';

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

  // T4934: when pointed at a deployed target (E2E_BASE_URL set) there are no local
  // ports to reuse. Print the target + the authoritative list of specs that SKIP on
  // a deployed target and WHY, so a staging run's skips are self-explaining (never a
  // silent skip). See e2e/helpers/targetEnv.js.
  if (IS_DEPLOYED_TARGET) {
    console.log('Mode: DEPLOYED TARGET (staging/remote) — servers NOT auto-started\n');
    console.log(`  Frontend (E2E_BASE_URL): ${process.env.E2E_BASE_URL}`);
    console.log(`  API      (E2E_API_BASE): ${process.env.E2E_API_BASE || '(unset — relative /api against the frontend host)'}\n`);
    console.log('Local-only specs SKIPPED on this target (dev/local-only seams or Vite-dev module imports):');
    for (const s of LOCAL_ONLY_SPECS) {
      console.log(`  • ${s.file}  [${s.category}]`);
      console.log(`      depends: ${s.depends.join(', ')}`);
      console.log(`      why:     ${s.reason}`);
    }
    console.log('\n  All other specs run against the deployed target. Any /api/test/* call that');
    console.log('  slips through fails FAST (assertSeamAvailable) instead of hanging to timeout.\n');

    // T5400: when running the curated pre-deploy gate (`npm run test:e2e:staging-gate`,
    // i.e. --grep @staging-gate), announce exactly what the gate covers. Printed on
    // every deployed-target run so a gate run is self-documenting; harmless otherwise.
    console.log('Curated @staging-gate subset (run: npm run test:e2e:staging-gate — THE pre-deploy gate):');
    for (const s of STAGING_GATE_SPECS) {
      console.log(`  • ${s.file}`);
      console.log(`      covers: ${s.covers}`);
    }
    console.log('\n  Data-dependent gate specs SKIP LOUDLY when the fixture lacks data (never a');
    console.log('  silent green pass). See e2e/STAGING-GATE.md for the run command + fixture.\n');
    return;
  }

  // Local dev: always use dev ports - simpler configuration
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

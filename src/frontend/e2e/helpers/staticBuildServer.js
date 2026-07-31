/**
 * staticBuildServer — the T6230 real-browser update-gate fixture.
 *
 * Two jobs, both driven entirely from JS inside the spec (no separate process, no
 * new npm deps), so the test has direct control over what the browser sees:
 *
 *   1. buildTwoBundles() — compile TWO genuinely-different production bundles (A, B)
 *      of the real app into a gitignored scratch dir. B differs from A by a
 *      deliberate marker asset (see below), so B's Workbox precache manifest — and
 *      therefore its `sw.js` bytes — differ from A's. That byte difference is what
 *      makes a browser holding the A ServiceWorker treat B as a NEW worker
 *      (`registration.update()` -> installing -> waiting), which is the whole
 *      mechanism T6230 must exercise for real.
 *
 *   2. createStaticBuildServer() — a `node:http` server that serves one origin out
 *      of a MUTABLE `currentDir` (point it at A or B mid-test) and answers the app's
 *      boot API calls from a MUTABLE `serverBuild`. `http://localhost:<port>` is a
 *      secure context, so ServiceWorkers register there (the Vite dev server does
 *      not build/serve a real SW at all — that is precisely why this test cannot use
 *      it; see e2e/STAGING-GATE.md § T6230).
 *
 * WHY A MARKER INSTEAD OF "just build twice":
 * The task's original assumption was that two successive `npm run build`s diverge on
 * their own (generate-version.js stamps a fresh buildTime into src/version.json, which
 * is bundled). VERIFIED FALSE in this repo: the only consumer, CropOverlay.jsx, reads
 * `versionInfo.environment` ONLY, so rollup tree-shakes `buildTime` out and two
 * same-commit builds are byte-identical -> identical `sw.js` (`diff A/sw.js B/sw.js`
 * exits 0). So buildTwoBundles injects a unique marker file into `public/` for build B
 * (Vite copies public files to the dist root; Workbox precaches it because it matches
 * the JS precache glob), which forces a distinct precache entry and thus a distinct
 * `sw.js`.
 * The marker is removed again in a `finally`, so the repo working tree is left clean.
 * buildTwoBundles returns `swDiffers` so the spec can assert the divergence held.
 */

import http from 'node:http';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// The build-B marker. A .js file so Workbox's JS precache glob picks it up (a
// non-globbed extension would NOT change sw.js). Lives in public/ only for the
// duration of build B, then is deleted.
const MARKER_BASENAME = '__t6230_sw_gate_marker__.js';
const MARKER_BODY =
  '// T6230 build-B marker: forces a distinct Workbox precache manifest so build B\n' +
  '// is seen as a new ServiceWorker by a browser holding build A. Test-only.\n' +
  'export const T6230_BUILD_MARKER = "BUILD_B";\n';

const MIME = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

/**
 * Compile build A (plain) and build B (plain + marker) into `outDir/A` and `outDir/B`.
 *
 * @param {object}  opts
 * @param {string}  opts.frontendDir  the src/frontend dir (has package.json + public/)
 * @param {string}  opts.outDir       gitignored scratch dir; wiped and recreated
 * @returns {{ dirA: string, dirB: string, swDiffers: boolean, markerUrl: string }}
 */
export function buildTwoBundles({ frontendDir, outDir }) {
  const dirA = path.join(outDir, 'A');
  const dirB = path.join(outDir, 'B');
  const markerPath = path.join(frontendDir, 'public', MARKER_BASENAME);
  const distDir = path.join(frontendDir, 'dist');

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const build = () =>
    execSync('npm run build', { cwd: frontendDir, stdio: 'pipe' });

  // Build A — plain.
  build();
  fs.cpSync(distDir, dirA, { recursive: true });

  // Build B — identical source + a unique marker asset, removed no matter what.
  try {
    fs.writeFileSync(markerPath, MARKER_BODY);
    build();
    fs.cpSync(distDir, dirB, { recursive: true });
  } finally {
    fs.rmSync(markerPath, { force: true });
  }

  const swA = fs.readFileSync(path.join(dirA, 'sw.js'), 'utf8');
  const swB = fs.readFileSync(path.join(dirB, 'sw.js'), 'utf8');

  return {
    dirA,
    dirB,
    swDiffers: swA !== swB,
    markerUrl: '/' + MARKER_BASENAME,
  };
}

/** Read a file, or null if it does not exist / is a directory. */
function readFileOrNull(filePath) {
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return null;
    return fs.readFileSync(filePath);
  } catch {
    return null;
  }
}

/**
 * A one-origin static server with a swappable build dir and a controllable fake
 * backend. Start it in the spec's beforeAll and drive it with setCurrentDir /
 * setServerBuild.
 *
 * @param {object} opts
 * @param {string} opts.currentDir   initial build dir to serve (A or B)
 * @param {number} opts.serverBuild  initial X-App-Build / /api/version build value
 * @returns {import('node:http').Server & {
 *   setCurrentDir: (dir: string) => void,
 *   setServerBuild: (n: number) => void,
 *   origin: () => string,
 *   listenAsync: () => Promise<string>,
 *   closeAsync: () => Promise<void>,
 * }}
 */
export function createStaticBuildServer({ currentDir, serverBuild }) {
  const state = { currentDir, serverBuild };

  const server = http.createServer((req, res) => {
    // Every response carries X-App-Build: the app's fetch interceptor
    // (sessionInit.js) reads it off ANY /api response and hands it to
    // appVersion.checkServerVersion. Stamped on static responses too — harmless,
    // and matches the task's "stamp every response" directive.
    res.setHeader('X-App-Build', String(state.serverBuild));

    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);

    // --- Fake backend -------------------------------------------------------
    if (pathname.startsWith('/api') || pathname.startsWith('/storage')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Type', 'application/json');
      if (pathname === '/api/version') {
        // pwaUpdate.checkBackendVersion() hits this on load; the header above is
        // what actually drives the gate, the body mirrors it for completeness.
        res.statusCode = 200;
        res.end(JSON.stringify({ build: state.serverBuild }));
        return;
      }
      if (pathname === '/api/auth/me') {
        // The intended logged-out path (sessionInit.js renders the empty shell).
        // The gate fires fine logged-out (updateGateStore.runUpdate handles it),
        // so no auth is built into this test.
        res.statusCode = 401;
        res.end(JSON.stringify({ detail: 'unauthenticated' }));
        return;
      }
      // Any other boot call (auth/init is never reached logged-out, plus analytics /
      // client-log posts): answer 200 {} so the app still boots without crashing.
      res.statusCode = 200;
      res.end('{}');
      return;
    }

    // --- Static files out of the (mutable) current build dir ----------------
    const safeRel = path.normalize(pathname).replace(/^(\.\.[/\\])+/, '');
    let filePath = path.join(state.currentDir, safeRel);
    if (!filePath.startsWith(state.currentDir)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }

    let data = readFileOrNull(filePath);
    let servedExt = path.extname(pathname).toLowerCase();

    if (data === null) {
      if (servedExt) {
        // A missing hashed asset is a real 404 (never masked by the SPA fallback).
        res.statusCode = 404;
        res.end('not found');
        return;
      }
      // SPA fallback: navigations resolve to index.html.
      data = readFileOrNull(path.join(state.currentDir, 'index.html'));
      servedExt = '.html';
      if (data === null) {
        res.statusCode = 404;
        res.end('no index.html');
        return;
      }
    }

    res.setHeader('Content-Type', MIME[servedExt] || 'application/octet-stream');
    // NEVER cache sw.js: a cached sw.js defeats registration.update() and the whole
    // waiting-worker mechanism this test exists to exercise.
    if (pathname === '/sw.js') {
      res.setHeader('Cache-Control', 'no-cache');
    }
    res.statusCode = 200;
    res.end(data);
  });

  server.setCurrentDir = (dir) => { state.currentDir = dir; };
  server.setServerBuild = (n) => { state.serverBuild = n; };
  server.origin = () => {
    const addr = server.address();
    // Bind result is an object with .port; use localhost (a secure context, so SWs
    // register) rather than the 127.0.0.1 the address may report.
    return `http://localhost:${addr.port}`;
  };
  server.listenAsync = () =>
    new Promise((resolve) => {
      // No host arg: bind the wildcard address so a client resolving `localhost` to
      // either 127.0.0.1 or ::1 connects. `localhost` (not 127.0.0.1) keeps the
      // origin a secure context, so ServiceWorkers register.
      server.listen(0, () => resolve(server.origin()));
    });
  server.closeAsync = () =>
    new Promise((resolve) => server.close(() => resolve()));

  return server;
}

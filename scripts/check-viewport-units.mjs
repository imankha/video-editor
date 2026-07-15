#!/usr/bin/env node
/**
 * check-viewport-units.mjs — the h-screen / 100vh lint gate (T4930).
 *
 * WHY: T4880 was a total mobile blocker (Framing/Overlay controls unreachable)
 * rooted in the app shell using `h-screen` (height:100vh) instead of `h-dvh`
 * (100dvh). On iOS Safari 100vh spills BEHIND the dynamic browser toolbar, so the
 * bottom of the layout — where the primary controls live — is off-screen. That
 * failure mode is INVISIBLE to Playwright device emulation (the emulator has no
 * dynamic toolbar), so it cannot be caught by tests alone; it has to be blocked
 * at the source. T4880 converted the shell to `h-dvh`; this gate keeps the app
 * tree from regrowing fixed-viewport heights.
 *
 * WHAT IT BANS (in src/frontend/src, files .js/.jsx/.css):
 *   - the Tailwind class `h-screen`  (NOT `min-h-screen`/`max-h-screen`: a
 *     minimum/maximum does not clip content off an unscrollable fold)
 *   - the raw unit `100vh`           (className arbitrary values, inline styles, CSS)
 * Use `h-dvh` / `100dvh` instead.
 *
 * EXEMPTIONS (explicit, never silent — CLAUDE.md "no silent fallbacks"):
 *   1. NATIVE-FULLSCREEN CSS — `100vh` inside a `:fullscreen` / `:-webkit-full-screen`
 *      rule. In the browser's native fullscreen there is no dynamic toolbar, so
 *      100vh == 100dvh; converting would be meaningless. Detected structurally.
 *   2. KNOWN DEBT — a short, LOUD catalogue (KNOWN_DEBT below) of pre-existing
 *      occurrences that predate this gate, each tagged with the follow-up task
 *      that will convert it. They are printed as warnings on every run so they
 *      cannot hide, and the gate ratchets: remove one from the source and you
 *      MUST remove it here (a stale entry fails the gate).
 *   3. Any line carrying an inline `viewport-unit-ok:<reason>` marker.
 *
 * USAGE:
 *   node scripts/check-viewport-units.mjs                 # scan the whole app tree (CI)
 *   node scripts/check-viewport-units.mjs <file> [<file>] # scan only these files (edit-time hook)
 * Exit 0 = clean (known debt may be present, printed as warnings). Exit 1 = a NEW
 * violation, or a stale KNOWN_DEBT entry.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.join(REPO_ROOT, 'src', 'frontend', 'src');
const OK_MARKER = 'viewport-unit-ok';

// h-screen as a standalone class token: preceded by start / whitespace / quote /
// backtick / `:` (variant sep) — but NOT by `-` (excludes min-h-screen, max-h-screen).
const H_SCREEN = /(?<![\w-])h-screen\b/;
const VH_100 = /100vh/;

/**
 * KNOWN DEBT: occurrences that predate the gate. Each is a pre-existing
 * fixed-viewport height behind a fullscreen/opt-in state; converting them to dvh
 * is tracked by the listed task. Keyed by repo-relative path + the exact needle
 * so it is NOT line-number brittle. Remove an entry the moment its source is
 * converted — a KNOWN_DEBT entry whose source no longer contains the needle FAILS
 * the gate (prevents the catalogue from rotting).
 */
const KNOWN_DEBT = [
  {
    file: 'src/frontend/src/components/RecapPlayerModal.jsx',
    needle: 'w-screen h-screen',
    task: 'T4931',
    note: 'fullscreen recap player takeover — convert h-screen -> h-dvh',
  },
  {
    file: 'src/frontend/src/modes/AnnotateModeView.jsx',
    needle: "mobilePlaybackFs ? '100vh' : 'calc(100vh - 120px)'",
    task: 'T4932',
    note: 'mobile Annotate playback maxHeight — convert 100vh -> 100dvh',
  },
];

/** Collapse the `:fullscreen` / `:-webkit-full-screen` rule bodies to spaces so a
 *  `100vh` inside native fullscreen is structurally exempt (offsets preserved so
 *  line numbers stay correct for everything else). */
function maskFullscreenCss(css) {
  return css.replace(/([^{}]+)\{([^{}]*)\}/g, (whole, selector, body) => {
    if (/full-?screen/i.test(selector)) return selector + '{' + ' '.repeat(body.length) + '}';
    return whole;
  });
}

function debtNeedleFor(relPath, lineText) {
  return KNOWN_DEBT.find((d) => d.file === relPath && lineText.includes(d.needle));
}

function scanFile(absPath, relPath, sink) {
  let text;
  try {
    text = fs.readFileSync(absPath, 'utf8');
  } catch {
    return;
  }
  const isCss = absPath.endsWith('.css');
  const scanText = isCss ? maskFullscreenCss(text) : text;
  const rawLines = text.split(/\r?\n/);
  const scanLines = scanText.split(/\r?\n/);
  scanLines.forEach((scanLine, i) => {
    const rawLine = rawLines[i] ?? '';
    if (rawLine.includes(OK_MARKER)) return; // explicit inline exemption
    const hits = [];
    if (H_SCREEN.test(scanLine)) hits.push('h-screen');
    if (VH_100.test(scanLine)) hits.push('100vh');
    if (!hits.length) return;
    const debt = debtNeedleFor(relPath, rawLine);
    if (debt) {
      sink.debtSeen.add(debt);
      sink.warnings.push(`  [known debt ${debt.task}] ${relPath}:${i + 1}  (${debt.note})`);
      return;
    }
    sink.violations.push(`  ${relPath}:${i + 1}  ${hits.join(' + ')}  ->  ${rawLine.trim().slice(0, 100)}`);
  });
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(js|jsx|css)$/.test(entry.name)) out.push(full);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let files;
  if (argv.length) {
    files = argv.map((f) => path.resolve(f)).filter((f) => /\.(js|jsx|css)$/.test(f) && f.startsWith(APP_ROOT) && fs.existsSync(f));
  } else {
    files = [];
    walk(APP_ROOT, files);
  }

  const sink = { violations: [], warnings: [], debtSeen: new Set() };
  for (const abs of files) {
    scanFile(abs, path.relative(REPO_ROOT, abs).replace(/\\/g, '/'), sink);
  }

  if (sink.warnings.length) {
    console.error('viewport-unit gate — KNOWN DEBT (tracked, not yet converted):');
    console.error(sink.warnings.join('\n'));
  }

  // A KNOWN_DEBT entry whose source no longer has the needle is stale — fail so
  // the catalogue is pruned in the same change that converts the source. Only
  // enforce on a full-tree scan (a targeted per-file run legitimately sees a subset).
  let stale = [];
  if (!argv.length) {
    stale = KNOWN_DEBT.filter((d) => !sink.debtSeen.has(d));
  }

  if (sink.violations.length) {
    console.error(`\nviewport-unit gate FAILED: ${sink.violations.length} banned h-screen/100vh occurrence(s).`);
    console.error('Use h-dvh / 100dvh (T4880). If genuinely unavoidable, add an inline `viewport-unit-ok:<reason>` marker.\n');
    console.error(sink.violations.join('\n'));
  }
  if (stale.length) {
    console.error(`\nviewport-unit gate FAILED: ${stale.length} stale KNOWN_DEBT entr(y/ies) — the source was converted; remove them from KNOWN_DEBT:`);
    console.error(stale.map((d) => `  ${d.task}  ${d.file}  "${d.needle}"`).join('\n'));
  }

  if (sink.violations.length || stale.length) process.exit(1);
  console.log(`viewport-unit gate OK (${files.length} file(s) scanned; ${sink.debtSeen.size} known-debt site(s) tracked).`);
}

main();

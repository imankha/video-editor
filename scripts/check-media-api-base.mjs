#!/usr/bin/env node
/**
 * check-media-api-base.mjs — the "no bare /api/ media URL" gate (T5890).
 *
 * WHY: T5890 was invisible-on-staging poster loss. `GameTile` built its poster
 * `<img src>` as a BARE relative path (`/api/games/{id}/poster.jpg`). Locally the
 * Vite dev proxy forwards `/api/*` to the backend, so it worked and passed review.
 * But on staging/prod the frontend (Cloudflare Pages) and the API (Fly) are
 * DIFFERENT HOSTS, so a bare `/api/...` src resolves against the Pages origin, hits
 * the SPA catch-all (`_redirects: /* /index.html 200`), and returns `200 text/html`
 * — the app shell, not an image. The `<img>` decode fails, `onError` fires, and the
 * branded fallback renders, so the UI looks "fine" while every poster is broken.
 * The class of bug is emulator/local-proxy-invisible; it has to be blocked at the
 * source. The fix is to prefix the configured `API_BASE` (empty in dev, the backend
 * origin in staging/prod) — see src/frontend/src/config.js.
 *
 * WHAT IT BANS (in src/frontend/src, files .js/.jsx):
 *   A BARE relative media URL string literal — a `'...'` / `"..."` / template literal
 *   whose FIRST characters are `/api/` (i.e. NOT `${API_BASE}/api/...`) AND whose path
 *   looks like media (an image/video/audio extension, or a media endpoint tail such as
 *   `/poster`, `poster.<ext>`, `/file`, `/video`, `/stream`, `/thumbnail`, `/frame`,
 *   `/download`). Non-media bare `/api/` fetches are out of scope for THIS gate.
 *   Use `${API_BASE}/api/...` (as GameTile/DraftTile/DownloadsPanel do) instead.
 *
 * Comments are stripped before scanning, so JSDoc examples that mention `/api/...`
 * media paths (config.js, useStorageUrl.js, annotateVideoLoad.js, ...) are exempt.
 *
 * EXEMPTION: any line carrying an inline `media-api-base-ok:<reason>` marker
 * (explicit, never silent — CLAUDE.md "no silent fallbacks").
 *
 * USAGE:
 *   node scripts/check-media-api-base.mjs                 # scan the whole app tree (CI)
 *   node scripts/check-media-api-base.mjs <file> [<file>] # scan only these files (edit-time hook)
 * Exit 0 = clean. Exit 1 = a bare `/api/` media URL literal.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const APP_ROOT = path.join(REPO_ROOT, 'src', 'frontend', 'src');
const OK_MARKER = 'media-api-base-ok';

// A string/template literal whose body STARTS with `/api/`. `${API_BASE}/api/...`
// does not match (the char after the opening backtick is `$`, not `/`). The body
// excludes quote/backtick chars, so `${...}` interpolations are captured fine.
const BARE_API_LITERAL = /(['"`])(\/api\/[^'"`\n]*?)\1/g;

// The literal's path resolves to media: a media file extension, or a known media
// endpoint segment. The segment set is prefixed by `/` OR `-` so hyphenated
// endpoints (e.g. `/api/projects/{id}/working-video`) are covered, not just
// slash-delimited ones. Deliberately narrow — non-media bare /api/ fetches
// (auth, sync, ranking, ...) are not this gate's concern.
const MEDIA_TOKEN =
  /(\.(jpe?g|png|webp|avif|gif|svg|mp4|webm|mov|m4v|m3u8|mp3|wav|ogg)(\?|$|\/)|[/-](poster|video|image|audio|file|stream|thumbnail|thumb|frame|download)\b|poster\.)/i;

/** Remove block (/* *​/) and line (//) comments so JSDoc examples that reference
 *  `/api/...poster.jpg` do not trip the gate. Line comments are stripped only when
 *  the `//` is not part of `://` (so `http://` inside code survives). */
function stripComments(text) {
  const noBlock = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
  return noBlock
    .split(/\r?\n/)
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');
}

/** Scan one file's text; returns [{ line, snippet, token }]. Exported for tests. */
export function scanText(text) {
  const rawLines = text.split(/\r?\n/);
  const scanLines = stripComments(text).split(/\r?\n/);
  const hits = [];
  scanLines.forEach((scanLine, i) => {
    const rawLine = rawLines[i] ?? '';
    if (rawLine.includes(OK_MARKER)) return; // explicit inline exemption
    for (const m of scanLine.matchAll(BARE_API_LITERAL)) {
      const body = m[2];
      const media = body.match(MEDIA_TOKEN);
      if (media) hits.push({ line: i + 1, snippet: rawLine.trim().slice(0, 120), token: media[0] });
    }
  });
  return hits;
}

// Test files construct BARE `/api/...` strings as mock backend responses and
// expected values — they never become a real browser media src, so they are not
// this gate's concern (the gate protects shipped, browser-facing code).
const isTestFile = (name) => /\.(test|spec)\.(js|jsx)$/.test(name);
const isProdSource = (name) => /\.(js|jsx)$/.test(name) && !isTestFile(name);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isProdSource(entry.name)) out.push(full);
  }
}

function main() {
  const argv = process.argv.slice(2);
  let files;
  if (argv.length) {
    files = argv
      .map((f) => path.resolve(f))
      .filter((f) => isProdSource(path.basename(f)) && !f.includes(`${path.sep}__tests__${path.sep}`) && f.startsWith(APP_ROOT) && fs.existsSync(f));
  } else {
    files = [];
    walk(APP_ROOT, files);
  }

  const violations = [];
  for (const abs of files) {
    let text;
    try {
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(REPO_ROOT, abs).replace(/\\/g, '/');
    for (const h of scanText(text)) {
      violations.push(`  ${rel}:${h.line}  [${h.token}]  ->  ${h.snippet}`);
    }
  }

  if (violations.length) {
    console.error(`\nmedia-api-base gate FAILED: ${violations.length} bare /api/ media URL literal(s).`);
    console.error('A bare `/api/...` media src/href resolves against the Cloudflare Pages origin on');
    console.error('split-host staging/prod and returns the SPA shell, not the file (T5890). Prefix the');
    console.error('configured API_BASE: `${API_BASE}/api/...` (src/frontend/src/config.js). If this is');
    console.error('genuinely not a browser-facing media URL, add an inline `media-api-base-ok:<reason>` marker.\n');
    console.error(violations.join('\n'));
    process.exit(1);
  }
  console.log(`media-api-base gate OK (${files.length} file(s) scanned).`);
}

// Only run when invoked directly (so tests can import scanText without side effects).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

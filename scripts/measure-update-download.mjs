#!/usr/bin/env node
/**
 * T9370 — measure how much of the app a service-worker UPDATE re-downloads.
 *
 * The PWA precaches every asset in `sw.js`'s Workbox manifest. When a new build
 * ships, the SW re-downloads only the manifest entries whose URL is new or whose
 * `revision` changed. This tool diffs two built `dist/` trees and reports that
 * delta — the bytes a user on the OLD build must fetch to reach the NEW one.
 *
 * It is a pure analyzer of two build OUTPUTS: it never mutates source. To measure
 * a real deploy, build two commits into two dirs and point this at them:
 *
 *   git stash && (cd src/frontend && npm run build) && cp -r src/frontend/dist /tmp/distA
 *   git stash pop && (cd src/frontend && npm run build) && cp -r src/frontend/dist /tmp/distB
 *   node scripts/measure-update-download.mjs /tmp/distA /tmp/distB
 *
 * This is the "diff a production build before and after" check T9370 requires, and
 * the repeatable form of the staging verification ("verify against a genuine second
 * build") its task file asks for. Exit code is always 0 — it reports, never gates.
 */
import fs from 'node:fs';
import path from 'node:path';

/** Parse a Workbox precache manifest out of a built sw.js into { url: revision }. */
function readManifest(distDir) {
  const sw = fs.readFileSync(path.join(distDir, 'sw.js'), 'utf8');
  const re = /\{url:"([^"]+)",revision:(?:"([^"]*)"|null)\}/g;
  const map = {};
  let m;
  while ((m = re.exec(sw))) map[m[1]] = m[2] ?? null;
  if (Object.keys(map).length === 0) {
    throw new Error(`No precache entries found in ${distDir}/sw.js — is this a PWA build?`);
  }
  return map;
}

function fileSize(distDir, url) {
  try {
    return fs.statSync(path.join(distDir, url.replace(/^\//, ''))).size;
  } catch {
    return 0;
  }
}

function kb(bytes) {
  return (bytes / 1024).toFixed(1) + ' KB';
}

function main() {
  const [dirA, dirB] = process.argv.slice(2);
  if (!dirA || !dirB) {
    console.error('usage: node scripts/measure-update-download.mjs <old-dist> <new-dist>');
    process.exit(2);
  }

  const A = readManifest(dirA);
  const B = readManifest(dirB);
  const bUrls = Object.keys(B);

  let totalB = 0;
  let changedBytes = 0;
  const changed = [];
  for (const url of bUrls) {
    const size = fileSize(dirB, url);
    totalB += size;
    if (!(url in A)) {
      changed.push(['ADDED', url, size]);
      changedBytes += size;
    } else if (A[url] !== B[url]) {
      changed.push(['REVCHG', url, size]);
      changedBytes += size;
    }
  }
  changed.sort((x, y) => y[2] - x[2]);

  const pct = totalB ? ((changedBytes / totalB) * 100).toFixed(1) : '0.0';
  console.log(`old build: ${dirA}`);
  console.log(`new build: ${dirB}`);
  console.log(`\nTotal precache (new): ${(totalB / 1024 / 1024).toFixed(2)} MB across ${bUrls.length} entries`);
  console.log(`Re-downloaded on update: ${kb(changedBytes)} (${pct}% of the app)\n`);
  if (changed.length === 0) {
    console.log('No precache entries changed — an update fetches nothing new.');
    return;
  }
  console.log('Changed precache entries (largest first):');
  for (const [kind, url, size] of changed) {
    console.log(`  ${kind.padEnd(7)} ${kb(size).padStart(10)}  ${url}`);
  }
}

main();

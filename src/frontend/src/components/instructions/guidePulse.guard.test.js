import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

// T12770 (C7, AC3): the pulse class and the removed per-screen pulse props can only come back
// through GuideScope. Reads raw source, so a hand-wired pulse fails here before it ships.
const SRC = join(process.cwd(), 'src'); // vitest runs from src/frontend

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const isTest = (p) => /\.(test|spec)\.[jt]sx?$/.test(p) || p.includes(`${sep}__tests__${sep}`);
const files = walk(SRC).filter((p) => /\.(jsx?|css)$/.test(p) && !isTest(p));
const rel = (p) => relative(SRC, p).split(sep).join('/');

describe('guide pulse guard (T12770)', () => {
  it('the class name coach-target-pulse lives only in guideTargets.js and index.css', () => {
    const hits = files.filter((p) => readFileSync(p, 'utf8').includes('coach-target-pulse')).map(rel).sort();
    expect(hits).toEqual(['components/instructions/guideTargets.js', 'index.css']);
  });

  it('the removed per-screen pulse props are absent from non-test source', () => {
    const removed = /\b(pulsePlay|pulsePreview|pulseGenerate|pulseUpload|pulsePortrait|guidePulse|homePulse|pickPulse)\b/;
    const hits = files.filter((p) => /\.jsx?$/.test(p) && removed.test(readFileSync(p, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });

  it('the second trim pulse mechanism is gone', () => {
    const hits = files.filter((p) => /data-trim-guide|trim-guide-pulse/.test(readFileSync(p, 'utf8'))).map(rel);
    expect(hits).toEqual([]);
  });

  it('reduced motion keeps a static ring on every pulse target', () => {
    const css = readFileSync(join(SRC, 'index.css'), 'utf8');
    const block = css.match(/@media \(prefers-reduced-motion: reduce\) \{\s*\.coach-target-pulse \{([^}]*)\}/);
    expect(block, 'reduced-motion rule for .coach-target-pulse').not.toBeNull();
    expect(block[1]).toMatch(/animation:\s*none/);
    expect(block[1]).toMatch(/outline:\s*2px solid/);
  });
});

// T12110: shipped-copy hygiene. User-visible strings carry no em dash, no ' -- ' dash
// and no "Saved" (persistence is silent). displayNames values are walked directly;
// the component files are scanned line by line with comments stripped.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as displayNames from './displayNames';

const BAD = [
  { name: 'em dash', re: /—/ },
  { name: "' -- '", re: / -- / },
  { name: "'Saved' / 'saved online'", re: /\bSaved\b|saved online/ },
];

function collectStrings(value, trail, out) {
  if (typeof value === 'string') out.push([trail, value]);
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) collectStrings(v, `${trail}.${k}`, out);
  }
}

describe('T12110 shipped copy hygiene', () => {
  it('displayNames values contain no em dash, " -- " or Saved', () => {
    const strings = [];
    for (const [name, value] of Object.entries(displayNames)) collectStrings(value, name, strings);
    const offenders = [];
    for (const [trail, s] of strings) {
      for (const { name, re } of BAD) if (re.test(s)) offenders.push(`${trail}: ${name}: ${s}`);
    }
    expect(offenders).toEqual([]);
  });

  it.each([
    'components/shared/NoSportTagWarning.jsx',
    'components/ProfileSportButton.jsx',
    'modes/annotate/components/LayerSegmentedControl.jsx',
  ])('%s has no em dash or " -- " in code lines', (rel) => {
    const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8');
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
      .filter((l) => !/^\s*\*/.test(l));
    const offenders = [];
    code.forEach((l, i) => {
      for (const { name, re } of BAD.slice(0, 2)) if (re.test(l)) offenders.push(`${rel}:${i + 1}: ${name}`);
    });
    expect(offenders).toEqual([]);
  });
});

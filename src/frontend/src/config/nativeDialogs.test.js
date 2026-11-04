// T14570: native alert()/confirm() are unstyled and show the site URL as the title on
// phones. Scans shipped sources (comments stripped; admin tools excluded, they are not
// parent-facing) so a new one fails here.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const SRC = path.resolve(__dirname, '..');
const NATIVE_DIALOG = /(^|[^\w.])(window\.)?(alert|confirm|prompt)\(/;

function shippedFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'admin') continue;
      shippedFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const codeLines = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''));

describe('T14570 no native dialogs in shipped code', () => {
  it('T14570:C1 no shipped source calls alert, confirm or prompt', () => {
    const offenders = [];
    for (const file of shippedFiles(SRC)) {
      codeLines(fs.readFileSync(file, 'utf8')).forEach((line) => {
        if (NATIVE_DIALOG.test(line)) offenders.push(`${path.relative(SRC, file)}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

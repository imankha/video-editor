// T14540: the UI updates on change events, so no shipped copy tells the user to refresh
// or reload. Scans string literals and JSX text (comments and console calls stripped;
// admin tools excluded). An in-app action may still reload, but it is not labelled so.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { surfaceConflictPrompt } from '../utils/actionConflictPrompt';
import { useToastStore } from '../components/shared/Toast';

const SRC = path.resolve(__dirname, '..');
const WORD = String.raw`(?<![-_])\b([Rr]efresh|[Rr]eload)(ing)?\b(?![-_[])`;
const IN_LITERAL = new RegExp(String.raw`(['"\x60])(?:(?!\1).)*${WORD}(?:(?!\1).)*\1`);
const JSX_TEXT = new RegExp(String.raw`^\s*[A-Z][^=(){}]*${WORD}`);

function shippedFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'admin' || /^t\d+diag$/.test(entry.name)) continue;
      shippedFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)
      && entry.name !== 'AdminScreen.jsx' && entry.name !== 'adminStore.js') {
      out.push(full);
    }
  }
  return out;
}

const codeLines = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/console\.\w+\([\s\S]*?\);/g, '')
  .split('\n')
  .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
  .filter((l) => !/^\s*\*/.test(l) && !/\breason: /.test(l));

describe('T14540 no refresh instructions in shipped copy', () => {
  it('T14540:C5 no shipped string tells the user to refresh or reload', () => {
    const offenders = [];
    for (const file of shippedFiles(SRC)) {
      codeLines(fs.readFileSync(file, 'utf8')).forEach((line) => {
        if (IN_LITERAL.test(line) || JSX_TEXT.test(line)) offenders.push(`${path.relative(SRC, file)}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it('T14540:C6 the conflict prompt keeps its one-tap action under a plain label', () => {
    useToastStore.setState({ toasts: [] });
    surfaceConflictPrompt([], 1);
    const [t] = useToastStore.getState().toasts;
    expect(t.action.label).toBe('Load latest');
    expect(t.message).not.toMatch(/refresh|reload/i);
    expect(t.duration).toBe(0);
  });

  it('T14540:C7 expired video errors keep the word isUrlExpiredError matches, so Retry still shows', () => {
    const src = fs.readFileSync(path.join(SRC, 'hooks/useVideo.js'), 'utf8');
    expect(src).toContain("error.includes('expired')");
    expect(src).toContain("setError('Your session expired. Sign in again to keep going.')");
    expect(src).toContain("userMessage = 'This video expired. Go back and open it again.'");
  });
});

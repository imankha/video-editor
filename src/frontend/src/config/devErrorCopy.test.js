// T14530: developer text must not reach parents. Scans shipped sources (comments and
// console.* lines stripped; admin tools excluded) for the exact phrases the copy audit
// found, and pins the mode-switch dialog copy.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as displayNames from './displayNames';

const SRC = path.resolve(__dirname, '..');

const BANNED = [
  /Export complete!/,
  /port 8000/,
  /Check (backend )?console/,
  /Check console for/,
  /Backend server/,
  /backend server/,
  /backend not responding/,
  /Highlight state manager/,
  /crop keyframe/,
  /Failed to delete keyframe/,
  /detrim changes/,
  /Uncommitted (Spotlight|\$\{)/,
  /GPU processing/,
  /cloud GPU/,
  /Computing (file )?hash/,
  /Hash complete/,
  /Hashing video/,
  /Game linked/,
  /Monitoring generation via server/,
  /does not support the video tag/,
  /Failed to read file: \$\{/,
  /`(Failed to [a-z ]+|Verification failed|Checkout failed|Share failed) \(\$\{/,
  /The server rejected the report/,
  /(Copy|Delete) keyframe/,
  /save to the cloud|reach the cloud/,
  /(toast\.(error|warning)\(|setError\(|setErrorMessage\(|alert\()\s*[`'"](Failed to|Could not|Cannot|Couldn't)/,
];

function shippedFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'admin') continue;
      shippedFiles(full, out);
    } else if (/\.jsx?$/.test(entry.name) && !/\.test\.|\.spec\./.test(entry.name)
      // The privacy policy is a legal document; its wording changes on its own review.
      && entry.name !== 'AdminScreen.jsx' && entry.name !== 'PrivacyPolicy.jsx' && !/[/\\]stores[/\\]adminStore/.test(full)) {
      out.push(full);
    }
  }
  return out;
}

const codeLines = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => l.replace(/^\s*\/\/.*$/, '').replace(/\s\/\/\s.*$/, ''))
  .filter((l) => !/^\s*\*/.test(l) && !/console\.(log|warn|error|info|debug)\(/.test(l));

describe('T14530 developer text stays out of shipped copy', () => {
  it('T14530:C1 no shipped source carries a banned developer phrase', () => {
    const offenders = [];
    for (const file of shippedFiles(SRC)) {
      codeLines(fs.readFileSync(file, 'utf8')).forEach((line) => {
        for (const re of BANNED) {
          if (re.test(line)) offenders.push(`${path.relative(SRC, file)}: ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('T14530:C1 the mode-switch dialog speaks plainly', () => {
    const copy = displayNames.MODE_SWITCH_DIALOG;
    expect(copy?.TITLE).toBe('Unsaved changes');
    expect(copy?.SPOTLIGHT_BODY).toBe("You changed your spotlight but haven't added it to the highlight yet.");
    expect([copy?.DISCARD, copy?.SHARPEN, copy?.ADD_SPOTLIGHT, copy?.KEEP_EDITING])
      .toEqual(['Discard changes', 'Sharpen my highlight', 'Add spotlight to highlight', 'Keep editing']);
  });

  it('T14530:C1 App.jsx offers all three choices from the dialog copy', () => {
    const app = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
    expect(app).toContain('MODE_SWITCH_DIALOG.DISCARD');
    expect(app).toContain('MODE_SWITCH_DIALOG.SHARPEN');
    expect(app).toContain('MODE_SWITCH_DIALOG.ADD_SPOTLIGHT');
    expect(app).toContain('MODE_SWITCH_DIALOG.KEEP_EDITING');
  });
});

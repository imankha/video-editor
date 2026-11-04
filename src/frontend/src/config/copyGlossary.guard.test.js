// T14670: copy drifts back when nothing fails on a retired word. This guard walks every string
// exported by displayNames.js and emptyStates.js, plus the text a person reads in the app's JSX:
// text nodes and title / aria-label / placeholder values. Identifiers, classNames and comparison
// strings are never read, so `clipId` or `mode === 'draft'` stay legal.
//
// A legitimate use goes in copyGlossary.allowlist.json with a reason. Vocabulary source:
// .claude/references/copy-glossary.md
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { Linter } from 'eslint';
import * as displayNames from './displayNames';
import * as emptyStates from './emptyStates';
import allowlist from './copyGlossary.allowlist.json';

const SRC = path.resolve(__dirname, '..');
const GLOSSARY = '.claude/references/copy-glossary.md';
const SCANNED_DIRS = ['components', 'modes', 'screens', 'containers'];
const SCANNED_ATTRIBUTES = new Set(['title', 'aria-label', 'placeholder']);

const BANNED = [
  { word: 'clip', re: /\bclips?\b/i },
  { word: 'draft', re: /\bdrafts?\b/i },
  { word: 'annotation', re: /\bannotations?\b/i },
  { word: 'footage', re: /\bfootage\b/i },
  { word: 'moment', re: /\bmoments?\b/i },
  { word: 'Usage history', re: /\busage history\b/i },
  // Capitalized only: "Focus" names the retired mode, lowercase "focus" is ordinary English.
  { word: 'Focus', re: /\bFocus\b/ },
  { word: 'keyframe', re: /\bkeyframes?\b/i },
  { word: 'segment', re: /\bsegments?\b/i },
  { word: 'Click', re: /(^|[.!?:]\s+)click\b/i },
  { word: 'backend', re: /\bbackend\b/i },
  { word: 'GPU', re: /\bgpu\b/i },
  { word: 'status code', re: /\([45]\d\d\)/ },
  { word: 'em dash', re: /—/ },
  { word: '--', re: /(^|\s)--(\s|$)/ },
  { word: '->', re: /->/ },
];

const bannedWordsIn = (text) => BANNED.filter(({ re }) => re.test(text)).map(({ word }) => word);

// Function values are called with every shape the copy helpers take, so both the singular and
// plural branch of a count helper are read.
const SAMPLE_ARGS = [
  [],
  [1],
  [2],
  ['Sample'],
  [1, 2],
  [2, 3],
  ['Sample', 2],
  [2, 'Sample'],
  ['Sample', 'Sample'],
];

function walkExport(value, trail, out, unsampled, seen = new Set()) {
  if (typeof value === 'string') {
    out.push({ source: trail, text: value });
  } else if (typeof value === 'function') {
    let sampled = false;
    for (const args of SAMPLE_ARGS) {
      try {
        walkExport(value(...args), `${trail}()`, out, unsampled, seen);
        sampled = true;
      } catch {
        // A helper that needs a different shape throws here; another sample may fit it.
      }
    }
    if (!sampled) unsampled.push(trail);
  } else if (value && typeof value === 'object' && !seen.has(value)) {
    seen.add(value);
    for (const [key, child] of Object.entries(value)) {
      walkExport(child, `${trail}.${key}`, out, unsampled, seen);
    }
  }
}

function exportedCopy() {
  const strings = [];
  const unsampled = [];
  for (const [file, moduleExports] of [['displayNames', displayNames], ['emptyStates', emptyStates]]) {
    for (const [name, value] of Object.entries(moduleExports)) {
      walkExport(value, `${file}:${name}`, strings, unsampled);
    }
  }
  return { strings, unsampled };
}

function stringsIn(expression) {
  if (!expression) return [];
  if (expression.type === 'Literal') return typeof expression.value === 'string' ? [expression.value] : [];
  if (expression.type === 'TemplateLiteral') return expression.quasis.map((quasi) => quasi.value.cooked);
  if (expression.type === 'ConditionalExpression') {
    return [...stringsIn(expression.consequent), ...stringsIn(expression.alternate)];
  }
  if (expression.type === 'LogicalExpression') {
    return expression.operator === '&&'
      ? stringsIn(expression.right)
      : [...stringsIn(expression.left), ...stringsIn(expression.right)];
  }
  return [];
}

const linter = new Linter({ configType: 'flat' });

// A <style> element holds CSS such as @keyframes, which nobody reads.
const isStyleElement = (node) => node.type === 'JSXElement' && node.openingElement.name.name === 'style';

function visibleText(source, file = 'inline.jsx') {
  const found = [];
  const add = (text) => {
    const normalized = text.replace(/\s+/g, ' ').trim();
    if (normalized) found.push(normalized);
  };
  const collector = {
    create: () => ({
      JSXText(node) {
        if (!isStyleElement(node.parent)) add(node.value);
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        const isChild = (parent.type === 'JSXElement' && !isStyleElement(parent)) || parent.type === 'JSXFragment';
        const isCopyAttribute = parent.type === 'JSXAttribute' && SCANNED_ATTRIBUTES.has(parent.name.name);
        if (isChild || isCopyAttribute) stringsIn(node.expression).forEach(add);
      },
      JSXAttribute(node) {
        if (SCANNED_ATTRIBUTES.has(node.name.name) && node.value?.type === 'Literal') add(node.value.value);
      },
    }),
  };
  const messages = linter.verify(source, {
    files: ['**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: 'off' },
    plugins: { copy: { rules: { collect: collector } } },
    rules: { 'copy/collect': 'error' },
  }, { filename: file });
  const fatal = messages.find((message) => message.fatal);
  if (fatal) throw new Error(`${file}: could not parse: ${fatal.message}`);
  return found;
}

function jsxFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return /admin/i.test(entry.name) ? [] : jsxFiles(full);
    if (!entry.name.endsWith('.jsx') || /\.(test|spec)\.jsx$/.test(entry.name)) return [];
    return /admin/i.test(entry.name) ? [] : [full];
  });
}

function jsxCopy() {
  return SCANNED_DIRS.flatMap((dir) => jsxFiles(path.join(SRC, dir))).flatMap((full) => {
    const source = path.relative(SRC, full).split(path.sep).join('/');
    return visibleText(fs.readFileSync(full, 'utf8'), source).map((text) => ({ source, text }));
  });
}

const allowKey = ({ source, word, text }) => JSON.stringify([source, word, text]);

function findViolations(entries, allowed) {
  const hits = entries.flatMap(({ source, text }) => bannedWordsIn(text).map((word) => ({ source, word, text })));
  const allowedKeys = new Set(allowed.map(allowKey));
  const hitKeys = new Set(hits.map(allowKey));
  return {
    violations: hits.filter((hit) => !allowedKeys.has(allowKey(hit))),
    stale: allowed.filter((entry) => !hitKeys.has(allowKey(entry))),
  };
}

const describeViolation = ({ source, word, text }) => `${source}: "${word}" in: ${text}`;

describe('T14670 retired copy guard', () => {
  const exported = exportedCopy();
  const jsx = jsxCopy();
  const { violations, stale } = findViolations([...exported.strings, ...jsx], allowlist);

  it('finds no retired word or banned punctuation in shipped copy', () => {
    const report = [...new Set(violations.map(describeViolation))].join('\n');
    expect(
      violations.length,
      `Retired copy shipped. Use the word in ${GLOSSARY}, or add an entry with a reason to ` +
        `src/frontend/src/config/copyGlossary.allowlist.json:\n${report}`,
    ).toBe(0);
  });

  it('every allowlist entry carries a reason and still matches live copy', () => {
    const missingReason = allowlist.filter((entry) => !entry.reason?.trim());
    expect(missingReason, 'allowlist entries need a reason').toEqual([]);
    expect(stale, 'allowlist entries that match no live copy should be removed').toEqual([]);
  });

  it('can call every exported copy helper', () => {
    expect(exported.unsampled, 'add a SAMPLE_ARGS shape these helpers accept').toEqual([]);
  });

  it('actually reads the copy it claims to guard', () => {
    expect(exported.strings.length).toBeGreaterThan(1000);
    expect(new Set(jsx.map(({ source }) => source)).size).toBeGreaterThan(100);
    expect(jsx.length).toBeGreaterThan(500);
  });
});

describe('T14670 guard detection', () => {
  const flagged = (source) => visibleText(source).flatMap(bannedWordsIn);

  it.each([
    ['text node', '<p>Open this clip</p>', 'clip'],
    ['retired noun', '<p>Pick the moments you want</p>', 'moment'],
    ['retired phrase', '<button>Usage history</button>', 'Usage history'],
    ['multi-line text node', '<p>Pick a\n  draft</p>', 'draft'],
    ['title', '<a title="Delete keyframe" />', 'keyframe'],
    ['aria-label', '<a aria-label="Split segment" />', 'segment'],
    ['placeholder', '<input placeholder="Add footage" />', 'footage'],
    ['attribute expression', "<a title={'Your annotations'} />", 'annotation'],
    ['conditional child', "<p>{ready ? 'Play' : 'Open clips'}</p>", 'clip'],
    ['logical child', "<p>{ready && 'Back to Focus'}</p>", 'Focus'],
    ['template child', '<p>{`${n} clips`}</p>', 'clip'],
    ['instruction opening', '<p>Click the box</p>', 'Click'],
    ['later sentence', '<p>Pick a play. Click the box.</p>', 'Click'],
    ['status code', '<p>Try again (503)</p>', 'status code'],
    ['backend', '<p>The backend is down</p>', 'backend'],
    ['GPU', '<p>Waiting for a GPU</p>', 'GPU'],
    ['em dash', '<p>One — two</p>', 'em dash'],
    ['em dash entity', '<p>One &mdash; two</p>', 'em dash'],
    ['double dash', '<p>One -- two</p>', '--'],
    ['arrow', "<p>{'One -> two'}</p>", '->'],
  ])('flags a retired word in a %s', (_name, jsx, word) => {
    expect(flagged(jsx)).toContain(word);
  });

  it.each([
    ['identifier', '<Clip clipId={draft.segment} onClick={focus} />'],
    ['className', '<p className="clip draft keyframe">Play</p>'],
    ['comparison', "<p>{mode === 'draft' ? 'One' : 'Two'}</p>"],
    ['word inside a word', '<p>Copied to clipboard. Stay focused. Clicking works.</p>'],
    ['lowercase focus', '<p>Keep your focus on the ball</p>'],
    ['style element', '<style>{`@keyframes fade { to { opacity: 1; } }`}</style>'],
    ['comment', '<p>{/* the clip -- draft */}Play</p>'],
  ])('leaves a %s alone', (_name, jsx) => {
    expect(flagged(jsx)).toEqual([]);
  });

  it('names the file, the banned word and the string', () => {
    const { violations } = findViolations([{ source: 'components/Tile.jsx', text: 'Open clip' }], []);
    expect(violations.map(describeViolation)).toEqual(['components/Tile.jsx: "clip" in: Open clip']);
  });

  it('honors an allowlist entry only for its own file, word and string', () => {
    const entry = { source: 'components/Tile.jsx', word: 'clip', text: 'Open clip', reason: 'test' };
    const same = [{ source: 'components/Tile.jsx', text: 'Open clip' }];
    const otherFile = [{ source: 'components/Other.jsx', text: 'Open clip' }];
    expect(findViolations(same, [entry]).violations).toEqual([]);
    expect(findViolations(otherFile, [entry]).violations).toHaveLength(1);
    expect(findViolations(otherFile, [entry]).stale).toEqual([entry]);
  });
});

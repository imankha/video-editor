import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveGuide, GUIDE_STATES, GUIDE_RULES } from './resolveGuide';
import { GUIDE } from '../../config/displayNames';

const BANNED = /—|tracker|frame \d+ of|keyframe|automatically (frames|tracks|follows)/i;

function collectCopy(node, out = []) {
  if (typeof node === 'string') out.push(node);
  else if (node && typeof node === 'object') Object.values(node).forEach((v) => collectCopy(v, out));
  return out;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(jsx?|css)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe('resolveGuide state enumeration', () => {
  it('every enumerated state resolves to exactly its expected rule (or documented null)', () => {
    expect(GUIDE_STATES.length).toBeGreaterThan(10);
    for (const state of GUIDE_STATES) {
      const guide = resolveGuide(state.facts);
      if (state.expectId === null) {
        expect(guide, state.name).toBeNull();
      } else {
        expect(guide?.id, state.name).toBe(state.expectId);
        expect(guide.message.title, state.name).toBeTruthy();
      }
    }
  });

  it('no rule is shadowed: every rule id is the first match for at least one state', () => {
    const hit = new Set(GUIDE_STATES.map((s) => resolveGuide(s.facts)?.id).filter(Boolean));
    for (const rule of GUIDE_RULES) expect(hit.has(rule.id), `${rule.id} shadowed`).toBe(true);
  });

  it('a play below 5 stars no longer falls through to the watch message (T12260)', () => {
    const g = resolveGuide({ screen: 'annotate', progress: { selectedPlay: { rating: 3 } }, local: {} });
    expect(g.id).toBe('annotate.selected.none');
  });

  it('Focus copy says box and athlete (Q15 = C)', () => {
    expect(GUIDE.focus.drag).toMatch(/box/);
    expect(GUIDE.focus.drag).toMatch(/athlete/);
    expect(GUIDE.focus.keep).toMatch(/athlete/);
    expect(collectCopy(GUIDE.focus).join(' ')).not.toMatch(/your player/);
  });
});

describe('guide copy and selectors', () => {
  it('banned copy never appears in the GUIDE table', () => {
    for (const s of collectCopy(GUIDE)) expect(s).not.toMatch(BANNED);
  });

  it('every anchor/avoid selector literal exists in src', () => {
    const files = walk(join(__dirname, '..', '..'));
    const src = files.map((f) => readFileSync(f, 'utf8')).join('\n');
    const ids = new Set();
    for (const state of GUIDE_STATES) {
      const g = resolveGuide(state.facts);
      if (!g) continue;
      for (const sel of [g.anchor?.target, g.anchor?.fallback, ...(g.avoid || [])].filter(Boolean)) {
        const m = sel.match(/data-testid="([^"]+)"/);
        expect(m, `selector ${sel} must be a data-testid selector`).toBeTruthy();
        ids.add(m[1]);
      }
    }
    for (const id of ids) {
      expect(src.includes(`"${id}"`) || src.includes(`'${id}'`) || src.includes(`\`${id}`), `data-testid ${id} not found in src`).toBe(true);
    }
  }, 60000);
});

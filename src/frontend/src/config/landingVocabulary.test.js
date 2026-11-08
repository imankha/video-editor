/**
 * T14650: the landing site speaks the same vocabulary as the app
 * (.claude/references/copy-glossary.md).
 *
 * Reads the landing sources directly, because the landing site has no test runner of its own.
 * Comments and Tailwind classes are removed first: only shipped words count, never identifiers.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODE_NAMES, ANNOTATE, LIBRARY_ACTIONS } from './displayNames';
import { DEFINITION, FACTS, HERO_SUBLINE, HIGHLIGHT_REEL_LINE, INPUT_SOURCES, STEP_NAMES } from '../../../landing/src/site.ts';
import { SPORTS } from '../../../landing/src/data/sports.ts';
import { CAMERAS } from '../../../landing/src/data/cameras.ts';
import { COMPARISONS } from '../../../landing/src/data/comparisons.ts';
import { USE_CASES } from '../../../landing/src/data/useCases.ts';

const LANDING_SRC = join(dirname(fileURLToPath(import.meta.url)), '../../../landing/src');

// Real quotes stay verbatim; the rest are behavior-only modules with no shipped words.
const NOT_COPY = new Set([
  'data/testimonials.ts',
  'components/BeforeAfterSlider.tsx',
  'components/TutorialModal.tsx',
  'components/TutorialLauncher.tsx',
  'config/tutorials.ts', // unmounted since T12780; its 'annotate' is a video file name
]);

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

function shippedText(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
    .replace(/\bclass(Name)?="[^"]*"/g, '')
    .replace(/\bclass:list=\{\[[\s\S]*?\]\}/g, '')
    // The user owns the tagline wording (T14560); a real person's search words stay searchable.
    .replace(/export const (TAGLINE|HERO_HEADLINE_LEAD) = .*$/gm, '')
    .replace(/targetQuery: .*$/gm, '');
}

const FILES = walk(LANDING_SRC)
  .filter((path) => /\.(astro|ts|tsx|mdx)$/.test(path))
  .map((path) => ({ rel: relative(LANDING_SRC, path).replaceAll('\\', '/'), path }))
  .filter(({ rel }) => !NOT_COPY.has(rel))
  .map(({ rel, path }) => ({ rel, text: shippedText(readFileSync(path, 'utf8')) }));

const read = (rel) => FILES.find((file) => file.rel === rel).text;
const isCameraPage = (rel) => rel === 'data/cameras.ts' || rel.startsWith('pages/works-with/');

const RETIRED = [
  ['dash punctuation', /\s--\s|—/],
  ['clip', /\bclips?\b/i],
  ['draft', /\bdrafts?\b/i],
  ['annotate', /\bannotat(e|es|ed|ing|ion|ions)\b/i],
  ['moments for a play', /\bmoments\b|\bmoment worth\b/i],
  ['game film and friends', /game film|game file|match video|match footage|full[- ]match/i],
  ['footage off camera pages', /\bfootage\b/i, (rel) => !isCameraPage(rel)],
  ['reel for one video', /(?<!highlight[ -])\breels?\b(?!-building)/i],
  ['player for the athlete', /\b(your|my|own|chosen|specific|their) player\b|\bthe player each\b/i],
  ['kid or child', /\bkids?\b|\bchild(ren)?\b/i],
  ['aspect ratio', /aspect ratio/i],
  ['keyframe', /keyfram/i],
  ['codec talk', /transcod|\bcodecs?\b|re-encod/i],
  ['box jargon', /AI-proposed|motion interpolation|crop box|drag the crop|upscaler/i],
  ['spotlight marker', /spotlight marker|highlight graphics/i],
  ['Generate as our verb', /\bgenerat(e|es|ed|ing|ion)\b/i],
  ['Render as our verb', /\brender(s|ing)\b/i],
  ['old step names', /\b(Educate|Elevate|Celebrate)\b|Frame (&amp;|and) highlight|video\(s\)/],
  ['stale step count', /\b(three|four)[- ]steps?\b/i],
  ['British words', /\bcentre|\bcentred|organised|stabilisation|standardise|stylised|\bmaths\b|touchline|\bsofa\b|\bkit\b|pitch-side|the pitch\b|floodlight/i],
  ['Title Case badges', /Most Popular|Best Value/],
];

describe('T14650 retired landing words', () => {
  it.each(RETIRED)('%s', (name, pattern, applies = () => true) => {
    const hits = FILES.filter(({ rel }) => applies(rel)).flatMap(({ rel, text }) =>
      text.split('\n').flatMap((line) => {
        // URLs are addresses, not copy (T7410: the API host is reel-ballers-api.fly.dev).
        const match = line.replace(/https?:\/\/[^\s'"`)]+/g, '').match(pattern);
        return match ? [`${rel}: "${match[0]}" in ${line.trim().slice(0, 110)}`] : [];
      }),
    );
    expect(hits).toEqual([]);
  });

  it('scans the pages it claims to scan', () => {
    const scanned = FILES.map((file) => file.rel);
    expect(scanned).toEqual(expect.arrayContaining([
      'pages/index.astro', 'pages/how-it-works.astro', 'pages/[sport].astro',
      'pages/llms.txt.ts', 'components/Cta.astro', 'data/useCases.ts', 'site.ts',
      'content/guides/filming-youth-sports-from-the-sideline.mdx',
    ]));
  });
});

describe('T14650 one step sequence', () => {
  it('names the five steps with the labels the app shows', () => {
    expect(STEP_NAMES).toEqual({
      upload: LIBRARY_ACTIONS.UPLOAD_GAME,
      mark: 'Mark plays',
      frame: MODE_NAMES.FRAMING,
      spotlight: MODE_NAMES.SPOTLIGHT,
      share: 'Share',
    });
    expect(ANNOTATE.MODE_DESCRIPTION).toContain(STEP_NAMES.mark);
  });

  it.each([
    'pages/index.astro',
    'pages/how-it-works.astro',
    'pages/[sport].astro',
    'pages/works-with/[camera].astro',
    'pages/llms.txt.ts',
  ])('%s walks all five in order', (rel) => {
    const text = read(rel);
    const order = ['upload', 'mark', 'frame', 'spotlight', 'share'].map((key) =>
      text.indexOf(`STEP_NAMES.${key}`),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it('counts five wherever it counts', () => {
    expect(read('pages/index.astro')).toMatch(/Five steps/);
    expect(read('pages/how-it-works.astro')).toMatch(/Five steps/);
    expect(read('pages/llms.txt.ts')).toMatch(/five-step/);
  });
});

describe('T14650 highlight reel means several highlights (D5)', () => {
  const body = (values) => values.filter((value) => /highlight reel/i.test(value));

  it('keeps the search phrase in titles and FAQ questions', () => {
    expect(read('pages/index.astro')).toContain('Turn Game Video Into Highlight Reels');
    expect(read('pages/index.astro')).toContain('How do I make a highlight reel from a game video?');
    expect(CAMERAS.every((camera) => /Highlight Reel/.test(camera.title))).toBe(true);
  });

  it('explains combining highlights where a new visitor reads', () => {
    expect(HIGHLIGHT_REEL_LINE).toMatch(/^Combine your highlights into a highlight reel/);
    for (const rel of ['pages/index.astro', 'pages/how-it-works.astro', 'pages/llms.txt.ts']) {
      expect(read(rel)).toContain('HIGHLIGHT_REEL_LINE');
    }
  });

  it('body copy on single-video pages says highlight', () => {
    expect(body([DEFINITION])).toEqual([]);
    expect(body(SPORTS.flatMap((s) => [s.description, s.answer, s.challenge, s.scouting, s.framingWhy, s.recruitingWhy]))).toEqual([]);
    expect(body(CAMERAS.flatMap((c) => [c.description, c.answer, c.reality, ...c.tips]))).toEqual([]);
    expect(body(COMPARISONS.flatMap((c) => [
      c.description, c.answer, c.fairSummary, ...c.chooseThem, ...c.chooseUs,
      ...c.rows.flatMap((row) => [row.them, row.us]), ...c.faqs.map((faq) => faq.a),
    ]))).toEqual([]);
    expect(body(USE_CASES.filter((u) => u.slug !== 'recruiting-videos').flatMap((u) => [
      u.description, u.answer, u.ctaHeading, ...u.sections.flatMap((s) => s.body), ...u.faqs.map((faq) => faq.a),
    ]))).toEqual([]);
  });

  it('body answers inside the page files say highlight too', () => {
    const lines = ['pages/index.astro', 'pages/how-it-works.astro', 'pages/[sport].astro', 'pages/about.astro', 'components/Cta.astro']
      .flatMap((rel) => read(rel).split('\n'))
      .filter((line) => /^\s*(a|text|body|heading|description)\b.*highlight reel/i.test(line))
      .filter((line) => !/combine/i.test(line));
    expect(lines).toEqual([]);
  });
});

describe('T14780 landing uses the current step name, not "frame"', () => {
  it('index.astro no longer calls the zoom step "frame"', () => {
    const text = read('pages/index.astro');
    expect(text).not.toMatch(/\bframe your athlete\b/i);
    expect(text).not.toMatch(/\bin frame\b/i);
    expect(text).not.toContain('afterLabel="Framed"');
  });

  it('shared hero/definition copy uses the current step name', () => {
    expect(HERO_SUBLINE).not.toMatch(/\bframe your athlete\b/i);
    expect(DEFINITION).not.toMatch(/\bframe your athlete\b/i);
  });

  it('the before/after illustration label matches STEP_NAMES.frame, not the old word', () => {
    expect(read('components/Illustrations.tsx')).not.toMatch(/>FRAME</);
  });
});

describe('T14650 keeps the facts and the URLs', () => {
  it('leaves every public slug alone', () => {
    expect(SPORTS.map((s) => s.slug)).toEqual([
      'soccer', 'basketball', 'football', 'flag-football', 'baseball', 'softball',
      'volleyball', 'lacrosse', 'hockey', 'rugby', 'tennis',
    ]);
    expect(CAMERAS.map((c) => c.slug)).toEqual([
      'trace', 'veo', 'iphone', 'gopro', 'xbotgo', 'dji-osmo-action', 'action-camera',
    ]);
    expect(COMPARISONS.map((c) => c.slug)).toEqual(['editing-by-hand', 'capcut']);
    expect(USE_CASES.map((u) => u.slug)).toEqual([
      'recruiting-videos', 'for-parents', 'for-coaches', 'for-clubs',
    ]);
  });

  it('still says a shared link needs no app or account, without a dash', () => {
    expect(FACTS.viewerRequirement).toMatch(/web browser/);
    expect(FACTS.viewerRequirement).toMatch(/no account/);
    expect(FACTS.viewerRequirement).not.toContain('--');
  });

  it('still lists the team camera systems as exports, never integrations', () => {
    expect(INPUT_SOURCES[0]).toMatch(/exported from team camera systems \(Veo, Trace, Hudl\)/);
  });
});

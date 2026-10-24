// T13350 -- hero Spotlight / set 1b copy (reads built landing HTML).
// Usage: node qa/test_T13350_hero_spotlight.mjs   (after `npm run build` in src/landing)
import { readFileSync } from 'node:fs'
const html = readFileSync('src/landing/dist/index.html', 'utf8')
const head = html.match(/<head[\s\S]*?<\/head>/)?.[0] ?? ''
const header = html.match(/<header[\s\S]*?<\/header>/)?.[0] ?? ''
const hero = html.match(/<section[\s\S]*?<\/section>/)?.[0] ?? ''
const text = hero.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
const h1 = hero.match(/<h1[\s\S]*?<\/h1>/)?.[0] ?? ''
const start = hero.search(/>\s*Start free\s*</)
const ghost = hero.search(/>\s*See how it works\s*</)
const checks = [
  ['H1 copy', /Game film in\./.test(h1) && /<span[^>]*text-amber-300[^>]*>Sharp<\/span>\s*highlight out\./.test(h1)],
  ['H1 display font classes', /font-display/.test(h1) && /font-extrabold/.test(h1)],
  ['subline', text.includes('Any video source. You frame your athlete; AI focus smooths, spotlights and upscales.')],
  ['trust line slate-400', /text-slate-400[^>]*>\s*Free to start\. No subscription\. Pay only for the AI you use\./.test(hero)],
  ['no slider caption', !text.includes('Same play, same phone')],
  ['no pricing paragraph', !text.includes('buy credits when you need them')],
  ['old tagline gone from hero', !h1.includes('AI upscaling')],
  ['pills Your footage / In focus', />\s*Your footage\s*</.test(hero) && />\s*In focus\s*</.test(hero) && !/>\s*Before\s*</.test(hero)],
  ['primary CTA first in DOM, amber', start > 0 && ghost > start && /bg-amber-400/.test(hero.slice(0, start).split('<a').pop())],
  ['header button amber', /bg-amber-400/.test(header) && !/from-purple-600/.test(header)],
  ['font link in head', /fonts\.googleapis\.com\/css2\?family=Plus\+Jakarta\+Sans:wght@800&(amp;)?display=swap/.test(head) && /rel="preconnect" href="https:\/\/fonts\.gstatic\.com"/.test(head)],
  ['title unchanged', /<title>Turn Game Footage Into Highlight Reels \| ReelBallers<\/title>/.test(head)],
  ['meta description unchanged', head.includes('Transform game film into high-quality highlights in minutes using AI upscaling. Any camera')],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (!ok) bad++ }
if (bad) { console.error(`AssertionError: ${bad} hero check(s) failed`); process.exit(1) }

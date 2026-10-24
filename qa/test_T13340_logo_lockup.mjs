// T13340:C1 -- header logo is a one-row horizontal lockup (reads built landing HTML).
// Usage: node qa/test_T13340_logo_lockup.mjs   (after `npm run build` in src/landing)
import { readFileSync } from 'node:fs'
const html = readFileSync('src/landing/dist/index.html', 'utf8')
const header = html.match(/<header[\s\S]*?<\/header>/)?.[0]
if (!header) throw new Error('no <header> in built index.html')
const link = header.match(/<a[^>]*aria-label="ReelBallers home"[\s\S]*?<\/a>/)?.[0] ?? ''
const checks = [
  ['no stacked column markup', !/flex-col/.test(link) && !/w-\[80px\]/.test(link)],
  ['single-line wordmark "ReelBallers"', />ReelBallers<\/span>/.test(link) && /whitespace-nowrap/.test(link)],
  ['40px emblem', /<svg[^>]*width="40"/.test(link)],
]
let bad = 0
for (const [name, ok] of checks) { console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`); if (!ok) bad++ }
if (bad) { console.error(`AssertionError: ${bad} lockup check(s) failed`); process.exit(1) }

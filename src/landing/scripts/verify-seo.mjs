/**
 * Post-build SEO verification. Walks dist/, checks every HTML page for the
 * non-negotiables, and validates the JSON-LD graph shape.
 */
import fs from 'node:fs'
import path from 'node:path'

const DIST = process.argv[2] || 'dist'
const errors = []
const warnings = []
const pages = []

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (entry.name.endsWith('.html')) pages.push(p)
  }
}
walk(DIST)

const titles = new Map()
const descs = new Map()

const text = (h) =>
  h
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

for (const file of pages) {
  const rel = '/' + path.relative(DIST, file).replace(/\\/g, '/').replace(/\.html$/, '')
  const h = fs.readFileSync(file, 'utf8')
  const get = (re) => (h.match(re) || [])[1]

  const title = get(/<title>([\s\S]*?)<\/title>/)
  const desc = get(/<meta name="description" content="([^"]*)"/)
  const canonical = get(/<link rel="canonical" href="([^"]+)"/)
  const ogTitle = get(/<meta property="og:title" content="([^"]*)"/)
  const ogImage = get(/<meta property="og:image" content="([^"]*)"/)
  const twCard = get(/<meta name="twitter:card" content="([^"]*)"/)
  const h1s = h.match(/<h1[\s>]/g) || []
  const isNoindex = /name="robots" content="noindex/.test(h)
  const words = text(h).split(' ').filter(Boolean).length

  if (!title) errors.push(`${rel}: missing <title>`)
  else if (title.length > 60) warnings.push(`${rel}: title ${title.length} chars`)
  if (!desc) errors.push(`${rel}: missing description`)
  else if (desc.length > 155) errors.push(`${rel}: description ${desc.length} chars`)
  if (!canonical) errors.push(`${rel}: missing canonical`)
  if (!ogTitle) errors.push(`${rel}: missing og:title`)
  if (!ogImage) errors.push(`${rel}: missing og:image`)
  if (!twCard) errors.push(`${rel}: missing twitter:card`)
  if (h1s.length !== 1) errors.push(`${rel}: ${h1s.length} <h1> (need exactly 1)`)
  if (!/<main[\s>]/.test(h)) errors.push(`${rel}: no <main>`)
  if (!/<nav[\s>]/.test(h)) errors.push(`${rel}: no <nav>`)
  if (words < 250 && !isNoindex) warnings.push(`${rel}: thin content (${words} words)`)

  if (!isNoindex) {
    if (title) titles.set(title, [...(titles.get(title) || []), rel])
    if (desc) descs.set(desc, [...(descs.get(desc) || []), rel])
  }

  // JSON-LD
  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
  if (blocks.length === 0) errors.push(`${rel}: no JSON-LD`)
  for (const [, raw] of blocks) {
    let data
    try {
      data = JSON.parse(raw)
    } catch (e) {
      errors.push(`${rel}: JSON-LD parse error: ${e.message}`)
      continue
    }
    if (!data['@context']) errors.push(`${rel}: JSON-LD missing @context`)
    const nodes = data['@graph'] || [data]
    for (const node of nodes) {
      if (!node['@type']) errors.push(`${rel}: JSON-LD node missing @type`)
      if (node['@type'] === 'FAQPage') {
        const qs = node.mainEntity || []
        if (!qs.length) errors.push(`${rel}: FAQPage with no questions`)
        for (const q of qs) {
          if (!q.name) errors.push(`${rel}: FAQ question missing name`)
          if (!q.acceptedAnswer?.text) errors.push(`${rel}: FAQ "${q.name}" missing answer text`)
          // The visible page must contain the answer, or the markup is invalid.
          const plain = text(h)
          const probe = (q.acceptedAnswer?.text || '').slice(0, 40).replace(/\s+/g, ' ')
          if (probe && !plain.includes(probe)) {
            errors.push(`${rel}: FAQ answer not visible on page: "${q.name}"`)
          }
        }
      }
      if (node['@type'] === 'HowTo' && !(node.step || []).length) {
        errors.push(`${rel}: HowTo with no steps`)
      }
      if (node['@type'] === 'BreadcrumbList') {
        for (const li of node.itemListElement || []) {
          if (!li.item || !li.name) errors.push(`${rel}: breadcrumb item incomplete`)
        }
      }
      for (const banned of ['aggregateRating', 'review', 'Review']) {
        if (node[banned]) errors.push(`${rel}: contains ${banned} -- we have no verifiable ratings`)
      }
    }
  }
}

for (const [t, ps] of titles) if (ps.length > 1) errors.push(`Duplicate title on ${ps.join(', ')}: "${t}"`)
for (const [d, ps] of descs) if (ps.length > 1) errors.push(`Duplicate description on ${ps.join(', ')}`)

console.log(`Checked ${pages.length} pages.`)
if (warnings.length) {
  console.log(`\nWARNINGS (${warnings.length}):`)
  warnings.forEach((w) => console.log('  ! ' + w))
}
if (errors.length) {
  console.log(`\nERRORS (${errors.length}):`)
  errors.forEach((e) => console.log('  X ' + e))
  process.exit(1)
}
console.log('\nAll SEO invariants pass.')

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

// Third-party ownership-verification files (e.g. Google Search Console's
// google<hex>.html) are served at the site root but are not content pages --
// they must stay byte-for-byte what the verifier issued, so they never carry
// SEO markup and must not be walked as one.
const NON_PAGE_FILE = /^google[0-9a-f]+\.html$/

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(p)
    else if (entry.name.endsWith('.html') && !NON_PAGE_FILE.test(entry.name)) pages.push(p)
  }
}
walk(DIST)

const titles = new Map()
const descs = new Map()
// rel path -> isNoindex, and rel path -> raw HTML, for the cross-page checks
// (sitemap vs. noindex, nav links vs. noindex) run after the main loop.
const noindexByPath = new Map()
const htmlByPath = new Map()

// The sitemap and every internal href are absolute-path-rooted ('/soccer'),
// but a rel path is derived from the file on disk ('/soccer' from
// soccer.html, '/index' from index.html). Normalise the one case where those
// disagree -- the homepage -- so the cross-page checks compare like with like.
const toUrlPath = (rel) => (rel === '/index' ? '/' : rel)

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

  noindexByPath.set(toUrlPath(rel), isNoindex)
  htmlByPath.set(toUrlPath(rel), h)

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

// Invariant: no URL in the sitemap may serve noindex. A sitemap entry is an
// active "please index this" signal to Google; a noindex page saying that is
// a straight self-contradiction (this is exactly how /guides went noindex
// while still being linked from the nav pre-T6370 -- catch the sitemap half
// of that class of bug here, and the nav-link half below).
const sitemapPath = path.join(DIST, 'sitemap-0.xml')
if (fs.existsSync(sitemapPath)) {
  const xml = fs.readFileSync(sitemapPath, 'utf8')
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  for (const loc of locs) {
    const urlPath = new URL(loc).pathname
    if (noindexByPath.get(urlPath) === true) {
      errors.push(`sitemap: ${urlPath} is listed in sitemap-0.xml but serves noindex`)
    }
  }
} else {
  warnings.push('no sitemap-0.xml found -- skipped the sitemap/noindex cross-check')
}

// Invariant: no internal <nav> link may point at a noindex page. The nav is
// the crawl graph -- every page links to it, so a noindex target keeps
// getting (re)discovered and crawled for no reason (the exact waste T6370
// found with /guides). External links (the app CTA) and anchors are ignored.
const NAV_BLOCK_RE = /<nav[^>]*>([\s\S]*?)<\/nav>/gi
const HREF_RE = /<a\s[^>]*href="([^"]+)"/gi
for (const [rel, h] of htmlByPath) {
  for (const [, navBlock] of h.matchAll(NAV_BLOCK_RE)) {
    for (const [, href] of navBlock.matchAll(HREF_RE)) {
      if (!href.startsWith('/')) continue // external (app CTA) or protocol-relative
      const targetPath = href.split('#')[0].split('?')[0].replace(/\/$/, '') || '/'
      if (noindexByPath.get(targetPath) === true) {
        errors.push(`${rel}: <nav> links to noindex page ${targetPath}`)
      }
    }
  }
}

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

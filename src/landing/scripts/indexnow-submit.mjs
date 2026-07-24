/**
 * IndexNow submission -- runs in the deploy workflow AFTER `wrangler deploy`,
 * so the pages are already live when we ping.
 *
 * IndexNow notifies participating search engines (Bing, Yandex, and others that
 * share the protocol) the instant our URLs change, instead of waiting for them
 * to re-crawl on their own schedule. Google does NOT participate -- Google is
 * covered by Search Console + the sitemap.
 *
 * The URL list is read from the built sitemap, so it always matches exactly the
 * pages we consider indexable (noindex pages like an empty /guides are already
 * excluded from the sitemap). Submitting the full set every deploy is fine and
 * well within IndexNow's quota.
 *
 * KEY: must match the filename+content of public/<KEY>.txt, which is what
 * IndexNow fetches to prove we own the key. If you rotate the key, change it in
 * BOTH places.
 *
 * This step must never fail the deploy -- the deploy already succeeded before we
 * get here. Any error is logged and swallowed.
 */
import fs from 'node:fs'

const KEY = '8bd3e9e92808827bf0fa0e10875af105'
const HOST = 'reelballers.com'
const SITEMAP = 'dist/sitemap-0.xml'

try {
  const xml = fs.readFileSync(SITEMAP, 'utf8')
  const urlList = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])
  if (urlList.length === 0) {
    console.log('[indexnow] no URLs in sitemap; nothing to submit')
    process.exit(0)
  }

  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({
      host: HOST,
      key: KEY,
      keyLocation: `https://${HOST}/${KEY}.txt`,
      urlList,
    }),
  })
  // 200 = accepted, 202 = accepted/pending validation. Both are success.
  const text = await res.text().catch(() => '')
  console.log(`[indexnow] submitted ${urlList.length} URLs -> HTTP ${res.status} ${text}`.trim())
} catch (err) {
  console.log(`[indexnow] submission skipped (non-fatal): ${err?.message || err}`)
}

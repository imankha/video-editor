/**
 * First-touch attribution relay (T15000).
 *
 * Policy: FIRST touch wins, matching the app's `captureCampaignParams`
 * (sessionStorage.campaignParams, written once per tab). The landing side
 * had no equivalent: the old relay (T3455, T7910) only read the CURRENT
 * page's query string + referrer, so params were lost after one internal
 * click. This module writes a per-tab record on the first page a visitor
 * sees and merges it into every `a[data-cta]` href on every later page,
 * never overwriting the record once it exists.
 *
 * Only whitelisted keys are stored — the old relay copied the whole query
 * string, which leaked arbitrary params onto the app URL.
 */

export const ATTRIBUTION_WHITELIST = [
  'ref',
  'sport',
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_content',
  'utm_term',
  'fbclid',
  'gclid',
  'gbraid',
  'wbraid',
  'ttclid',
  'sclid',
  'ScCid',
  'epik',
  'rdt_cid',
] as const

export const STORAGE_KEY = 'rbFirstTouch'

export interface FirstTouchRecord {
  params: Record<string, string>
  lref: string
  lp: string
  landed_at: string
}

export interface Storage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

function bareHost(hostname: string): string {
  return hostname.replace(/^www\./i, '')
}

/** External referrer hostname, or '' if same-site/absent/malformed. Hostname only, never the full URL. */
export function computeLref(referrer: string, hostname: string): string {
  if (!referrer) return ''
  try {
    const refHost = new URL(referrer).hostname
    if (refHost && bareHost(refHost) !== bareHost(hostname)) {
      return refHost
    }
  } catch {
    // malformed referrer — no external source to report
  }
  return ''
}

/**
 * Returns the tab's first-touch record, creating it from the current page
 * if none exists yet. Returns null when storage is unavailable (private
 * mode, etc.) so callers leave links untouched.
 */
export function readFirstTouch(
  search: string,
  referrer: string,
  hostname: string,
  pathname: string,
  store: Storage,
): FirstTouchRecord | null {
  let existingRaw: string | null = null
  try {
    existingRaw = store.getItem(STORAGE_KEY)
  } catch {
    return null
  }

  if (existingRaw) {
    try {
      return JSON.parse(existingRaw) as FirstTouchRecord
    } catch {
      // corrupt entry — fall through and recreate below
    }
  }

  const incoming = new URLSearchParams(search)
  const params: Record<string, string> = {}
  for (const key of ATTRIBUTION_WHITELIST) {
    const value = incoming.get(key)
    if (value) params[key] = value
  }

  const record: FirstTouchRecord = {
    params,
    lref: computeLref(referrer, hostname),
    lp: pathname.toLowerCase().slice(0, 120),
    landed_at: new Date().toISOString(),
  }

  try {
    store.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // storage write blocked — still usable for this page's own links
  }

  return record
}

/**
 * Fills `utm_content` with the arrival sport (T14930), but only when nothing already
 * claimed that slot -- an ad's own `utm_content` always wins, and so does an earlier
 * sport page in the same visit (first sport page wins, matching first-touch policy).
 * Mutates and re-persists the record so a LATER sport page in the same visit sees it
 * already filled. No-op when storage is unavailable (private mode) or there is no record.
 */
export function applyArrivalSport(
  record: FirstTouchRecord | null,
  sportKey: string,
  store: Storage,
): FirstTouchRecord | null {
  if (!record || record.params.utm_content) return record
  record.params.utm_content = sportKey
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(record))
  } catch {
    // storage write blocked — the mutated record still applies to this page's own links
  }
  return record
}

/** Merges a first-touch record into a CTA href, never overwriting a param the link already carries. */
export function applyFirstTouch(href: string, record: FirstTouchRecord | null): string {
  if (!record) return href
  try {
    const url = new URL(href)
    for (const [key, value] of Object.entries(record.params)) {
      if (!url.searchParams.has(key)) url.searchParams.set(key, value)
    }
    if (record.lref && !url.searchParams.has('lref')) {
      url.searchParams.set('lref', record.lref)
    }
    if (record.lp && !url.searchParams.has('lp')) {
      url.searchParams.set('lp', record.lp)
    }
    return url.toString()
  } catch {
    return href
  }
}

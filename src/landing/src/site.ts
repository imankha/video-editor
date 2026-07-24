/**
 * Single source of truth for site-wide identity, canonical URLs, and the
 * QUOTABLE FACTS that AI engines cite.
 *
 * Rule: any factual claim that appears on a page, in JSON-LD, or in llms.txt
 * must come from THIS file. That guarantees the site, the structured data, and
 * the AI-crawler summary can never drift apart -- entity consistency is a
 * ranking/citation signal, and three different numbers for the same fact is the
 * fastest way to get dropped from an AI answer.
 *
 * Never add a claim here that isn't verifiable in the product.
 */

/** Canonical origin. www.reelballers.com 301s here, so the apex IS the site. */
export const SITE_URL = 'https://reelballers.com'

/** Where the actual editor lives. All CTAs point here. */
export const APP_URL = 'https://app.reelballers.com'

/** Consistent entity name. Never "Reel Ballers" in prose or schema (T-SEO). */
export const BRAND = 'ReelBallers'

/**
 * The brand tagline. This is the headline humans read -- keep it short and keep
 * it the brand's voice. It is NOT the schema description; see DEFINITION.
 */
export const TAGLINE = "Share Your Player's Brilliance"

/**
 * The one-sentence factual definition, for machines rather than humans. Used
 * verbatim in Organization schema, SoftwareApplication schema, and llms.txt.
 *
 * Deliberately separate from TAGLINE: schema and llms.txt need a literal,
 * checkable description of what the product IS ("a browser-based video editor
 * that..."), whereas the on-page headline needs to sell. Conflating them gives
 * you either an unquotable schema or a robotic homepage. If you change what the
 * product does, change it ONLY here.
 */
export const DEFINITION =
  'ReelBallers is a browser-based video editor that turns raw youth and amateur sports game footage into shareable highlight reels, using AI to track and frame the player you choose.'

export const CONTACT_EMAIL = 'hello@reelballers.com'

/**
 * Social/entity profiles for Organization.sameAs. Only list profiles that
 * actually exist and actually reference ReelBallers -- a dead sameAs link
 * weakens entity resolution instead of strengthening it.
 * TODO(owner): add real Instagram/TikTok/YouTube/LinkedIn URLs when live.
 */
export const SAME_AS: string[] = []

/**
 * VERIFIED PRODUCT FACTS.
 * Each is checkable in the product today. Specific numbers get quoted by AI
 * engines; vague marketing copy does not.
 */
export const FACTS = {
  /** SUPPORTED_SPORTS in the editor's tagRegistry. */
  sportCount: 10,
  /** Sum of positions across all sport tag sets. */
  positionCount: 42,
  /** Sum of play-type presets across all positions. */
  playTypeCount: 123,
  /** Upscale target of the Elevate step. */
  upscaleTarget: '4K',
  /** What a viewer needs to watch a shared reel. */
  viewerRequirement: 'a web browser -- no app install and no account',
  /** Runs entirely in the browser; nothing to download. */
  install: 'Runs in the browser. There is nothing to download or install.',
  /** Pricing. "Free to start" is the claim already made publicly. */
  pricingSummary: 'Free to start.',
} as const

/**
 * Input sources. The product accepts uploaded video files, so the honest claim
 * is "any camera that produces a standard video file" -- NOT "integrates with
 * Veo/Trace". Keep that distinction; overclaiming an integration is the kind of
 * thing an AI engine will contradict from another source.
 */
export const INPUT_SOURCES = [
  'iPhone and Android phones',
  'GoPro and other action cameras',
  'XbotGo and similar auto-follow phone mounts',
  'Camcorders and DSLR/mirrorless cameras',
  'Footage exported from team camera systems (Veo, Trace, Hudl) as a video file',
] as const

/** Primary nav. Also drives the header, footer, and sitemap expectations. */
export const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/sports', label: 'Sports' },
  { href: '/recruiting-videos', label: 'Recruiting' },
  { href: '/guides', label: 'Guides' },
  { href: '/about', label: 'About' },
] as const

/** Absolute URL helper -- every canonical/OG/sitemap URL goes through this. */
export function absUrl(path: string): string {
  if (path === '/') return `${SITE_URL}/`
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

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
export const TAGLINE = 'Transform game film into high-quality highlights in minutes using AI upscaling'

/**
 * On-page hero copy (T13350, set 1b). May be more human than the brand TAGLINE,
 * which still feeds the about page and the meta description wording.
 */
export const HERO_HEADLINE_LEAD = 'Game film in.'
export const HERO_HEADLINE_ACCENT = 'Sharp'
export const HERO_HEADLINE_TAIL = 'highlight out.'
export const HERO_SUBLINE = 'Any video source. You frame your athlete; AI focus smooths, spotlights and upscales.'
export const HERO_TRUST_LINE = 'Free to start. No subscription. Pay only for the AI you use.'

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
  'ReelBallers is a browser-based video editor that turns raw youth and amateur sports game footage into shareable highlight reels: you mark the best plays and frame your player, and ReelBallers smooths the motion, sharpens the picture, and generates the highlight.'

export const CONTACT_EMAIL = 'hello@reelballers.com'

/**
 * The full product tutorial (YouTube). The subscriber email template links the
 * same video: src/backend/app/services/email.py TUTORIAL_URL (T13910).
 */
export const TUTORIAL_URL = 'https://www.youtube.com/watch?v=ve2kwGGQL1o'
export const TUTORIAL_THUMBNAIL = 'https://i.ytimg.com/vi/ve2kwGGQL1o/hqdefault.jpg'

/**
 * Official social accounts and community. Mirrored in the subscriber email
 * template (email.py SOCIAL_LINKS, T13910); change both together.
 */
export const SOCIALS = [
  { label: 'Instagram', href: 'https://www.instagram.com/reelballers1' },
  { label: 'YouTube', href: 'https://youtube.com/@reelballers1' },
  { label: 'TikTok', href: 'https://www.tiktok.com/@reelballers1' },
  { label: 'Reddit', href: 'https://www.reddit.com/r/Reelballers' },
  { label: 'Discord', href: 'https://discord.gg/sXWam8j9QT' },
] as const

/**
 * Social/entity profiles for Organization.sameAs. Only list profiles that
 * actually exist and actually reference ReelBallers -- a dead sameAs link
 * weakens entity resolution instead of strengthening it. The Discord invite is
 * a join link, not a profile, so it is left out.
 */
export const SAME_AS: string[] = SOCIALS.filter((s) => s.label !== 'Discord').map((s) => s.href)

/**
 * VERIFIED PRODUCT FACTS.
 * Each is checkable in the product today. Specific numbers get quoted by AI
 * engines; vague marketing copy does not.
 */
export const FACTS = {
  /** SUPPORTED_SPORTS in the editor's tagRegistry. */
  sportCount: 11,
  /** Sum of play-type presets across all sport tag sets. */
  playTypeCount: 136,
  /** Upscale target of the Elevate step. */
  upscaleTarget: '4K',
  /** What a viewer needs to watch a shared reel. */
  viewerRequirement: 'a web browser -- no app install and no account',
  /** Runs entirely in the browser; nothing to download. */
  install: 'Runs in the browser. There is nothing to download or install.',
  /** Pricing. No subscription exists in the product: credits are bought outright (pricing.json packs) and spent per upload/generation. */
  pricingSummary: 'Free to start. No subscription: buy credits when you need them and pay only for the AI you use. Credits never expire.',
  /** New-account signup bonus (8) plus the welcome grant (80), both granted unconditionally and upfront at signup (T8120 retired the per-quest drip; T9680 confirmed 88 total, no conditions; T11170 decoupled the 80 from the quest system). Source of truth: NEW_ACCOUNT_CREDITS + WELCOME_CREDITS, both in storage_credits.py. */
  freeCredits: 88,
  /** Flat render cost: 1 credit per second of finished, exported video, rounded to the nearest second -- same rate regardless of resolution, upscaling, or overlays. Source of truth: round_credits_half_up(video_seconds) (round-half-up + 1-credit floor, T9750) in highlight_transform.py. */
  creditsPerExportSecond: 1,
} as const

// Credit packs: NOT defined here. Import from '@editor/config/pricing' -- it derives from
// src/backend/app/pricing.json, the single pricing source (T10210), so the site cannot drift.

/**
 * Input sources. The product accepts uploaded video files, so the honest claim
 * is "any camera that produces a standard video file" -- NOT "integrates with
 * Veo/Trace". Keep that distinction; overclaiming an integration is the kind of
 * thing an AI engine will contradict from another source.
 */
export const INPUT_SOURCES = [
  'Footage exported from team camera systems (Veo, Trace, Hudl) as a video file',
  'iPhone and Android phones',
  'GoPro and other action cameras',
  'XbotGo and similar auto-follow phone mounts',
  'Camcorders and DSLR/mirrorless cameras',
] as const

/** Primary nav. Also drives the header, footer, and sitemap expectations. */
export const NAV = [
  { href: '/how-it-works', label: 'How it works' },
  { href: '/sports', label: 'Sports' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/recruiting-videos', label: 'Recruiting' },
  { href: '/guides', label: 'Guides' },
  { href: '/about', label: 'About' },
] as const

/** Absolute URL helper -- every canonical/OG/sitemap URL goes through this. */
export function absUrl(path: string): string {
  if (path === '/') return `${SITE_URL}/`
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}

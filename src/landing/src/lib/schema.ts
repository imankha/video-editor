/**
 * JSON-LD builders.
 *
 * Every structured-data object on the site comes from here so the shapes stay
 * valid and consistent. Pages pass the results to BaseLayout's `schemas` prop,
 * which merges them into one @graph alongside Organization.
 *
 * HARD RULE: never emit AggregateRating, Review, or any count we cannot verify.
 * Fabricated ratings are a Google manual-action risk and AI engines cross-check
 * claims against other sources. See data/testimonials.ts.
 */
import { SITE_URL, BRAND, DEFINITION, absUrl } from '../site'

export interface FaqItem {
  q: string
  a: string
}

/** FAQPage -- attach to any page with a visible FAQ block. */
export function faqPage(items: FaqItem[]) {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.q,
      acceptedAnswer: { '@type': 'Answer', text: item.a },
    })),
  }
}

/**
 * SoftwareApplication. `offers` states a real free tier only -- no invented
 * price. When paid tiers are confirmed, add them here and nowhere else.
 */
export function softwareApplication(opts: { name?: string; description?: string } = {}) {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/#software`,
    name: opts.name ?? BRAND,
    description: opts.description ?? DEFINITION,
    url: `${SITE_URL}/`,
    applicationCategory: 'MultimediaApplication',
    applicationSubCategory: 'Video Editor',
    operatingSystem: 'Web browser (Chrome, Safari, Firefox, Edge)',
    browserRequirements: 'Requires a modern browser with JavaScript enabled.',
    publisher: { '@id': `${SITE_URL}/#organization` },
    offers: {
      '@type': 'Offer',
      price: '0',
      priceCurrency: 'USD',
      description: 'Free to start.',
    },
  }
}

/** BreadcrumbList. Pass the trail excluding Home, which is prepended. */
export function breadcrumbs(trail: { name: string; path: string }[]) {
  const items = [{ name: 'Home', path: '/' }, ...trail]
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absUrl(item.path),
    })),
  }
}

/** HowTo -- for step-by-step guides only, where the steps are genuinely ordered. */
export function howTo(opts: {
  name: string
  description: string
  path: string
  steps: { name: string; text: string }[]
  totalTime?: string
}) {
  return {
    '@type': 'HowTo',
    name: opts.name,
    description: opts.description,
    ...(opts.totalTime ? { totalTime: opts.totalTime } : {}),
    step: opts.steps.map((s, i) => ({
      '@type': 'HowToStep',
      position: i + 1,
      name: s.name,
      text: s.text,
      url: `${absUrl(opts.path)}#step-${i + 1}`,
    })),
  }
}

/** Article -- for guides. dateModified is the freshness signal AI search favours. */
export function article(opts: {
  headline: string
  description: string
  path: string
  datePublished: string
  dateModified: string
  image?: string
}) {
  return {
    '@type': 'Article',
    headline: opts.headline,
    description: opts.description,
    mainEntityOfPage: { '@type': 'WebPage', '@id': absUrl(opts.path) },
    datePublished: opts.datePublished,
    dateModified: opts.dateModified,
    image: opts.image ? `${SITE_URL}${opts.image}` : `${SITE_URL}/og-card.jpg`,
    author: { '@id': `${SITE_URL}/#organization` },
    publisher: { '@id': `${SITE_URL}/#organization` },
  }
}

/** WebPage node tying a page to the site and its primary topic. */
export function webPage(opts: { name: string; description: string; path: string }) {
  return {
    '@type': 'WebPage',
    '@id': absUrl(opts.path),
    name: opts.name,
    description: opts.description,
    url: absUrl(opts.path),
    isPartOf: { '@id': `${SITE_URL}/#website` },
    about: { '@id': `${SITE_URL}/#software` },
  }
}

/** WebSite node. Homepage only. */
export function webSite() {
  return {
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: BRAND,
    url: `${SITE_URL}/`,
    description: DEFINITION,
    publisher: { '@id': `${SITE_URL}/#organization` },
  }
}

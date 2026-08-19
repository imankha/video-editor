/**
 * REAL user testimonials, supplied by the site owner and anonymised at their
 * request. Typos in the source quotes were corrected (heavylifting -> heavy
 * lifting, highligt -> highlight, trracked -> tracked); wording is otherwise
 * untouched.
 *
 * IMPORTANT -- do NOT wrap these in Review / AggregateRating JSON-LD:
 *   1. No star ratings were ever given, so any ratingValue would be fabricated.
 *   2. The authors are anonymised, and review rich results require a real,
 *      identifiable author.
 *   3. Google explicitly excludes self-serving reviews (a business reviewing
 *      itself on its own page) from review rich results.
 * They are displayed as plain, honest social proof instead. If the owner later
 * collects attributable, rated reviews on a third-party platform, THAT is what
 * gets marked up -- see SEO.md.
 */

export interface Testimonial {
  /** The quote, verbatim apart from typo fixes. */
  quote: string
  /** Anonymised attribution. Never invent a name, sport, or level. */
  attribution: string
  /** Which product capability the quote evidences -- used to place it. */
  topic: 'reel-building' | 'sharing' | 'framing' | 'general'
}

export const TESTIMONIALS: Testimonial[] = [
  {
    quote:
      'I like that you can create a reel based on options like games and stars. Really helps for Instagram posts too. The heavy lifting is already done for you.',
    attribution: 'ReelBallers user',
    topic: 'reel-building',
  },
  {
    quote:
      "My mom is always asking me to “send the video” when she can't attend my daughter's games. Now I can send her a high res 3 minute highlight reel with a spotlight so she can actually see what's going on.",
    attribution: 'Parent of a youth athlete',
    topic: 'sharing',
  },
  {
    quote:
      "I loved that I could start wide and bring the camera in tighter at the end. Really tracked well. I'm telling you, this software is great.",
    attribution: 'ReelBallers user',
    topic: 'framing',
  },
  {
    quote: 'Wow, does the app simulate the camera focusing on my son?',
    attribution: 'Parent of a youth athlete',
    topic: 'framing',
  },
  {
    quote: 'Clutch!',
    attribution: 'ReelBallers user',
    topic: 'general',
  },
]

/** Pick the testimonials most relevant to a page, longest-first. */
export function testimonialsFor(topics: Testimonial['topic'][]): Testimonial[] {
  const picked = TESTIMONIALS.filter((t) => topics.includes(t.topic))
  return picked.length ? picked : TESTIMONIALS
}

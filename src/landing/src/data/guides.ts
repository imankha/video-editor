/**
 * Guides (the blog).
 *
 * Five guides are OUTLINED here; only guides with a written body and
 * `published: true` generate a page, appear in /guides, enter the sitemap, or
 * get listed in llms.txt -- so an unapproved outline can never leak as a thin,
 * half-finished page. The remaining outlines await approval before their
 * bodies get written.
 *
 * To publish an approved guide:
 *   1. Create src/content/guides/{slug}.mdx with the body.
 *   2. Flip `published` to true here and set `datePublished`/`dateModified`.
 * See SEO.md.
 */

export interface Guide {
  slug: string
  /** <=60 chars where possible -- this is the <title>. */
  title: string
  /** <=155 chars. */
  description: string
  /** The H1, which can be longer and more natural than the title tag. */
  h1: string
  /** The target search question, in the words a real person would use. */
  targetQuery: string
  /**
   * The direct answer, 1-2 sentences. This runs immediately under the H1
   * before any elaboration, because AI engines quote the first clean answer.
   */
  answer: string
  /** Section headings, in order. The approved skeleton of the article. */
  outline: string[]
  datePublished: string
  dateModified: string
  published: boolean
}

export const GUIDES: Guide[] = [
  {
    slug: 'filming-youth-sports-from-the-sideline',
    title: 'How to Film Your Kid’s Games From the Sideline',
    description:
      'The phone settings, position, and habits that decide whether sideline footage is usable. A practical guide for parents filming youth sports games.',
    h1: 'How to film your kid’s games from the sideline',
    targetQuery: 'how to film your kids game from the sideline phone settings',
    answer:
      'Film in landscape at 4K 30fps, stand as high and as close to the halfway line as you are allowed, lock your exposure before kickoff, and shoot wider than feels right. Wide, steady, high-resolution footage can be cropped into a good highlight reel later; tight, shaky footage cannot be rescued.',
    outline: [
      'The one-minute version (the settings, listed)',
      'Why wide beats zoomed: cropping needs pixels to work with',
      'Resolution and frame rate: what 4K actually buys you',
      'Where to stand: height beats proximity',
      'Locking exposure and focus so the frame stops pulsing',
      'Landscape vs vertical, and why landscape wins even for Instagram',
      'Storage and battery maths for a full game',
      'Mounts, tripods, and going hands-free',
      'Common mistakes that make footage unusable',
      'What to do with the footage afterwards',
    ],
    datePublished: '2026-08-17',
    dateModified: '2026-08-17',
    published: true,
  },
  {
    slug: 'how-long-should-a-recruiting-video-be',
    title: 'How Long Should a Recruiting Video Be?',
    description:
      'College coaches watch recruiting videos for seconds, not minutes. How long a highlight reel should be, what goes in the first 30 seconds, and what to cut.',
    h1: 'How long should a recruiting video be?',
    targetQuery: 'how long should a recruiting video be',
    answer:
      'Aim for three to five minutes, and treat the first 30 seconds as the whole pitch: many college coaches decide within that window whether to keep watching. Lead with your strongest plays rather than saving them for the end.',
    outline: [
      'The short answer, by sport',
      'Why the first 30 seconds carry the decision',
      'Highlight reel vs full-game film: coaches want both, for different reasons',
      'What to open with',
      'What to cut (and the clips parents over-include)',
      'Where to put your name, position, grad year, and contact details',
      'Music, effects, and the things that make coaches close the tab',
      'How to make the player identifiable on every clip',
      'Format, hosting, and how to send it',
      'A checklist before you hit send',
    ],
    datePublished: '',
    dateModified: '',
    published: false,
  },
  {
    slug: 'veo-vs-trace-vs-phone',
    title: 'Veo vs Trace vs Phone: Do You Need a $1,000 Camera?',
    description:
      'An honest comparison of Veo, Trace, and just using your phone for youth sports footage: what each actually costs, and when the cheap option is enough.',
    h1: 'Veo vs Trace vs a phone: do you need a $1,000 camera?',
    targetQuery: 'veo vs trace vs phone camera youth sports worth it',
    answer:
      'For most families, no. A phone on a tripod plus editing software produces a highlight reel that is good enough for club and college recruiting. Dedicated systems like Veo and Trace make sense at the club or team level, where the cost is shared and someone needs full-match film every week.',
    outline: [
      'The short answer',
      'What each option actually is',
      'Real costs: hardware, subscription, and the multi-year total',
      'What the expensive systems genuinely do better',
      'What they do not solve (finding YOUR kid in the footage)',
      'When a phone is genuinely enough',
      'When to step up to a fixed camera',
      'The hybrid most families land on',
      'Editing is the part everyone underestimates',
    ],
    datePublished: '',
    dateModified: '',
    published: false,
  },
  {
    slug: 'how-to-make-a-highlight-reel-for-free',
    title: 'How to Make a Highlight Reel for Free',
    description:
      'A step-by-step guide to making a sports highlight reel without paying for software, including the free tools that work and the limits you will hit.',
    h1: 'How to make a highlight reel for free',
    targetQuery: 'how to make a highlight reel for free',
    answer:
      'You can make a highlight reel for free: import your game footage into a free editor, cut each play to the few seconds that matter, order your best clips first, and export. The real cost is time. Expect several hours per reel doing it manually.',
    outline: [
      'The short answer',
      'What you need before you start',
      'Step 1: get the footage off the camera',
      'Step 2: find the plays worth keeping',
      'Step 3: cut each clip tight',
      'Step 4: make your player findable on screen',
      'Step 5: order the clips',
      'Step 6: export at the right size',
      'Free tools compared, with their actual limits',
      'Where free stops being free (watermarks, export caps, time)',
    ],
    datePublished: '',
    dateModified: '',
    published: false,
  },
  {
    slug: 'best-camera-settings-for-youth-sports',
    title: 'Best Camera Settings for Youth Sports Video',
    description:
      'The resolution, frame rate, shutter, and exposure settings for filming youth sports, plus what changes by sport, indoors, and under floodlights.',
    h1: 'Best camera settings for youth sports video',
    targetQuery: 'best camera settings for filming youth sports',
    answer:
      'Start at 4K 30fps, landscape, with a shutter around 1/60s, exposure and focus locked, and the widest lens setting you have. Raise the frame rate to 60fps only if you want slow motion, and raise the shutter only when panning fast in bright light.',
    outline: [
      'The settings, listed (copy this)',
      'Resolution: why 4K matters more for editing than for watching',
      'Frame rate: 30 vs 60, and when slow motion is worth the file size',
      'Shutter speed and the motion-blur trade-off',
      'Locking exposure for changing light',
      'Indoor sports: gyms, rinks, and pools',
      'Night games under floodlights',
      'Per-sport adjustments',
      'Audio, and whether it matters',
      'File format and storage planning',
    ],
    datePublished: '',
    dateModified: '',
    published: false,
  },
]

/** Only approved, written guides are routed, listed, and indexed. */
export const PUBLISHED_GUIDES = GUIDES.filter((g) => g.published)

export function guideBySlug(slug: string): Guide | undefined {
  return GUIDES.find((g) => g.slug === slug && g.published)
}

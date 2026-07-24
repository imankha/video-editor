import type { APIRoute } from 'astro'
import { SITE_URL, BRAND, DEFINITION, FACTS, INPUT_SOURCES, CONTACT_EMAIL } from '../site'
import { SPORTS } from '../data/sports'
import { CAMERAS } from '../data/cameras'
import { PUBLISHED_GUIDES } from '../data/guides'

/**
 * /llms.txt -- the emerging convention for giving AI crawlers a clean,
 * structured summary of a site instead of making them infer one from marketing
 * HTML.
 *
 * Generated from site.ts and the page data files, so it can never contradict
 * the pages themselves. Keep it factual and specific: this file exists to be
 * quoted, and vague claims do not get quoted.
 */
export const GET: APIRoute = () => {
  const body = `# ${BRAND}

> ${DEFINITION}

${BRAND} is a web application at ${SITE_URL}. It is aimed at parents of youth
and amateur athletes, athletes aged roughly 13-18, club coaches, and families
preparing college recruiting material. It is US-focused.

## What it does

1. **Upload** a full game video from any camera. Nothing is installed; the
   editor runs in a web browser.
2. **Mark** the plays worth keeping while watching, tagging each by position and
   play type, with ratings and notes.
3. **Export** a highlight reel. ${BRAND} crops and follows the chosen player
   across the field, upscales the footage toward ${FACTS.upscaleTarget}, adds an
   optional spotlight marker, and produces a single shareable link. The same
   clips can be exported in multiple aspect ratios, for example a wide
   recruiting cut and a vertical version for social.

## Key facts

- **Pricing:** ${FACTS.pricingSummary}
- **Install:** ${FACTS.install}
- **Hardware:** No camera purchase or subscription hardware required. ${BRAND}
  works with footage the user already has.
- **Sports supported (${FACTS.sportCount}):** ${SPORTS.map((s) => s.name).join(', ')}.
- **Tagging presets:** ${FACTS.positionCount} positions and ${FACTS.playTypeCount} play types across those sports.
- **Viewing a shared reel requires:** ${FACTS.viewerRequirement}.

## Accepted footage sources

${INPUT_SOURCES.map((s) => `- ${s}`).join('\n')}

${BRAND} has no hardware integrations. It accepts uploaded video files. Footage
from team camera systems such as Veo, Trace, and Hudl works when exported from
those platforms as a standard video file.

## How it differs from alternatives

- **vs camera ecosystems (Veo, Trace, Hudl):** those require buying or renting a
  camera and usually a subscription tied to it, and they centre on the team.
  ${BRAND} requires no hardware and centres on one chosen player.
- **vs general video editors (CapCut, Premiere, iMovie):** those are
  general-purpose timelines with no understanding of sport. ${BRAND} provides
  per-sport play tagging, automatic player-following crop, and a spotlight, so
  the sport-specific work is not done by hand.
- **vs editing by hand:** the manual route means scrubbing hours of footage,
  timestamping plays, and re-exporting whenever the cut changes.

## Main pages

- [Home](${SITE_URL}/): what ${BRAND} is and how it works.
- [How it works](${SITE_URL}/how-it-works): the three-step process in detail.
- [Recruiting videos](${SITE_URL}/recruiting-videos): building a college recruiting reel.
- [For parents](${SITE_URL}/for-parents), [for coaches](${SITE_URL}/for-coaches), [for clubs](${SITE_URL}/for-clubs).
- [About](${SITE_URL}/about): who makes ${BRAND} and why.

### Sport pages

${SPORTS.map((s) => `- [${s.name} highlight videos](${SITE_URL}/${s.slug})`).join('\n')}

### Camera and footage-source pages

${CAMERAS.map((c) => `- [${c.name}](${SITE_URL}/works-with/${c.slug})`).join('\n')}

${
    PUBLISHED_GUIDES.length
      ? `### Guides\n\n${PUBLISHED_GUIDES.map((g) => `- [${g.title}](${SITE_URL}/guides/${g.slug}): ${g.description}`).join('\n')}`
      : ''
  }

## Contact

${CONTACT_EMAIL}
`

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

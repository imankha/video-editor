/**
 * Comparison pages -- /vs/{slug}.
 *
 * FAIRNESS RULE: these must be honest and specific, and must credit what the
 * alternative genuinely does better. Two reasons beyond decency: AI engines
 * cross-check comparison claims against other sources and drop the ones that
 * do not hold up, and a comparison that only flatters us reads as marketing and
 * does not get cited. Every row below should survive a reader who uses both.
 *
 * Never state a competitor's pricing as fact here -- it changes, and a stale
 * number is worse than none. Describe the pricing MODEL instead.
 */

import type { FaqItem } from '../lib/schema'

export interface ComparisonRow {
  dimension: string
  /** How the alternative handles it. Be fair. */
  them: string
  /** How ReelBallers handles it. */
  us: string
  /** Which side genuinely wins, or 'depends'. */
  winner: 'them' | 'us' | 'depends'
}

export interface Comparison {
  slug: string
  title: string
  description: string
  h1: string
  answer: string
  /** Honest framing of what the alternative is for. */
  fairSummary: string
  rows: ComparisonRow[]
  /** When the alternative is the right choice. Must be non-empty. */
  chooseThem: string[]
  chooseUs: string[]
  faqs: FaqItem[]
}

export const COMPARISONS: Comparison[] = [
  {
    slug: 'editing-by-hand',
    title: 'ReelBallers vs Editing Highlights by Hand',
    description:
      'An honest comparison of making a sports highlight reel manually versus with ReelBallers: time, cost, quality, and when doing it by hand is still better.',
    h1: 'ReelBallers vs editing highlight reels by hand',
    answer:
      'Editing by hand gives you total creative control and costs nothing but time -- typically several hours per reel. ReelBallers trades some of that control for speed: you mark plays while watching the game and frame your player with a few drags, and the cutting, in-between motion, and export are automatic.',
    fairSummary:
      'Editing by hand in a general video editor is genuinely the more flexible option. Anything you can imagine, you can build, and you are not limited by what someone else automated. The cost is time, and the time is not one-off -- every change to a reel means going back into the timeline.',
    rows: [
      {
        dimension: 'Time per reel',
        them: 'Typically several hours: scrubbing footage, timestamping, cutting, cropping each clip, exporting.',
        us: 'Roughly the length of the game, since plays are marked while watching. No separate editing session.',
        winner: 'us',
      },
      {
        dimension: 'Creative control',
        them: 'Total. Any transition, any effect, any structure.',
        us: 'Constrained to what the tool does: choosing a play, framing your player, spotlight, and export format.',
        winner: 'them',
      },
      {
        dimension: 'Following one player in wide footage',
        them: 'Possible with manual keyframed crops, but slow -- it is per-clip work, repeated for every clip.',
        us: 'Pick the player, drag the crop over them a few times, and ReelBallers connects the motion in between -- a few marks per clip, not a keyframe per frame.',
        winner: 'us',
      },
      {
        dimension: 'Changing a highlight later',
        them: 'Re-open the project, re-edit, re-export the whole thing.',
        us: 'Your tagged plays live in a library, so making another highlight is a new selection rather than a new edit.',
        winner: 'us',
      },
      {
        dimension: 'Reusing clips across formats',
        them: 'Usually a second edit for each aspect ratio.',
        us: 'The same clips export in multiple aspect ratios.',
        winner: 'us',
      },
      {
        dimension: 'Cost',
        them: 'Free if you already own an editor, or the price of one.',
        us: 'Free to start.',
        winner: 'depends',
      },
      {
        dimension: 'Learning curve',
        them: 'Real. Timelines, keyframes, codecs, export settings.',
        us: 'Marking plays and choosing a player.',
        winner: 'us',
      },
      {
        dimension: 'Ceiling on the finished product',
        them: 'As high as your skill goes.',
        us: 'Bounded by what the tool produces.',
        winner: 'them',
      },
    ],
    chooseThem: [
      'You already edit video competently and enjoy it.',
      'You want a specific creative treatment -- a title sequence, a particular edit rhythm, custom graphics.',
      'You are making one reel, once, and time is not the constraint.',
      'You need frame-exact control over every cut.',
    ],
    chooseUs: [
      'You have hours of footage and no realistic prospect of editing it.',
      'The hard part is finding your player in wide footage and keeping them in frame.',
      'You will want more than one version -- a wide cut for coaches, a vertical cut for social -- from the same highlight.',
      'You expect to do this repeatedly, every season, rather than once.',
    ],
    faqs: [
      {
        q: 'Is it cheaper to edit highlights myself?',
        a: 'In money, often yes -- free editors exist and ReelBallers has paid tiers beyond the free start. In time, no: a manual reel typically costs several hours, and that cost repeats every time the reel changes.',
      },
      {
        q: 'Can I get the same result editing by hand?',
        a: 'You can get a better result by hand if you are skilled and patient, because you are not constrained by what the tool automates. Keeping your player in frame is the hardest part to reproduce manually: in a general editor you keyframe a moving crop yourself on every clip, where ReelBallers just needs a few drags and connects the motion in between.',
      },
      {
        q: 'What is actually the slow part of editing highlights?',
        a: 'Not the cutting. It is finding the plays in hours of footage, then reframing each clip so the right player is visible and centred. Those two are what get automated here.',
      },
      {
        q: 'Can I use both?',
        a: 'Yes, and some people do -- make the highlight here, then export and add a custom intro or specific treatment in a general editor.',
      },
    ],
  },
  {
    slug: 'capcut',
    title: 'ReelBallers vs CapCut for Sports Highlights',
    description:
      'An honest comparison of CapCut and ReelBallers for making sports highlight reels: what each is built for, and which one fits youth sports footage.',
    h1: 'ReelBallers vs CapCut for sports highlights',
    answer:
      'CapCut is a strong general-purpose video editor, better than ReelBallers at social-style editing, effects, captions, and templates. ReelBallers is narrower and sport-specific: it tags plays by position, lets you frame one chosen player through wide game footage with just a few drags per clip, and produces recruiting-ready highlights from full matches.',
    fairSummary:
      'CapCut is a capable and popular free editor, and for cutting a short clip for social it is genuinely excellent -- fast, template-driven, with good auto-captions and a large effects library. The gap is not quality, it is subject matter: CapCut has no concept of a sport, a position, a play type, or which of the twenty-two people on screen is your child.',
    rows: [
      {
        dimension: 'What it is built for',
        them: 'General-purpose video editing, weighted toward short-form social content.',
        us: 'Turning full-length sports game footage into per-player highlights.',
        winner: 'depends',
      },
      {
        dimension: 'Effects, transitions, templates',
        them: 'Large library, frequently updated, strong templates.',
        us: 'Minimal by design -- spotlight and highlight graphics, not a general effects suite.',
        winner: 'them',
      },
      {
        dimension: 'Auto-captions and text',
        them: 'Strong automatic captioning.',
        us: 'Not a captioning tool.',
        winner: 'them',
      },
      {
        dimension: 'Finding plays in a two-hour match',
        them: 'Manual scrubbing through the timeline.',
        us: 'Mark plays while watching; tagged by position and play type into a searchable library.',
        winner: 'us',
      },
      {
        dimension: 'Following one player across a wide frame',
        them: 'Manual keyframed cropping, per clip.',
        us: 'A few drags per clip once you pick the player; ReelBallers connects the motion in between.',
        winner: 'us',
      },
      {
        dimension: 'Making the athlete identifiable',
        them: 'Manual shapes or arrows added by hand.',
        us: 'Spotlight marker on the chosen player.',
        winner: 'us',
      },
      {
        dimension: 'Reusing your tagging work',
        them: 'Every highlight is a separate project.',
        us: 'Your tagged plays stay in a library to generate from again.',
        winner: 'us',
      },
      {
        dimension: 'Working with very long source files',
        them: 'Workable, but heavy on a phone.',
        us: 'Built around full-match uploads.',
        winner: 'us',
      },
      {
        dimension: 'Platform',
        them: 'Mobile and desktop apps.',
        us: 'Runs in a web browser, nothing to install.',
        winner: 'depends',
      },
    ],
    chooseThem: [
      'You are cutting one short clip for Instagram or TikTok and want templates and captions.',
      'You want heavy creative treatment -- effects, trending audio, text animation.',
      'You are editing on a phone and want a mobile-native app.',
      'Your footage is already trimmed to the moments that matter.',
    ],
    chooseUs: [
      'Your source is a full game and the work is finding the good parts.',
      'The viewer cannot tell which player is yours without help.',
      'You want recruiting-ready highlights, not a 20-second social clip.',
      'You want to build up a clip library across a season rather than a one-off edit.',
    ],
    faqs: [
      {
        q: 'Is CapCut good for sports highlight reels?',
        a: 'It is good at the editing itself, and many people use it successfully for short sports clips. Where it struggles is full-match footage: there is no play tagging, no sports-specific framing workflow for keeping one player in view, and no way to mark which player a viewer should watch.',
      },
      {
        q: 'Can CapCut follow a player automatically?',
        a: 'Not for a specific athlete across wide game footage on its own -- CapCut offers general subject tracking and masking, but nothing tuned to one chosen player in a crowd of twenty-two. ReelBallers has you frame your athlete and pick them from AI-proposed player boxes, then connects the motion between your marks; CapCut means keyframing a moving crop on each clip by hand.',
      },
      {
        q: 'Which is better for a college recruiting video?',
        a: 'ReelBallers, for the structural reasons -- a recruiting video needs the athlete identifiable in every play, and keeping one player framed across a long match is exactly the manual work this automates. CapCut can produce the same highlights, but you are doing that framing by hand.',
      },
      {
        q: 'Can I use both together?',
        a: 'Yes. A reasonable workflow is to make the highlight in ReelBallers and, if you want a stylised social version, take the export into CapCut for captions and effects.',
      },
      {
        q: 'Is ReelBallers free like CapCut?',
        a: 'ReelBallers is free to start. Both have paid tiers; check each for current pricing rather than relying on a figure quoted on a comparison page.',
      },
    ],
  },
]

export function comparisonBySlug(slug: string): Comparison | undefined {
  return COMPARISONS.find((c) => c.slug === slug)
}

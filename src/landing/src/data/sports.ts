/**
 * Per-sport landing page data.
 *
 * `positions` and `plays` are MIRRORED from the editor's tagRegistry
 * (src/frontend/src/modes/annotate/constants/*Tags.js) into sportTags.json.
 * They are real product data -- the tagging presets a user actually sees -- not
 * marketing copy, which is exactly why they're worth publishing: concrete,
 * checkable specifics are what AI engines quote.
 *
 * To refresh after the editor's tag sets change, re-run the extraction noted in
 * SEO.md. Everything else in this file is hand-written SEO copy.
 */
import tags from './sportTags.json'

export interface SportPlay {
  name: string
  description: string
}

export interface Sport {
  /** URL slug -- the page is /{slug}. */
  slug: string
  /** tagRegistry id, keys into sportTags.json. */
  id: keyof typeof tags
  /** Display name. */
  name: string
  /** Lowercase name for use mid-sentence. */
  lower: string
  emoji: string
  /** <=60 char <title>. */
  title: string
  /** <=155 char meta description. */
  description: string
  /** The H1. Mirrors the primary query. */
  h1: string
  /**
   * The ANSWER paragraph: 1-2 sentences directly answering the page's target
   * question, placed before any elaboration. AI engines quote the first clean
   * answer they find, so this is the single most important copy on the page.
   */
  answer: string
  /** What makes filming/editing this sport specifically hard. */
  challenge: string
  /** What college/club evaluators look for. Sport-specific, not generic. */
  scouting: string
}

export const SPORTS: Sport[] = [
  {
    slug: 'soccer',
    id: 'soccer',
    name: 'Soccer',
    lower: 'soccer',
    emoji: '⚽',
    title: 'Soccer Highlight Video Maker | ReelBallers',
    description:
      'Turn soccer match footage into a highlight reel. Auto-follow framing keeps your player in frame across the pitch. Works with any camera. Free to start.',
    h1: 'Soccer highlight video maker',
    answer:
      'ReelBallers turns full soccer match footage into a highlight reel: you mark the moments that matter, and it automatically crops and follows your player across the pitch so they stay in frame, even in wide sideline video.',
    challenge:
      'Soccer is the hardest sport to film from the sideline. The field is huge, play switches ends in seconds, and a wide shot that captures the run leaves your player eight pixels tall. That is the exact problem auto-follow framing solves: keep the wide camera, and let the crop chase the player.',
    scouting:
      'College soccer coaches watch for first touch, decision speed, and what a player does off the ball. A reel of nothing but goals hides all three, so clips that show the two seconds before the pass are worth as much as the finish.',
  },
  {
    slug: 'basketball',
    id: 'basketball',
    name: 'Basketball',
    lower: 'basketball',
    emoji: '🏀',
    title: 'Basketball Highlight Video Maker | ReelBallers',
    description:
      'Make a basketball highlight reel from game film. Tag buckets, assists, and blocks, then export a vertical reel for Instagram or a recruiting cut. Free.',
    h1: 'Basketball highlight video maker',
    answer:
      'ReelBallers turns basketball game film into a highlight reel: tag scoring, assists, steals, and blocks as you watch, then export a single cut for recruiting or a vertical version for social.',
    challenge:
      'Basketball footage is usually shot from one corner of the gym, so half the possessions run away from the camera and the rim is at an angle. Tight auto-framing on the ball-handler recovers a usable shot from that fixed angle without a second camera.',
    scouting:
      'College basketball coaches want to see defensive effort and shot selection, not just made buckets. Clips that include the possession before the shot -- the screen, the read, the closeout -- tell them more than a montage of makes.',
  },
  {
    slug: 'football',
    id: 'american_football',
    name: 'Football',
    lower: 'football',
    emoji: '🏈',
    title: 'Football Highlight Video Maker | ReelBallers',
    description:
      'Build a football highlight reel from game film. Tag touchdowns, sacks, and blocks by position, spotlight your player on every snap. Free to start.',
    h1: 'Football highlight video maker',
    answer:
      'ReelBallers turns football game film into a highlight reel: tag plays by position -- touchdown passes, broken tackles, pancake blocks, sacks -- and spotlight your player so a coach can find them on every snap.',
    challenge:
      'Football film is only useful if the viewer can tell which of the twenty-two players is yours. Without a spotlight, a coach watching an offensive lineman has no idea where to look, and stops watching. The spotlight effect solves the single biggest reason football reels get skipped.',
    scouting:
      'College football coaches evaluate by position and want to see the same technique repeated, not one spectacular play. They also want the play to start before the snap so they can see alignment and the read.',
  },
  {
    slug: 'flag-football',
    id: 'flag_football',
    name: 'Flag Football',
    lower: 'flag football',
    emoji: '🏈',
    title: 'Flag Football Highlight Reel Maker | ReelBallers',
    description:
      'Make a flag football highlight reel from phone footage. Tag touchdowns, flag pulls, and routes, spotlight your player, and share one link. Free to start.',
    h1: 'Flag football highlight reel maker',
    answer:
      'ReelBallers turns flag football footage into a highlight reel: tag touchdown passes, catches, flag pulls, and pass breakups, then export a shareable cut spotlighting your player.',
    challenge:
      'Flag football is almost always filmed on a phone from the sideline by a parent, at a field with no elevated angle. That footage is wide and shaky by default, which is why stabilised auto-framing and upscaling matter more here than in any other sport.',
    scouting:
      'With flag football now an Olympic sport and growing fast in schools, reels are increasingly used for team and select-squad selection. Coaches look for separation on routes and clean flag-pull technique.',
  },
  {
    slug: 'baseball',
    id: 'baseball',
    name: 'Baseball',
    lower: 'baseball',
    emoji: '⚾',
    title: 'Baseball Highlight Video Maker | ReelBallers',
    description:
      'Turn baseball game footage into a highlight reel. Tag at-bats, strikeouts, and defensive plays, then export a recruiting cut or a social clip. Free.',
    h1: 'Baseball highlight video maker',
    answer:
      'ReelBallers turns baseball game footage into a highlight reel: tag strikeouts, hits, home runs, and fielding plays, then export a recruiting cut or a short clip for social.',
    challenge:
      'Baseball has enormous dead time between moments that matter, so the editing job is mostly finding the twelve useful seconds inside three hours. Marking plays live as you watch, rather than scrubbing afterwards, is what makes a baseball reel tractable.',
    scouting:
      'College baseball recruiters typically want mechanics over outcomes: the same swing or delivery from a consistent angle, repeated. Many also want unedited at-bat sequences alongside the highlight cut.',
  },
  {
    slug: 'softball',
    id: 'softball',
    name: 'Softball',
    lower: 'softball',
    emoji: '🥎',
    title: 'Softball Highlight Video Maker | ReelBallers',
    description:
      'Turn fastpitch softball game footage into a highlight reel. Tag rise balls, slaps, hits, and defensive plays, then export a recruiting cut. Free.',
    h1: 'Softball highlight video maker',
    answer:
      'ReelBallers turns fastpitch softball game footage into a highlight reel: tag strikeouts, rise balls, hits, slaps, and fielding plays as you watch, then export a recruiting cut or a vertical clip for social.',
    challenge:
      'Fastpitch is a reaction-time sport: the windmill delivery covers the 43-foot circle in a blink, and a rise ball only reads its late jump on video when the camera holds the pitcher and batter tight. From the backstop or the outfield fence a wide phone shot flattens that movement, which is exactly what auto-follow framing recovers -- it crops in so the spin and the swing stay legible.',
    scouting:
      'College and travel-ball softball evaluators want repeatable mechanics from a steady angle -- a pitcher spin and release, a slapper footwork out of the box, a middle infielder transfer on the double play. Showcase and club-tournament reels carry more weight when they show full at-bats and defensive sequences than a cut of results alone.',
  },
  {
    slug: 'volleyball',
    id: 'volleyball',
    name: 'Volleyball',
    lower: 'volleyball',
    emoji: '🏐',
    title: 'Volleyball Highlight Video Maker | ReelBallers',
    description:
      'Make a volleyball highlight reel from match footage. Tag kills, blocks, digs, and aces by position, spotlight your player, and share one link. Free.',
    h1: 'Volleyball highlight video maker',
    answer:
      'ReelBallers turns volleyball match footage into a highlight reel: tag kills, blocks, digs, sets, and aces by position, then export a cut that spotlights your player through every rally.',
    challenge:
      'Volleyball is filmed from behind the baseline or up in the stands, where six players in identical uniforms move as a unit. A libero or setter is genuinely hard to pick out, which makes the spotlight and follow-crop the difference between a usable reel and an unwatchable one.',
    scouting:
      'College volleyball coaches want position-specific evidence -- a setter is judged on hands and tempo, a libero on platform and range -- plus full rallies rather than isolated terminal swings.',
  },
  {
    slug: 'lacrosse',
    id: 'lacrosse',
    name: 'Lacrosse',
    lower: 'lacrosse',
    emoji: '🥍',
    title: 'Lacrosse Highlight Video Maker | ReelBallers',
    description:
      'Turn lacrosse game film into a highlight reel. Tag goals, assists, ground balls, and saves, keep your player framed, and share one link. Free to start.',
    h1: 'Lacrosse highlight video maker',
    answer:
      'ReelBallers turns lacrosse game film into a highlight reel: tag goals, assists, dodges, ground balls, and saves, then export a recruiting cut that keeps your player in frame.',
    challenge:
      'Lacrosse combines a big field with fast transition, so sideline footage is wide and the ball moves faster than a parent can pan. Auto-follow framing recovers a tight shot from wide footage without anyone having to operate the camera well.',
    scouting:
      'College lacrosse coaches recruit early and watch for ground-ball effort and off-ball movement as much as finishing. Ground balls are the clips most players under-include and coaches most want to see.',
  },
  {
    slug: 'hockey',
    id: 'hockey',
    name: 'Hockey',
    lower: 'hockey',
    emoji: '🏒',
    title: 'Hockey Highlight Video Maker | ReelBallers',
    description:
      'Make a hockey highlight reel from game footage. Tag goals, assists, checks, and saves, spotlight your skater through traffic. Free to start.',
    h1: 'Hockey highlight video maker',
    answer:
      'ReelBallers turns hockey game footage into a highlight reel: tag goals, assists, dekes, checks, and saves, then export a cut that spotlights your skater through traffic.',
    challenge:
      'Hockey is filmed through glass, from height, with every skater in a helmet and identical sweater. Jersey numbers are unreadable at that distance, so a spotlight marker is often the only way a viewer can follow one player.',
    scouting:
      'Junior and college hockey scouts watch skating stride and puck support away from the play. Shift-length clips are usually more informative than isolated goals.',
  },
  {
    slug: 'rugby',
    id: 'rugby',
    name: 'Rugby',
    lower: 'rugby',
    emoji: '🏉',
    title: 'Rugby Highlight Video Maker | ReelBallers',
    description:
      'Turn rugby match footage into a highlight reel. Tag tries, line breaks, tackles, and carries, keep your player framed, and share one link. Free to start.',
    h1: 'Rugby highlight video maker',
    answer:
      'ReelBallers turns rugby match footage into a highlight reel: tag tries, line breaks, tackles, carries, and rucks, then export a cut that follows your player across the pitch.',
    challenge:
      'Rugby footage is wide by necessity and the ball carrier changes constantly inside a moving pack. Following one player through phase play is the specific thing manual editing cannot do without a second camera operator.',
    scouting:
      'Rugby selectors look for work rate between carries -- the rucks hit, the tackles made off camera-side. Continuous phase clips show that; a montage of tries does not.',
  },
  {
    slug: 'tennis',
    id: 'tennis',
    name: 'Tennis',
    lower: 'tennis',
    emoji: '🎾',
    title: 'Tennis Highlight Video Maker | ReelBallers',
    description:
      'Make a tennis highlight reel from match footage. Tag aces, winners, volleys, and rallies, then export a recruiting cut or a clip for social. Free to start.',
    h1: 'Tennis highlight video maker',
    answer:
      'ReelBallers turns tennis match footage into a highlight reel: tag aces, forehand and backhand winners, volleys, and long rallies, then export a recruiting cut or a social clip.',
    challenge:
      'Tennis is usually filmed from behind the baseline on a fence-mounted phone, so the far player is small and the near player is cropped. A follow-crop that tracks one player keeps them at a usable size through the whole point.',
    scouting:
      'College tennis coaches want full points, not winners in isolation -- they are evaluating construction and movement. Serve mechanics from a consistent angle is the other clip they consistently ask for.',
  },
]

export function sportBySlug(slug: string): Sport | undefined {
  return SPORTS.find((s) => s.slug === slug)
}

/** Positions for a sport, from the mirrored tagRegistry data. */
export function positionsFor(sport: Sport): { id: string; name: string }[] {
  return tags[sport.id].positions
}

/** Play-type presets grouped by position, from the mirrored tagRegistry data. */
export function playsFor(sport: Sport): Record<string, SportPlay[]> {
  return tags[sport.id].plays as Record<string, SportPlay[]>
}

/** Flat list of every play-type name for a sport -- handy for prose and schema. */
export function playNames(sport: Sport): string[] {
  return Object.values(playsFor(sport)).flatMap((list) => list.map((p) => p.name))
}

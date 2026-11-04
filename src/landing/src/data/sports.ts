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
  /**
   * Short (~1 sentence) answer to "why does keeping your athlete in frame
   * matter for THIS sport" -- feeds the framing FAQ. Distinct wording from `challenge`
   * (which is the longer prose version of the same underlying fact) so the
   * page reads as two takes on one idea rather than a repeated paragraph.
   */
  framingWhy: string
  /** Short (~1 sentence) answer to "what should a {sport} recruiting highlight reel show" -- feeds the recruiting FAQ. Distinct wording from `scouting`. */
  recruitingWhy: string
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
      'Turn soccer game video into highlights. Frame your athlete with a few drags and make a highlight from each play. Works with any camera. Free.',
    h1: 'Soccer highlight video maker',
    answer:
      'ReelBallers turns full soccer games into shareable highlights: mark the plays that matter and frame your athlete across the field, then make a highlight from each. ReelBallers connects the motion between your positions so they stay in frame, even in wide sideline video.',
    challenge:
      'Soccer is the hardest sport to film from the sideline. The field is huge, play switches ends in seconds, and a wide shot that captures the run leaves your athlete eight pixels tall. That is the exact problem framing solves: keep the wide camera, drag the box over your athlete a few times as they move, and ReelBallers fills in the motion between your positions.',
    scouting:
      'College soccer coaches watch for first touch, decision speed, and what a player does off the ball. Highlights of nothing but goals hide all three, so plays that show the two seconds before the pass are worth as much as the finish.',
    framingWhy:
      'A shot wide enough to cover the field makes your athlete small in frame. A few drags of the box close that gap, and ReelBallers smooths the motion between them, without you needing to zoom in and lose the run of play around them.',
    recruitingWhy:
      'Lead with first touch and off-ball movement, not just finishes. Goals alone tell a coach less than the decisions that set them up.',
  },
  {
    slug: 'basketball',
    id: 'basketball',
    name: 'Basketball',
    lower: 'basketball',
    emoji: '🏀',
    title: 'Basketball Highlight Video Maker | ReelBallers',
    description:
      'Make basketball highlights from game video. Tag buckets, assists, and blocks, frame your athlete, and go wide for recruiting or vertical for Instagram.',
    h1: 'Basketball highlight video maker',
    answer:
      'ReelBallers turns basketball game video into shareable highlights: tag scoring, assists, steals, and blocks as you watch, frame your athlete, and make a highlight from each, wide for recruiting or vertical for social.',
    challenge:
      'Basketball video is usually shot from one corner of the gym, so half the possessions run away from the camera and the rim is at an angle. Framing in tight on the ball-handler recovers a usable shot from that fixed angle without a second camera.',
    scouting:
      'College basketball coaches want to see defensive effort and shot selection, not just made buckets. Plays that include the possession before the shot (the screen, the read, the closeout) tell them more than a montage of makes.',
    framingWhy:
      'Filmed from one corner of the gym, the ball-handler is usually the only player worth framing tightly. A tight frame keeps them in view through the possession without a second camera.',
    recruitingWhy:
      'Show the possession before the shot (the screen, the closeout, the defensive rotation), since coaches judge effort and reads more than made buckets.',
  },
  {
    slug: 'football',
    id: 'american_football',
    name: 'Football',
    lower: 'football',
    emoji: '🏈',
    title: 'Football Highlight Video Maker | ReelBallers',
    description:
      'Build football highlights from game video. Tag touchdowns, sacks, and blocks, spotlight your athlete, and make a highlight from each play. Free to start.',
    h1: 'Football highlight video maker',
    answer:
      'ReelBallers turns football game video into shareable highlights: tag plays like touchdown passes, broken tackles, pancake blocks, and sacks, then make a highlight from each, spotlighting your athlete so a coach can find them on every snap.',
    challenge:
      'Football video is only useful if the viewer can tell which of the twenty-two players is yours. Without a spotlight, a coach watching an offensive lineman has no idea where to look, and stops watching. The spotlight solves the single biggest reason football highlights get skipped.',
    scouting:
      'College football coaches evaluate by position and want to see the same technique repeated, not one spectacular play. They also want the play to start before the snap so they can see alignment and the read.',
    framingWhy:
      'With twenty-two players on screen, a spotlight is what tells a viewer which one is yours. Without it, most football video is unwatchable to anyone outside the family.',
    recruitingWhy:
      'Start the play before the snap so alignment and the read are visible, and repeat the same technique on multiple plays rather than including one spectacular play.',
  },
  {
    slug: 'flag-football',
    id: 'flag_football',
    name: 'Flag Football',
    lower: 'flag football',
    emoji: '🏈',
    title: 'Flag Football Highlight Reel Maker | ReelBallers',
    description:
      'Make flag football highlights from phone video. Tag touchdowns, flag pulls, and routes, and spotlight your athlete in every play. Free to start.',
    h1: 'Flag football highlight reel maker',
    answer:
      'ReelBallers turns flag football video into shareable highlights: tag touchdown passes, catches, flag pulls, and pass breakups, then make a highlight from each, spotlighting your athlete.',
    challenge:
      'Flag football is almost always filmed on a phone from the sideline by a parent, at a field with no elevated angle. That video is wide and shaky by default, which is why framing in tight and AI upscaling matter more here than in any other sport.',
    scouting:
      'With flag football now an Olympic sport and growing fast in schools, highlights are increasingly used for team and select-squad selection. Coaches look for separation on routes and clean flag-pull technique.',
    framingWhy:
      'Sideline phone video of flag football is wide and shaky by default, so a tight, AI-upscaled frame does more work here than in almost any other sport.',
    recruitingWhy:
      'Coaches increasingly use flag football highlights for team and squad selection, and look for separation on routes plus clean flag-pull technique, not just touchdowns.',
  },
  {
    slug: 'baseball',
    id: 'baseball',
    name: 'Baseball',
    lower: 'baseball',
    emoji: '⚾',
    title: 'Baseball Highlight Video Maker | ReelBallers',
    description:
      'Turn baseball game video into highlights. Tag at-bats, strikeouts, and defensive plays, frame your athlete, and share a recruiting-ready highlight. Free.',
    h1: 'Baseball highlight video maker',
    answer:
      'ReelBallers turns baseball game video into shareable highlights: tag strikeouts, hits, home runs, and fielding plays, then make a highlight from each, recruiting-ready or a short vertical for social.',
    challenge:
      'Baseball has enormous dead time between plays that matter, so the editing job is mostly finding the twelve useful seconds inside three hours. Marking plays live as you watch, rather than scrubbing afterward, is what makes baseball highlights doable.',
    scouting:
      'College baseball recruiters typically want mechanics over outcomes: the same swing or delivery from a consistent angle, repeated. Many also want unedited at-bat sequences alongside the highlights.',
    framingWhy:
      'Most of a baseball game is dead time, so precise framing matters less here than fast, accurate marking of the few seconds (a pitch, an at-bat, a play) actually worth keeping.',
    recruitingWhy:
      "Recruiters want repeatable mechanics from a consistent angle, the same swing or delivery shown more than once, often alongside unedited at-bat sequences.",
  },
  {
    slug: 'softball',
    id: 'softball',
    name: 'Softball',
    lower: 'softball',
    emoji: '🥎',
    title: 'Softball Highlight Video Maker | ReelBallers',
    description:
      'Turn fastpitch softball video into highlights. Tag rise balls, slaps, hits, and defensive plays, then frame your athlete for recruiting. Free.',
    h1: 'Softball highlight video maker',
    answer:
      'ReelBallers turns fastpitch softball game video into shareable highlights: tag strikeouts, rise balls, hits, slaps, and fielding plays as you watch, then make a highlight from each, recruiting-ready or a vertical for social.',
    challenge:
      'Fastpitch is a reaction-time sport: the windmill delivery covers the 43-foot circle in a blink, and a rise ball only reads its late jump on video when the camera holds the pitcher and batter tight. From the backstop or the outfield fence a wide phone shot flattens that movement, which is exactly what a tight frame recovers. Frame in on the pitcher and batter so the spin and the swing stay clear.',
    scouting:
      'College and travel-ball softball evaluators want repeatable mechanics from a steady angle: a pitcher spin and release, a slapper footwork out of the box, a middle infielder transfer on the double play. Showcase and club-tournament highlights carry more weight when they show full at-bats and defensive sequences than results alone.',
    framingWhy:
      "A rise ball's late jump and a windmill delivery only read on video when the pitcher and batter stay tight in frame. A tight frame recovers that from a wide backstop or fence shot.",
    recruitingWhy:
      "Evaluators want repeatable mechanics, like a pitcher's spin and release or a slapper's footwork, shown across full at-bats and defensive sequences, not just results.",
  },
  {
    slug: 'volleyball',
    id: 'volleyball',
    name: 'Volleyball',
    lower: 'volleyball',
    emoji: '🏐',
    title: 'Volleyball Highlight Video Maker | ReelBallers',
    description:
      'Make volleyball highlights from your matches. Tag kills, blocks, digs, and aces, spotlight your athlete, and make a highlight from each play. Free.',
    h1: 'Volleyball highlight video maker',
    answer:
      'ReelBallers turns volleyball matches into shareable highlights: tag kills, blocks, digs, sets, and aces, then make a highlight from each, spotlighting your athlete through the rally.',
    challenge:
      'Volleyball is filmed from behind the baseline or up in the stands, where six players in identical uniforms move as a unit. A libero or setter is genuinely hard to pick out, which makes the spotlight and a tight frame the difference between a usable highlight and an unwatchable one.',
    scouting:
      'College volleyball coaches want position-specific evidence (a setter is judged on hands and tempo, a libero on platform and range), plus full rallies rather than isolated terminal swings.',
    framingWhy:
      'Six players in identical uniforms, filmed from behind the baseline, make a libero or setter genuinely hard to pick out without a spotlight and a tight frame.',
    recruitingWhy:
      'Coaches judge by position (hands and tempo for a setter, platform and range for a libero) and want full rallies, not isolated terminal swings.',
  },
  {
    slug: 'lacrosse',
    id: 'lacrosse',
    name: 'Lacrosse',
    lower: 'lacrosse',
    emoji: '🥍',
    title: 'Lacrosse Highlight Video Maker | ReelBallers',
    description:
      'Turn lacrosse game video into highlights. Tag goals, assists, ground balls, and saves, and keep your athlete framed in every play. Free to start.',
    h1: 'Lacrosse highlight video maker',
    answer:
      'ReelBallers turns lacrosse game video into shareable highlights: tag goals, assists, dodges, ground balls, and saves, then make a recruiting-ready highlight from each, keeping your athlete in frame.',
    challenge:
      'Lacrosse combines a big field with fast transition, so sideline video is wide and the ball moves faster than a parent can pan. Framing in on the ball carrier recovers a tight shot from wide video without anyone having to operate the camera well.',
    scouting:
      'College lacrosse coaches recruit early and watch for ground-ball effort and off-ball movement as much as finishing. Ground balls are the plays most athletes leave out and coaches most want to see.',
    framingWhy:
      'The ball carrier changes constantly inside a moving pack on a big field. Moving the box as they change keeps whoever has the ball in view, without a second camera operator chasing the play.',
    recruitingWhy:
      'Coaches recruit early and weight ground-ball effort and off-ball movement heavily: the plays most athletes leave out and coaches most want to see.',
  },
  {
    slug: 'hockey',
    id: 'hockey',
    name: 'Hockey',
    lower: 'hockey',
    emoji: '🏒',
    title: 'Hockey Highlight Video Maker | ReelBallers',
    description:
      'Make hockey highlights from game video. Tag goals, assists, checks, and saves, spotlight your skater, and make a highlight from each play. Free to start.',
    h1: 'Hockey highlight video maker',
    answer:
      'ReelBallers turns hockey game video into shareable highlights: tag goals, assists, dekes, checks, and saves, then make a highlight from each, spotlighting your skater through traffic.',
    challenge:
      'Hockey is filmed through glass, from height, with every skater in a helmet and identical sweater. Jersey numbers are unreadable at that distance, so a spotlight is often the only way a viewer can follow one skater.',
    scouting:
      'Junior and college hockey scouts watch skating stride and puck support away from the play. Shift-length plays are usually more informative than isolated goals.',
    framingWhy:
      'Filmed through glass with every skater helmeted and numbers unreadable at distance, a spotlight is often the only way a viewer can follow one skater.',
    recruitingWhy:
      'Scouts watch skating stride and puck support away from the play, so shift-length plays usually tell them more than isolated goals.',
  },
  {
    slug: 'rugby',
    id: 'rugby',
    name: 'Rugby',
    lower: 'rugby',
    emoji: '🏉',
    title: 'Rugby Highlight Video Maker | ReelBallers',
    description:
      'Turn rugby matches into highlights. Tag tries, line breaks, tackles, and carries, and keep your athlete framed in every play. Free to start.',
    h1: 'Rugby highlight video maker',
    answer:
      'ReelBallers turns rugby matches into shareable highlights: tag tries, line breaks, tackles, carries, and rucks, then make a highlight from each, keeping your athlete in frame across the field.',
    challenge:
      'Rugby video is wide by necessity and the ball carrier changes constantly inside a moving pack. Framing one athlete through phase play is the specific thing manual editing struggles to do quickly without a second camera operator.',
    scouting:
      'Rugby coaches look for work rate between carries: the rucks hit, the tackles made away from the camera. Continuous phase play shows that; a montage of tries does not.',
    framingWhy:
      'Wide-by-necessity video with a ball carrier that changes inside a moving pack is exactly the situation a second camera operator would normally be needed for. A few moves of the box as the ball moves replace that.',
    recruitingWhy:
      'Coaches look for work rate between carries (rucks hit, tackles made off the ball), which continuous phase play shows and a montage of tries does not.',
  },
  {
    slug: 'tennis',
    id: 'tennis',
    name: 'Tennis',
    lower: 'tennis',
    emoji: '🎾',
    title: 'Tennis Highlight Video Maker | ReelBallers',
    description:
      'Make tennis highlights from your matches. Tag aces, winners, volleys, and rallies, then frame your athlete for recruiting or social. Free to start.',
    h1: 'Tennis highlight video maker',
    answer:
      'ReelBallers turns tennis matches into shareable highlights: tag aces, forehand and backhand winners, volleys, and long rallies, then make a highlight from each, recruiting-ready or a vertical for social.',
    challenge:
      'Tennis is usually filmed from behind the baseline on a fence-mounted phone, so the far player is small and the near player is cut off. Framing in on your athlete keeps them at a usable size through the whole point.',
    scouting:
      'College tennis coaches want full points, not winners in isolation, because they are evaluating construction and movement. Serve mechanics from a consistent angle is the other play they consistently ask for.',
    framingWhy:
      'Filmed from behind the baseline on a fence-mounted phone, the far player is small and the near player is often cut off. A tight frame keeps your athlete a usable size for the whole point.',
    recruitingWhy:
      "College coaches want full points, not winners in isolation, since they're evaluating point construction and movement, plus serve mechanics from a consistent angle.",
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

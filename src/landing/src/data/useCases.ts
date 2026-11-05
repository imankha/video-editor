/**
 * Use-case landing pages -- /recruiting-videos, /for-parents, /for-coaches,
 * /for-clubs.
 *
 * Each page leads with a direct answer, then elaborates in sections. Keep the
 * claims checkable: where a page states what coaches or recruiters want, it
 * should be framed as general practice, never as a statistic we cannot source.
 */
import type { FaqItem } from '../lib/schema'

export interface UseCase {
  slug: string
  title: string
  description: string
  h1: string
  /** Direct answer to the page's target question. Runs under the H1. */
  answer: string
  /** Body sections, in order. */
  sections: { heading: string; body: string[] }[]
  /** Optional checklist rendered as an ordered list. */
  checklist?: { heading: string; items: string[] }
  faqs: FaqItem[]
  ctaHeading: string
}

export const USE_CASES: UseCase[] = [
  {
    slug: 'recruiting-videos',
    title: 'How to Make a College Recruiting Video',
    description:
      'What goes in a college recruiting video, how long it should be, and how to make the highlights for one from your own game video.',
    h1: 'How to make a college recruiting video',
    answer:
      'A college recruiting video is a three-to-five minute highlight reel that opens with your strongest plays, makes you easy to find in every play, and lists your name, position, graduation year, and contact details on screen. ReelBallers helps you make the highlights it is built from, straight from ordinary game video, without hiring an editor.',
    sections: [
      {
        heading: 'What a recruiting video actually needs',
        body: [
          'College coaches watch a lot of these, usually in a hurry, often on a phone between other tasks. The highlight reel that works is the one that answers three questions in the first thirty seconds: who is this player, where are they on the screen, and can they play at our level.',
          'That means the practical requirements are unglamorous. Your name, position, graduation year, height, club or school, and contact details belong on screen at the start. Every play needs the athlete identified before the play develops, not after. And the best plays go first, because there is no guarantee anyone reaches the end.',
        ],
      },
      {
        heading: 'How long should it be?',
        body: [
          'Three to five minutes is the range most college coaches ask for, and the first thirty seconds carry most of the decision. A highlight reel that runs eight minutes does not get watched twice as long; it gets closed earlier.',
          'Many programs also want unedited full-game or full-half video alongside the highlight reel, because a highlight reel deliberately hides the ordinary possessions where technique shows. Send both when you have both: the highlight reel earns the attention, the full game video survives the scrutiny.',
        ],
      },
      {
        heading: 'Making yourself findable on screen',
        body: [
          'The single most common failure in a parent-made highlight reel is that the coach cannot tell which player to watch. In wide sideline video of twenty-two players in matching uniforms, that is a genuinely hard problem, and coaches do not spend long solving it.',
          'There are two fixes and you want both. First, a spotlight on your athlete at the start of each play, so the eye lands in the right place immediately. Second, framing them yourself with a few drags of the box, so they stay near the center of the frame instead of drifting into a corner.',
        ],
      },
      {
        heading: 'Building it from your own game video',
        body: [
          'The manual route is: scrub hours of game video, note timestamps, cut each play, crop each one by hand, add a marker, then re-export the whole thing every time you want to change the order. That is the reason most recruiting highlight reels never get made, and why the ones that do are usually a year out of date.',
          'ReelBallers collapses that into marking plays while you watch, plus a few drags to frame each play. Each tagged play goes into a library you can filter, so you can come back and make another highlight from the same work rather than a second edit. When your athlete has a better game in October, you mark those plays and make new highlights rather than starting over.',
        ],
      },
    ],
    checklist: {
      heading: 'Recruiting video checklist',
      items: [
        'Name, graduation year, position, height, club or school, and contact details on screen in the first few seconds',
        'Three to five minutes total',
        'Strongest plays first, not chronological',
        'Your athlete spotlighted at the start of every play',
        'Each play starts a beat before it develops, so the read is visible',
        'Both sides of the ball if the position calls for it',
        'Full-game or full-half video available on request',
        'A stable link that will not expire, rather than a large attachment',
        'Jersey number visible where possible',
        'No music-video effects that hide the play',
      ],
    },
    faqs: [
      {
        q: 'How long should a college recruiting video be?',
        a: 'Three to five minutes, with your strongest plays in the first thirty seconds. Coaches decide quickly whether to keep watching, so a chronological highlight reel that builds to a finish tends to lose them before the finish.',
      },
      {
        q: 'What should be in the first 30 seconds?',
        a: 'Your identifying details on screen (name, graduation year, position, club or school, contact), followed immediately by your best plays. Do not save the best for last.',
      },
      {
        q: 'Do college coaches want highlights or the full game video?',
        a: 'Usually both, for different reasons. The highlight reel gets you noticed; the full game or half is what a coach watches to check whether the highlights are representative. Have both ready.',
      },
      {
        q: 'Can I make a recruiting video myself?',
        a: 'Yes. A recruiting highlight reel needs clear plays, an athlete viewers can find, and sensible order, none of which requires a professional editor. The hard part is finding the plays in hours of video; keeping your athlete framed just takes a few drags of the box, and ReelBallers connects the motion in between.',
      },
      {
        q: 'What video do I need?',
        a: 'Regular game video from any camera. Wide sideline video from a phone works, because you frame your athlete yourself and ReelBallers zooms into the shot. Filming wide and letting the box do the zoom beats zooming while filming.',
      },
      {
        q: 'Should I add music to a recruiting video?',
        a: 'Keep it minimal or leave it off. Coaches routinely watch muted, and heavy editing effects read as hiding something. Clarity beats production value here.',
      },
      {
        q: 'How much does it cost to make one?',
        a: 'Free to start with ReelBallers. Editing services typically charge per highlight reel, and the cost recurs every time it needs updating, which is the part families tend to underestimate.',
      },
    ],
    ctaHeading: 'Make your recruiting highlights',
  },
  {
    slug: 'for-parents',
    title: 'Highlight Reels for Sports Parents | ReelBallers',
    description:
      'Turn the game video on your phone into highlights your family actually watches. Built for parents, no editing experience and no new camera needed.',
    h1: 'Highlight reels for sports parents',
    answer:
      'ReelBallers turns the game video already on your phone into a highlight you can send with one link. You mark the plays worth keeping and frame your athlete; it makes the highlight.',
    sections: [
      {
        heading: 'The video problem every sports parent has',
        body: [
          'You have hours of game video. It is wide, it is shaky in places, your athlete is small in the frame, and nobody has ever watched it back, including your athlete. It sits on a phone until the storage warning arrives.',
          'The barrier is not motivation, it is that editing it is genuinely tedious. Finding the four good minutes inside two hours, then cropping each one so your athlete is actually visible, is an evening of work per game with normal editing software.',
        ],
      },
      {
        heading: 'What changes',
        body: [
          'You watch the game once, the way you would anyway, tap to mark the plays worth keeping, and drag the box over your athlete a few times per play. ReelBallers connects the motion in between and makes your highlight: your athlete stays zoomed in and sharp, and you get a link.',
          'Because each play is tagged, your library keeps growing. By mid-season you can pull every goal, or everything from one tournament, without touching the original game video again.',
        ],
      },
      {
        heading: 'Sharing with family who are not technical',
        body: [
          'A shared highlight is a link. Whoever opens it needs a web browser and nothing else: no app, no account, no sign-up wall. That matters more than it sounds when the audience is grandparents.',
          'It plays at full resolution rather than the compressed version a messaging app would produce, which is usually the difference between being able to follow the play and not.',
        ],
      },
      {
        heading: 'And for your athlete',
        body: [
          'You can leave notes on specific plays, so feedback happens on the couch at their pace instead of in the car on the way home. Some families find that alone is worth more than the highlight.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Do I need any editing experience?',
        a: 'No. You mark the plays worth keeping while you watch the game, then frame your athlete. Cutting, smoothing the motion between your positions, and sharpening are automatic.',
      },
      {
        q: 'Do I need to buy a camera?',
        a: 'No. The video on your phone is fine. Film wide and steady, then frame your athlete yourself and let the box do the zoom.',
      },
      {
        q: 'How long does it take to make a highlight?',
        a: 'The work is roughly the length of the game, since you mark plays while watching it. There is no separate editing session afterwards.',
      },
      {
        q: 'Can my family watch without signing up?',
        a: 'Yes. A shared highlight opens as a link in any web browser, at full resolution, with no account required.',
      },
      {
        q: 'Can I make a version for Instagram?',
        a: 'Yes. A wide version and a vertical version can come from the same play.',
      },
      {
        q: 'What if I have video from several different cameras?',
        a: 'That is fine. Phone video, action camera video, and exports from team camera systems can all be uploaded and used together.',
      },
    ],
    ctaHeading: 'Turn your game video into something worth watching',
  },
  {
    slug: 'for-coaches',
    title: 'Highlight Reels for Youth Coaches | ReelBallers',
    description:
      'Give every player on your roster their own plays from the same game video. Tag once, share individually. Built for youth and club coaches.',
    h1: 'Highlight reels for youth coaches',
    answer:
      'ReelBallers lets a coach tag plays once in a single game video and share them with individual players. You tag teammates on each play, so one pass through the game serves the whole roster instead of one player.',
    sections: [
      {
        heading: 'One game, every player',
        body: [
          'The usual bottleneck for a coach is that game video is organized by game, but everything useful is organized by player. A parent asks for their athlete’s plays and it means scrubbing the game again.',
          'Tagging plays by play type as you review turns the game into a set of plays you can pull by tag. Because plays carry teammate tags, the same review pass produces plays for everyone who appears in them.',
        ],
      },
      {
        heading: 'Teaching with it',
        body: [
          'Notes attached to specific plays are more useful than a team talk about a game everyone remembers differently. Players review their own plays at their own pace, with the note visible at the point it applies to.',
          'The same play library supports the less comfortable half of coaching too: showing a player what happened rather than describing it.',
        ],
      },
      {
        heading: 'What it does not require',
        body: [
          'No camera system, no per-team hardware, no installation. If someone films the game on a phone or a fixed action camera, that file is enough. Clubs that already run a camera system can upload the export instead.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Can I get plays for multiple players from one game?',
        a: 'Yes. Tag teammates on each play as you review, and the same pass through the game yields plays for every player who appears.',
      },
      {
        q: 'Do I need a team camera system?',
        a: 'No. Any standard video file works: a phone on a tripod, an action camera on the fence, or an export from a system your club already uses.',
      },
      {
        q: 'Can players see coaching notes?',
        a: 'Yes. Notes attach to specific plays, so a player reviewing at home sees the comment at the point it refers to.',
      },
      {
        q: 'Can I share plays with parents?',
        a: 'Yes, as a link. People need only a web browser, no account and no app.',
      },
      {
        q: 'How much does it cost?',
        a: 'Free to start.',
      },
    ],
    ctaHeading: 'Get plays for your whole roster',
  },
  {
    slug: 'for-clubs',
    title: 'Highlight Video for Sports Clubs | ReelBallers',
    description:
      'Give every family in your club highlights from games you already film, without buying camera hardware or a per-team subscription.',
    h1: 'Highlight video for sports clubs',
    answer:
      'ReelBallers lets a club turn games it already films into highlights for each athlete, without buying camera hardware. It works with the video files your existing setup produces, including exports from systems like Veo, Trace, or Hudl.',
    sections: [
      {
        heading: 'The gap in club video',
        body: [
          'Clubs that invest in a camera system solve filming, and filming was never the thing families were asking about. Parents want their own athlete’s plays, and coaches want teaching material. Both of those are editing problems, and a camera does not address either.',
          'The result is familiar: expensive video that nobody outside the coaching staff watches, and parents who still film the game themselves on a phone.',
        ],
      },
      {
        heading: 'Working with what you already film',
        body: [
          'ReelBallers accepts standard video files, so whatever your club records can be used. There is no integration to procure, no hardware to standardize on, and no requirement that every team uses the same setup.',
          'Clubs on a camera system export the game and upload it. Teams without one use a phone or an action camera. Both paths produce the same result.',
        ],
      },
      {
        heading: 'What families get',
        body: [
          'Highlights for each athlete that can be shared with a link, at full resolution, to anyone, including recruiters and relatives who will not install an app. For recruiting-age athletes this is the difference between having material to send and not.',
        ],
      },
    ],
    faqs: [
      {
        q: 'Does this replace our Veo or Trace setup?',
        a: 'No, it works alongside it. Those systems film the game; ReelBallers turns the export into highlights for each athlete. If your club already has filming solved, this addresses the editing half.',
      },
      {
        q: 'Do all our teams need the same camera?',
        a: 'No. Any standard video file works, so teams can film however suits them and still end up with the same output.',
      },
      {
        q: 'Can each family get their own athlete’s plays?',
        a: 'Yes. Plays are tagged by athlete, so a single review pass through a game produces plays for everyone in it.',
      },
      {
        q: 'Is there hardware to buy?',
        a: 'None. ReelBallers runs in a web browser and works with video you already have.',
      },
    ],
    ctaHeading: 'Bring highlight video to your club',
  },
]

export function useCaseBySlug(slug: string): UseCase | undefined {
  return USE_CASES.find((u) => u.slug === slug)
}

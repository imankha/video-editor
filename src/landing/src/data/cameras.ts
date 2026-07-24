/**
 * "Works with" pages -- /works-with/{slug}.
 *
 * These target camera-name queries ("how to edit GoPro footage into a highlight
 * reel"), which are high-intent and low-competition.
 *
 * ORDER: the array order drives the listing on /works-with, the footer, and
 * llms.txt. Trace and Veo lead (owner's call -- the team-camera-system angle
 * first), then the rest run roughly by how common they are for filming youth
 * sports: phone, GoPro, auto-follow mount, then dedicated action cams.
 *
 * HONESTY RULE: ReelBallers has no hardware integrations. It accepts uploaded
 * video files. Every page here must say so plainly -- the claim is "your
 * footage from X works", never "we integrate with X". For team systems (Veo,
 * Trace, Hudl) the claim is narrower still: it works with video you EXPORT from
 * those platforms. Overclaiming an integration is exactly the kind of thing an
 * AI engine will contradict from another source, and it burns the citation.
 */

export interface Camera {
  slug: string
  /** Display name, used mid-sentence. */
  name: string
  title: string
  description: string
  h1: string
  /** 1-2 sentence direct answer, placed before any elaboration. */
  answer: string
  /** What this source is good and bad at, honestly. */
  reality: string
  /** Concrete, checkable capture tips specific to this device. */
  tips: string[]
  /** True for platforms we can only accept an export from. */
  exportOnly?: boolean
}

export const CAMERAS: Camera[] = [
  {
    slug: 'trace',
    name: 'Trace',
    title: 'Edit Trace Footage Into a Highlight Reel',
    description:
      'Export Trace match video into a personal highlight reel with follow-framing and a player spotlight. Works with the exported file. Free to start.',
    h1: 'How to edit Trace footage into a highlight reel',
    answer:
      'Download your match video from Trace, upload the file to ReelBallers, and build a reel from it. There is no direct Trace integration -- ReelBallers works with the exported video file, so you can add per-player editing to footage your club already captures.',
    reality:
      'Trace produces automated player clips using a wearable tracker, which is useful but limited: you get the clips its algorithm chose, in the format it chose. Editing the full match export yourself is how you get the plays it missed, the framing you want, and a reel of the length a specific coach asked for.',
    tips: [
      'Export the full match rather than only the auto-generated personal clips -- the auto-cut typically misses off-ball work entirely.',
      'Trace footage is panoramic and wide, which is ideal input for a follow-crop.',
      'Keep the original export. Re-encoding a clip that was already compressed once visibly softens it.',
    ],
    exportOnly: true,
  },
  {
    slug: 'veo',
    name: 'Veo',
    title: 'Edit Veo Footage Into a Highlight Reel',
    description:
      'Export your Veo match footage and turn it into a highlight reel with per-player follow-framing and a spotlight. Works with the exported file. Free.',
    h1: 'How to edit Veo footage into a highlight reel',
    answer:
      'Download the match video from your Veo account, upload the file to ReelBallers, and build a reel from it. ReelBallers does not connect to Veo directly -- it works with the exported video file, which means you keep your club Veo setup and add per-player editing on top.',
    reality:
      'Veo is a club-level capture system: an expensive fixed camera that records the whole match and auto-follows play. What it does not do well is make one specific player the subject. Most parents on a Veo club still cannot get a personal highlight reel for their own child without editing the export themselves.',
    tips: [
      'Export the full match at the highest quality your Veo plan allows rather than a pre-cut clip -- you want the moments the auto-editor skipped.',
      'Veo footage is very wide by design, so it crops well. This is the ideal input for a follow-crop.',
      'If your club restricts downloads, ask the coach or club admin -- match exports are usually available to the team.',
    ],
    exportOnly: true,
  },
  {
    slug: 'iphone',
    name: 'iPhone',
    title: 'Edit iPhone Game Footage Into Highlight Reels',
    description:
      'Turn iPhone game footage into a highlight reel. Which resolution and frame rate to shoot, and how to auto-follow your player. Free to start.',
    h1: 'How to edit iPhone footage into a highlight reel',
    answer:
      'Upload the video straight from your iPhone, mark the plays worth keeping, and ReelBallers crops and follows your player automatically. iPhone footage needs no conversion -- the .MOV and .MP4 files the camera app produces upload as they are.',
    reality:
      'An iPhone on a sideline is the most common source of youth sports footage, and it is genuinely good enough. The real limits are distance and shake, not the sensor. Shooting wide and letting the software crop in beats zooming with your thumb, because a digital zoom throws away the pixels the follow-crop needs.',
    tips: [
      'Shoot 4K at 30fps if you have the storage. The extra resolution is what makes a cropped follow-shot still look sharp -- cropping 1080p to a tight frame leaves roughly a quarter of the pixels.',
      'Turn on the grid (Settings > Camera > Grid) and keep the far touchline near the top third. Most sideline footage wastes a third of the frame on sky.',
      'Lock exposure with a long press before kickoff so the frame does not pulse every time play moves between sun and shade.',
      'Film in landscape. Vertical footage cannot be cropped to a wide recruiting frame later, but a landscape original can always be cut to vertical for social.',
      'Use High Efficiency (HEVC) to halve file size, or Most Compatible if you want maximum compatibility with older tools.',
    ],
  },
  {
    slug: 'gopro',
    name: 'GoPro',
    title: 'Edit GoPro Sports Footage Into Highlight Reels',
    description:
      'Turn GoPro game footage into a highlight reel. Best settings, handling the fisheye lens, and auto-following your player. Works with any GoPro. Free.',
    h1: 'How to edit GoPro footage into a highlight reel',
    answer:
      'Upload the MP4 straight off the GoPro, mark the plays you want, and ReelBallers crops and follows your player automatically. The wide GoPro frame is an advantage here: more field in shot means more room for the follow-crop to work with.',
    reality:
      'A GoPro mounted on a fence or tripod captures the whole field unattended, which is exactly what you want -- nobody has to operate it. The trade-off is that everyone is small in frame and the ultra-wide lens bends the touchlines. Cropping in on one player fixes both at once.',
    tips: [
      'Shoot 4K at 30fps in Linear (not SuperView or Wide) if your model offers it. Linear removes most of the fisheye distortion in-camera, so straight lines stay straight after cropping.',
      'Mount high and central if you can -- a fence post at the halfway line beats a corner. Height is worth more than proximity for field sports.',
      'Turn HyperSmooth on for handheld or pole mounts, off for a locked-down tripod where it only crops the frame for nothing.',
      'Bring a spare battery. A GoPro will not survive two full halves plus warmups on one charge in cold weather.',
      'Upload the original MP4 rather than a phone-app export -- the GoPro Quik app re-compresses, which costs you detail the upscaler could have used.',
    ],
  },
  {
    slug: 'xbotgo',
    name: 'XbotGo',
    title: 'Edit XbotGo Footage Into Highlight Reels',
    description:
      'Turn XbotGo auto-tracked footage into a highlight reel. How the gimbal handles tracking, what to fix in editing, and how to spotlight your player. Free.',
    h1: 'How to edit XbotGo footage into a highlight reel',
    answer:
      'Upload the video your phone recorded on the XbotGo gimbal, mark the plays worth keeping, and ReelBallers builds the reel. XbotGo tracks the ball or the team during capture; ReelBallers handles what comes after -- selecting plays, following one specific player, and producing a shareable cut.',
    reality:
      'XbotGo and ReelBallers solve different halves of the same problem, which is why they pair well. The gimbal means nobody has to stand and film. But it tracks play generally, not your child specifically, and it produces one long unbroken recording -- so you still finish the game with a two-hour file and no highlight reel.',
    tips: [
      'Record at the highest resolution your phone supports. The gimbal is already panning; a cropped follow-shot on top of that needs the extra pixels.',
      'Let the gimbal keep a wider frame rather than tracking tight. A tight in-camera track plus a tight edit crop double-crops the same footage.',
      'Start the recording before warmups end so you have a clean handle before the first whistle.',
      'Because the camera pans, note roughly when your player was involved -- marking plays is faster when the footage is one continuous take with no scene changes.',
    ],
  },
  {
    slug: 'dji-osmo-action',
    name: 'DJI Osmo Action 6',
    title: 'Edit DJI Osmo Action Footage Into Highlight Reels',
    description:
      'Turn DJI Osmo Action 6 game footage into a highlight reel. Best field-of-view and stabilization settings, and how to auto-follow your player. Free.',
    h1: 'How to edit DJI Osmo Action footage into a highlight reel',
    answer:
      'Upload the MP4 straight off your DJI Osmo Action 6, mark the plays you want, and ReelBallers crops and follows your player automatically. Its wide field of view is an advantage: more of the field in shot means more room for the follow-crop to work with.',
    reality:
      'A DJI Osmo Action mounted on a fence or tripod records the whole field unattended, which is exactly what you want -- nobody has to operate it. The trade-offs mirror any action cam: everyone is small in the frame and the widest field of view bends the lines. Cropping in on one player fixes both at once.',
    tips: [
      'Shoot 4K at 30fps in a Standard or Dewarp field of view rather than the widest Ultra-Wide setting -- less lens distortion means a cleaner crop.',
      'Mount high and central -- a fence post at the halfway line beats a corner. Height matters more than proximity for field sports.',
      'Turn RockSteady stabilization on for handheld or pole mounts, and off for a locked-down tripod where it only crops the frame for nothing.',
      'Bring a spare battery or a charging case. An action camera will not survive two full halves plus warmups on one charge in the cold.',
      'Upload the original MP4 from the card rather than a phone-app re-export, which re-compresses and costs detail the upscaler could have used.',
    ],
  },
  {
    slug: 'action-camera',
    name: 'action camera',
    title: 'Edit Action Camera Footage Into Highlight Reels',
    description:
      'Turn footage from any action camera -- Insta360, Akaso and others -- into a highlight reel with auto-follow framing and a player spotlight. Free.',
    h1: 'How to edit action camera footage into a highlight reel',
    answer:
      'Upload the MP4 from any action camera -- Insta360, Akaso, or a GoPro or DJI alternative -- mark the plays worth keeping, and ReelBallers crops and follows your player automatically. If the camera writes a standard video file, it works.',
    reality:
      'Action cameras all share the same profile for sports: very wide lens, unattended mounting, good stabilisation, small subjects. That combination is close to ideal for automated follow-framing, because there are plenty of pixels around the player to crop into.',
    tips: [
      'Prefer a linear or de-warped mode over the widest fisheye setting -- less lens distortion means a cleaner crop.',
      'Shoot 4K30 rather than 1080p60 for field sports. Resolution helps the crop; frame rate mostly does not, unless you want slow motion.',
      'Mount as high as the fence or tripod allows. Elevation separates players who would otherwise overlap at ground level.',
      'For 360 cameras, export a flat reframed video first -- upload the standard MP4, not the raw 360 file.',
    ],
  },
]

export function cameraBySlug(slug: string): Camera | undefined {
  return CAMERAS.find((c) => c.slug === slug)
}

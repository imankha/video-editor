/**
 * Hero before/after demo media -- the ONE place these URLs live.
 *
 * The videos are hosted on the public R2 bucket, NOT bundled with the site, so
 * they can be swapped without a redeploy. When you swap them you MUST also
 * regenerate the poster frames, or the still frame will not match the video.
 *
 * See docs/plans/tasks/T-hero-video-swap.md for the full swap procedure and
 * the target encoding specs (the current pair is ~73 MB combined, which is the
 * single biggest performance problem on the site).
 */

const R2_BASE = 'https://pub-8fd2fb93bbed4535849c27ec673e7905.r2.dev'

export const HERO_MEDIA = {
  before: {
    src: `${R2_BASE}/before.mp4`,
    /** Generated with: ffmpeg -ss 2 -i before.mp4 -frames:v 1 -vf scale=540:-2 */
    poster: '/hero/before-poster.webp',
  },
  after: {
    src: `${R2_BASE}/after.mp4`,
    poster: '/hero/after-poster.webp',
  },
  /**
   * Describes what the demo shows. Used as the accessible label and in copy --
   * update it if the swapped footage shows a different sport or effect.
   */
  alt: 'Side-by-side comparison: the same soccer play as raw wide sideline footage, and as a ReelBallers reel with the player followed and spotlighted.',
} as const

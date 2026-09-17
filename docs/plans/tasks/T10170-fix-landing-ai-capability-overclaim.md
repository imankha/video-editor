# T10170: Fix live landing-site claims that AI autonomously frames/tracks the player

**Status:** WIP
**Impact:** 8
**Complexity:** 4
**Created:** 2026-09-15
**Updated:** 2026-09-15

## Problem

The landing site (and, until just now, one in-app string) claims the AI autonomously "frames"
and "tracks" the player. It does not. This is a live, public, SEO-indexed accuracy bug with a
direct drop-off risk: a parent who reads "follows your player automatically" and then has to
manually place a crop box and click their kid on every detected frame hits a real
expectation-vs-reality gap, which the product owner has explicitly flagged as a churn driver.

**What the app actually does** (verified against code, see `.claude/knowledge/keyframes-framing.md`
and `feedback_ai_capability_copy_accuracy.md` memory):
- **Focus mode crop is 100% user-placed.** The parent drags/positions the crop box;
  `FramingInstructions.jsx` deliberately instructs "Move the box over your athlete... Move it
  again to follow them" specifically so the product does NOT overclaim auto-framing. No ML
  decides the crop. An unedited clip gets a fixed, non-AI default box.
- **Player "tracking" is the user clicking their kid on AI-proposed boxes.** Backend YOLO
  detection proposes candidate person bounding boxes per frame with NO cross-frame identity;
  the user must tap/assign their player on every detected frame
  (`PlayerDetectionOverlay.jsx`, "Tap a green marker on the timeline to find your athlete").
  One convenience: the most-centered box is pre-suggested, still user-overridable.
- **AI upscale (Real-ESRGAN) is a pure resolution/quality pass**, applied last, after the
  user's crop and player selection are already baked into the frame.

**Found live in production (2026-09-15), pre-dating this task:**
- `src/landing/src/pages/index.astro` - hero FAQ answer (~line 25), "how it works" step 3 body
  (~line 82: "ReelBallers puts the focus on your player: zoomed in, following every play"), and
  the page's **SEO meta description** (~line 89: "get a highlight reel that follows your player
  automatically").
- `src/landing/src/data/cameras.ts` - 4 camera-specific pages (iPhone ~line 82, GoPro ~line
  101, DJI Osmo Action 6 ~line 138, generic action cam ~line 157), each: "ReelBallers crops and
  follows your player automatically."
- `src/landing/src/data/sports.ts` - at least soccer (~line 69) and rugby (~line 258).
- `src/landing/src/pages/works-with/[camera].astro` (~line 43) and
  `src/landing/src/pages/[sport].astro` (~line 43, ~line 50) - the TEMPLATES that render the
  data above into per-camera and per-sport pages, so this is likely dozens of live generated
  pages, not a handful.

## Solution

Replace every instance of the autonomous-framing/tracking claim with accurate, still-compelling
language. Suggested shape (adapt per surface's tone, keep consistent vocabulary across all of
them): **"You frame your athlete and pick them from the AI's player boxes; ReelBallers connects
the dots for smooth motion and upscales for a crisp, high-res reel."** Do not just delete the
claim - the actual mechanism (AI proposes detection boxes, parent confirms, AI fills the motion
in between) is still a real, compelling capability; state it honestly instead of dropping to
generic "we edit your video" language.

The already-fixed in-app string (`DIVISION_OF_WORK` in `displayNames.js`, fixed in T9650 commit
`502f94fa`) is the reference phrasing/tone to match across every landing surface listed above -
all surfaces should say the same thing, per this epic's established "surfaces must not
disagree" pattern (T9650, T9860).

**Do not touch:** the actual mechanism/behavior. This is a copy-only task - the AI-upscale +
click-your-player flow is unchanged; only the description of it changes.

## Context

### Relevant Files (REQUIRED)
- `src/landing/src/pages/index.astro` - hero FAQ, step 3, meta description
- `src/landing/src/data/cameras.ts` - 4 camera-page bodies
- `src/landing/src/data/sports.ts` - sport-page bodies (audit ALL sports, not just the two
  confirmed above - grep for "follows your player" / "crops and follows" / "frames your
  player" / "tracks your player" across the whole file)
- `src/landing/src/pages/works-with/[camera].astro` - camera-page template body
- `src/landing/src/pages/[sport].astro` - sport-page template body (two occurrences: FAQ answer
  + template body)
- `src/frontend/src/config/displayNames.js` - `DIVISION_OF_WORK` (already fixed, reference
  phrasing only, do not re-touch unless tone needs to match a landing-side revision)

### Related Tasks
- Found during: T9650 (align work/pricing/retention copy) - the product owner corrected
  T9650's own first-draft copy for this exact overclaim, which led to finding it already live
  elsewhere. See `project_t9650_ai_capability_copy_bug.md` memory for the full incident.
- Precedent: T9860 (single copy/concept sweep) and T9650 established the "public and signed-in
  surfaces must state the same thing" pattern - this task is a fourth (or fifth) surface that
  must also agree.

### Technical Notes
No em dashes (project-wide rule). No placeholder/provisional copy - every replacement string
must be policy-accurate and reviewed against the actual mechanism, not just "sounds better."
SEO note: the meta `description` on `index.astro` is what search engines and AI-engine crawlers
index and quote directly - get this one right first, it's the highest-visibility instance.
Astro dynamic routes (`[sport].astro`, `[camera].astro`) render MANY pages from one template +
one data file, so a single template fix propagates everywhere - verify by spot-checking at
least 2-3 rendered sport/camera pages after the fix, not just the template source.

## Implementation

### Steps
1. [x] Grep the full `src/landing/` tree for every remaining instance of "follows your player" /
   "crops and follows" / "frames your player" / "tracks your player" / "automatically" near
   "player"/"athlete" - confirm the list above is complete, not partial.
   **Found far more than the file list above: the "auto-follow framing"/"follow-crop" overclaim
   is woven through ALL 10 sports in `sports.ts` (not just soccer/rugby) and all 7 cameras in
   `cameras.ts` (not just the 4 named), plus `comparisons.ts` (2 comparison pages), `useCases.ts`
   (recruiting-video and other use-case FAQs), `how-it-works.astro`, `about.astro`, and the
   site-wide `DEFINITION` const in `site.ts` (propagates into JSON-LD schema on every page,
   `llms.txt`, and `about.astro`'s own FAQ/schema via `schema.ts`). Fixed all of it, not just the
   originally-listed instances - completeness is what "no landing-site page" in the acceptance
   criteria actually requires.**
2. [x] Draft the accurate replacement phrasing (one canonical version, adapted per surface's
   sentence structure) - reviewed against `feedback_ai_capability_copy_accuracy.md` memory.
   Canonical shape used throughout: "you frame your athlete and pick them from the AI's player
   boxes; ReelBallers connects the dots for smooth motion" (matches `DIVISION_OF_WORK`).
3. [x] Update `index.astro` (hero FAQ x2, step 3, meta description, Elevate section + its "Under
   the hood" line which said "AI tracking" - also wrong).
4. [x] Update `cameras.ts` (all 7 camera bodies, not just 4) and `[camera].astro` template.
5. [x] Update `sports.ts` (ALL 10 sport bodies) and `[sport].astro` template (both occurrences).
6. [x] Spot-checked rendered output post-build: `dist/soccer.html`, `dist/rugby.html`,
   `dist/works-with/iphone.html`, `dist/index.html` meta descriptions, `dist/llms.txt`, and
   `dist/about.html` - template fixes confirmed propagating. Full `npm run build` (33 pages)
   clean, then a final `grep -rl` across the entire `dist/` output for every banned phrase
   pattern returned zero hits.
7. [x] Final wording matches `DIVISION_OF_WORK` tone/vocabulary - also updated `site.ts`'s
   `DEFINITION` const itself (previously said "using AI to track and frame the player you
   choose" - the same overclaim, and the highest-leverage fix since it's the literal machine-
   facing description injected into schema.ts's JSON-LD, llms.txt, and about.astro).
   Additionally corrected `comparisons.ts`'s two comparison tables (editing-by-hand, CapCut) and
   the stale `marcom-focus-positioning` memory, which had recorded the pre-correction "focus/
   follows" vocabulary as approved brand voice - noted as superseded for autonomy claims.

## Acceptance Criteria

- [x] No landing-site page (homepage, any sport page, any camera page) claims the AI
      autonomously frames, follows, or tracks the player - verified by a `dist/`-wide grep
      returning zero hits after build
- [x] The homepage SEO meta description is accurate
- [x] Replacement copy is still compelling (states the real AI-proposes/parent-confirms
      mechanism honestly, not a generic downgrade) - kept sport/camera-specific technical detail,
      only replaced the false-autonomy claim
- [x] Landing and signed-in app surfaces state the same thing (matches `DIVISION_OF_WORK`)
- [x] No em dashes, no placeholder copy - verified via a real em/en-dash character grep on every
      changed file
- [x] At least 2-3 rendered sport pages and 2-3 rendered camera pages spot-checked to confirm
      the template-level fix actually applies
- [x] Relevant test set green (whatever covers landing page rendering, if any exists) - no
      landing tests exist in this repo; `npm run build` (33 pages, clean, no SEO warnings) is the
      available verification and passes
- [ ] Branch CI green - pending push
- [ ] Branch CI green

# T14650: Landing site vocabulary

**Status:** TODO
**Impact:** 7
**Complexity:** 5
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

A visitor learns different words on the landing site than the app uses. Step names come in
four sets (Educate / Elevate / Celebrate; Annotate / Frame & highlight / Share; Upload / Mark /
Generate; Mark plays / Framing / Spotlight / Share). The marked moment is play, clip, moment,
draft. "Highlight reel" names a single video about 70 times (against the rule that a reel is a
collection) and collections are never explained. The game is game film / footage / match video /
game file. The kid is athlete / player / kid / child. "Aspect ratio", "keyframed crops",
"transcoding", "AI-proposed player boxes", "motion interpolation". About 127 "--" dashes and
British spellings (centre, organised, kit, pitch, touchline, sofa) on a US-focused site.

Task 6 of 8 in the [Copy Vocabulary epic](EPIC.md). Read EPIC.md for the glossary, verbs and
style rules. T14520 already fixed the overclaims and T14560 the step count; this task does the
rest of the landing vocabulary.

## Solution

- One step sequence everywhere: **Upload game, Mark plays, Frame, Spotlight, Share**, using the
  app's own labels. Retire Educate/Elevate/Celebrate as headings (illustration file names may stay).
- play / highlight / highlight reel per the glossary. **D5:** keep "highlight reel" in page
  `<title>`s and FAQ questions for search; body copy says "highlight" for a single video, and
  add one line that explains combining highlights into a highlight reel.
- **athlete** for the parent's kid (D4); "skater" etc. stay where the sport uses them.
- "game video" (or "your game"); "footage" only on camera pages where it is the camera's term.
- Plain words for jargon: "vertical and wide versions" is NOT decided (see EPIC.md: keep current
  words, ask the user); "adjusting the box position by position" instead of keyframes; drop transcoding / codecs.
- Replace every "--" with a period, comma or colon; US spelling and words.

## Context

### Relevant Files
- `src/landing/src/pages/**` (index, how-it-works, about, for-parents, for-coaches, for-clubs, recruiting-videos, sports, [sport], vs/**, works-with/**, guides/**, 404, llms.txt.ts)
- `src/landing/src/components/*.astro`, `*.tsx` (Cta.astro default heading, Faq, Testimonials, TutorialModal)
- `src/landing/src/data/*.ts` (sports.ts titles, cameras.ts, useCases.ts, comparisons.ts, testimonials.ts, tutorials.ts)
- `src/landing/src/site.ts` (DEFINITION, TAGLINE, HERO_SUBLINE, FACTS), `src/landing/src/content/guides/**`

Findings with lines: [audit/E-landing-backend.md](audit/E-landing-backend.md) A1-A11, B1-B10, H1-H15 and the cross-surface table in section I.

### Related Tasks
- **T7110** (landing homepage value-props copy overhaul, TODO) and **T11650** (signup credits + landing copy, TODO) rewrite overlapping landing copy. Check their status first; if either is still TODO, either do this task first and note it in their files, or fold their copy into this pass. Do not rewrite the same blocks twice.

### Technical Notes
- Landing imports `@editor` modules; run the landing build.
- SEO: keep URLs and slugs unchanged; only titles/headings/body text change.
- Tagline wording changes need the user's approval (memory: tagline set 2026-10-19; T14560 proposes the "in minutes" fix).

## Implementation

1. [ ] Check T7110 / T11650 status and agree the order
2. [ ] Rewrite step names, nouns, athlete, game video, jargon, dashes, spelling
3. [ ] Landing build; grep for retired words (`--`, "clip", "footage" outside camera pages, "player" for the kid, "aspect ratio", "keyframe", British spellings)
4. [ ] Phone + desktop screenshots of home, how-it-works and one sport page

## Acceptance Criteria

- [ ] Landing step names match the app's labels on every page
- [ ] "highlight reel" appears only in titles / FAQ questions or where it means several highlights
- [ ] No "--" dashes, British spellings, or jargon listed above
- [ ] Landing builds; URLs unchanged

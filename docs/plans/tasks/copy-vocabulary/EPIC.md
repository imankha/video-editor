# Copy Vocabulary (2026-11-03 copy audit)

**Status:** TODO
**Started:** 2026-11-03

## Goal

One concept, one word, everywhere a parent reads: the app, the landing site, emails, share
pages and server text. Each word is the one a soccer parent would naturally use. Today the
marked moment has seven names (play, clip, moment, annotation, draft, raw clip, highlight),
"highlight" means six things, the game video has seven names, the paid AI step has eight
verbs, and the landing site uses four step vocabularies, none matching the app.

This supersedes the clip half of the 2026-09-10 object model in
[shared-vocabulary/EPIC.md](../shared-vocabulary/EPIC.md) ("a play produces a clip"). The
user decided on 2026-11-03 that "clip" leaves user copy entirely.

## Sources

- Decision page (user-approved 2026-11-03): https://claude.ai/artifact/6mAdkCVzAktgZ1zWhPWq4j
- Full audit reports, every finding verbatim with file:line (line numbers as of master
  `04b4c0962`, re-grep before editing):
  - [audit/A-catalog.md](audit/A-catalog.md): `config/displayNames.js`, `config/emptyStates.js`,
    quest definitions, constants, `index.html` (read in full)
  - [audit/B-components-AL.md](audit/B-components-AL.md): components A to L, auth, collections,
    instructions, introcards
  - [audit/C-components-MZ.md](audit/C-components-MZ.md): components M to Z, overlay, ranking,
    recap, settings, shared, textspec, timeline
  - [audit/D-modes-screens-logic.md](audit/D-modes-screens-logic.md): modes, screens,
    containers, hooks, stores, utils, services; includes a step-by-step journey of the words seen
  - [audit/E-landing-backend.md](audit/E-landing-backend.md): landing site, `email.py`, share
    and unfurl pages, `HTTPException` detail strings, server-generated names
  - [audit/F-gapfill.md](audit/F-gapfill.md): multi-line JSX text and the 10 busiest screens

## Glossary (user-approved 2026-11-03)

| Concept | Word | Retire in user copy |
|---|---|---|
| Full match recording | **game**; "game video" when the file matters | footage, game film, recording, source video, working video, match video, game file |
| A moment the parent marked, or a short video they uploaded | **play** | clip, moment, annotation, draft, raw clip, highlight |
| The finished video (exists only after the paid AI step) | **highlight** | reel, generated video, final video, export, content, comparison video |
| Several highlights played as one video | **highlight reel** | collection, mix, Mixes, Top Plays, smart |
| All plays from one game, back to back | **game plays**; action **Watch plays** | recap, Team Recap, My Recap, annotations |
| Steps | **Mark plays**, **Frame**, **Spotlight**, **Finish** | Annotate, Framing (as a label), Focus, Overlay, Educate/Elevate/Celebrate |
| The rectangle in Frame | **box**; each placement is a **position** | crop box, focus point, keyframe, spots, rectangle, Pan/Zoom mode |
| The circle on the parent's kid | **spotlight** | highlight layer, Highlight Region, ellipse, player boxes, tracking, region |
| The parent's kid | **athlete** (user decision 2026-11-03: "player" is too generic) | player (for the parent's kid), kid, child |
| Other kids in a play | **teammates** | players, recipients |
| Cut and speed | **trim**, **slow motion** (button may say "Slow-mo"), **section** | segment, boundary, Split Segments, detrim, slo-mo |
| Still image shown before play | **cover** | poster, cover frame, marker |
| Athlete intro | **intro card** | Athlete Intro Card, card, intro |
| Shared team plays | **team plays** / **my athlete's plays** | Team layer, layer |
| Money | **credits**; price packs counted in **highlights** | plays (as a price unit), billed, Usage history, Admin grant |
| Sharing | **Share**, **link**, **people**; **Turn off link** | Revoke, recipients, shared version, share (as a noun), claim, URL |
| Tips toggle | **Guidance** | helpful instructions, Quests, coach |

### Tabs (user decisions D1, D2)

Home tabs read **Games / Plays / Highlights** (today Games / Clips / Finished). The Plays tab
heading is "Plays you're turning into highlights", because the tab holds only the plays the
parent started turning into highlights, not every marked play. Only LABELS change: tab ids
and URLs (`projects`, `/home/reels`) stay frozen for deep links.

### Verbs along the journey (user decision D3)

| Step | Word |
|---|---|
| Add a game | **Upload game** |
| Add another half or camera | **Add video** |
| Mark | **Mark play** |
| Open Frame | **Frame play**; **Continue framing** |
| The paid AI step | **Make highlight**; progress "Making your highlight..."; done "Your highlight is ready" (retires Generate, Export, Generation, Create, Render, Rebuild, Re-generate, Re-run Focus) |
| Spotlight | **Add spotlight**, **Edit spotlight** |
| Finish | **Finish** (moves the highlight to the Highlights tab) |
| Change a finished highlight | **Edit highlight** |
| Watch | **Watch**; before the paid step only, **Check framing** |
| Remove | **Delete**; confirm with "Tap again to confirm" |

### Other decisions

- **D5 landing SEO:** keep "highlight reel" in landing page titles and FAQ questions for
  search; body copy says "highlight" for a single video.
- **D6 low ratings:** 1 and 2 stars read "Needs work: decision" and "Needs work: skill" and are
  never used in play names (bug task T14550).
- The 5-star rating label is "Brilliant", never "Highlight".
- **Not decided:** Portrait/Landscape (app) vs vertical/wide (landing). Keep each surface's
  current words and ask the user before unifying.

## Style rules (apply in every task)

1. **Tap, never Click.** "Click" survives only in hover tooltips on desktop-only controls.
2. **Sentence case** for buttons, titles and labels.
3. **One error voice:** "We couldn't [thing]. Try again." No status codes, raw `err.message`,
   "Failed to", or "Could not". Technical detail goes to the console only.
4. **No dashes as punctuation:** no em dashes, "--" or "->" in shipped copy.
5. **Plurals:** "1 credit" / "2 credits" (also plays, highlights) via one helper.
6. **US spelling:** canceled, defense, centered, organized; field and sideline, not pitch and touchline.
7. **Silent saving:** no "Saved" copy, no "cloud", never ask the user to refresh.
8. **In-app dialogs only:** no native `alert()` / `confirm()` (bug task T14570).
9. **Ellipsis:** three ASCII dots `...` (the dominant style today).
10. **Copy lives in `src/frontend/src/config/displayNames.js`.** Inline strings a task touches move there.
11. **AI capability claims:** the parent frames and picks; the AI proposes and upscales. Never
    claim it tracks, follows or frames on its own.

## Tasks

Bugs first (milestone "Copy audit" in PLAN.md). They do not depend on the glossary sweep.

| ID | Task | Status |
|----|------|--------|
| T14510 | [Sign-in code email heading may be invisible](../T14510-otp-email-heading-invisible.md) | TODO |
| T14520 | [Auto-tracking and AI-focus overclaims](../T14520-tracking-and-ai-focus-overclaims.md) | TODO |
| T14530 | [Developer error text shown to parents (frontend)](../T14530-dev-error-text-frontend.md) | TODO |
| T14540 | [Server error text shown to parents (backend)](../T14540-server-error-text-backend.md) | TODO |
| T14550 | [Harsh rating words in play names and captions](../T14550-harsh-rating-words.md) | TODO |
| T14560 | [Contradictory copy](../T14560-contradictory-copy.md) | TODO |
| T14570 | [Native alert and confirm dialogs](../T14570-native-alert-confirm-dialogs.md) | TODO |

Epic sweep, in order (each one area, one reviewable change):

| ID | Task | Status |
|----|------|--------|
| T14600 | [Glossary reference + Home and tabs](T14600-glossary-home-and-tabs.md) | TODO |
| T14610 | [Mark plays copy](T14610-mark-plays-copy.md) | TODO |
| T14620 | [Frame and the paid step copy](T14620-frame-and-paid-step-copy.md) | TODO |
| T14630 | [Spotlight copy](T14630-spotlight-copy.md) | TODO |
| T14640 | [Sharing, credits, profiles and guidance copy](T14640-sharing-credits-profiles-copy.md) | TODO |
| T14650 | [Landing site vocabulary](T14650-landing-vocabulary.md) | TODO |
| T14660 | [Emails, share pages and server-made names](T14660-emails-share-pages-names.md) | TODO |
| T14670 | [Guard test for banned copy](T14670-banned-copy-guard-test.md) | TODO |

## Related tasks

- T7110 (landing homepage copy overhaul) and T11650 (signup credits + landing copy): coordinate
  with T14650 so landing copy is not rewritten twice.
- T4620 (fetch_or_404, ~34 "not found" wordings): overlaps T14540's "X not found" messages.
- T8950 (credit pricing audit): T14640 changes only the price-pack label ("~N highlights"), not the pricing basis.

## Completion criteria

- [ ] Every glossary row holds across app, landing, emails, share pages and server text
- [ ] No retired word appears in shipped copy (T14670 guard test passes)
- [ ] Phone and desktop walk of the main journey shows one word per concept
- [ ] [.claude/references/ui-style-guide.md](../../../../.claude/references/ui-style-guide.md) links the glossary reference created in T14600

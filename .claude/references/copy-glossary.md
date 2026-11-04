# Copy Glossary

The single vocabulary for everything a parent reads: the app, the landing site, emails,
share pages and server text. One concept, one word. Origin: the 2026-11-03 copy audit
(`docs/plans/tasks/copy-vocabulary/EPIC.md`, user-approved). Copy lives in
`src/frontend/src/config/displayNames.js`; code identifiers (`projects`, `PUBLISHED`,
`ReelTile`, `/home/reels`) keep their names, only visible strings follow this page.
`T14670` adds a guard test that fails on retired words.

## Glossary

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

## Tabs

Home tabs read **Games / Plays / Highlights** (today Games / Clips / Finished). The Plays tab
heading is "Plays you're turning into highlights", because the tab holds only the plays the
parent started turning into highlights, not every marked play. Only LABELS change: tab ids
and URLs (`projects`, `/home/reels`) stay frozen for deep links.

## Verbs along the journey

| Step | Word |
|---|---|
| Add a game | **Upload game** |
| Add another half or camera | **Add video** |
| Mark | **Mark play** |
| Start a highlight from a play (opens Frame) | **Make highlight**; in progress **Continue highlight** (user 2026-11-03: parents don't know what "Frame play" means; they want to make a highlight) |
| The paid AI step (inside Frame) | **Sharpen my highlight** (user pick 2026-11-03); progress "Sharpening your highlight..."; done "Your highlight is ready" (retires Generate, Export, Generation, Create, Render, Rebuild, Re-generate, Re-run Focus) |
| Spotlight | **Add spotlight**, **Edit spotlight** |
| Finish | **Finish** (moves the highlight to the Highlights tab) |
| Change a finished highlight | **Edit highlight** |
| Watch | **Watch**; before the paid step only, **Check framing** |
| Remove | **Delete**; confirm with "Tap again to confirm" |

## Other decisions

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
12. **Name the parent's goal, not our mechanism** (user rule 2026-11-03). Every label and guide line says what the parent wants to get ("Make highlight"), not the tool step it runs ("Frame play"). Test each label: would a parent who has never used the app know why to tap it?

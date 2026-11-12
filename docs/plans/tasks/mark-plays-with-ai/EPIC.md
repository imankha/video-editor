# Epic: Mark plays with AI

## In plain words

Today a parent who uploads a game (the full match video) has to scrub up to ninety minutes and mark every play (a moment worth keeping) by hand. Only 19 of 100 game uploaders go on to pay for a highlight (a finished short clip), against 45 of 100 who arrive with clips already cut, and the scrub is the gap. This epic sells a paid option, "Mark plays with AI": a video model watches the whole game and marks the plays for the parent's team, each with tags, a rating and a coaching note. The parent ticks one box at upload, sees the price in credits before paying, and is told honestly how far along the work is. When it is done they pick their team's kit colour, the strong plays land on the Team line, and a fast tagging screen lets them say which player is which. We charge a little more than the model costs us, and a game that was already analysed for one parent is never analysed again for the next.

**Status:** WAITING ON USER (design review: https://claude.ai/artifact/AfoPPibjtfSS3HKx5ktoh9)
**Filed:** 2026-11-12
**Started:** not started
**Impact:** 9 **Complexity:** 8 **Priority:** 1.1
**Placement:** runs before the Referral programme (owner, 2026-11-12).

## Goal

A parent can pay credits to have a full game marked by the model, at upload time or later on any game they already uploaded, and ends up with tagged, rated, annotated plays for their team that they can assign to players, share, and turn into highlights.

## Owner decisions (2026-11-12, locked)

1. **One tick at upload.** "Mark plays with AI" is a checkbox in the upload dialog. Ticking it raises the credit cost shown, before the upload starts. The price depends on the length of the video; storage keeps its own price by file size.
2. **Honest progress.** The screen says what is really happening and how much is really done. No invented percentages.
3. **Sold as coach-level analysis.** The pitch is a coach's eye on every play, not "auto-clipping".
4. **Out of credits is handled.** A parent who is short can buy credits on the spot and the upload carries on; they can also continue without the AI option.
5. **Start later.** A game with no analysis yet can get one from the game itself, for the same price.
6. **Profitable, but not very.** The price covers the model cost with a modest margin on every credit pack.
7. **Analyse once.** The result is stored against the video itself. A second parent of the same game pays the same price and gets the stored result at once; nothing is computed twice.
8. **Sharing is fine.** Plays that came from an analysis are shared like any other Team-line play.
9. **Model and format are decided.** `gemini-4-hydrogen` at its default thinking level, the JSON format and prompt from the prototype. No other models are evaluated.
10. **Team colour first.** The parent picks their team's kit colour before anything is imported. Only plays with high relevance to that team are imported.
11. **The parent names the players.** The model cannot tell which child is theirs. Imported plays arrive with tags, a note and a rating already filled in; the parent tags the players mentioned or moves a play to the My player line. The tagging screen should be a pleasure to use.
12. **Sport first.** The analysis needs the sport. If the sport is not set when an analysis is requested, the app asks for it there and then. Separately, the play form must offer a sport chooser where tags would be, never a lock-out (T16130).
13. **Chunk and run in parallel.** The video is analysed as consecutive five-minute windows in parallel to keep the wait short.

## What the prototype already measured

The working prototype is in `gemini_analysis_test/` at the repo root. Read `gemini_analysis_test/HANDOFF_PROMPT.md` before any code: it holds the API facts, the prompt, the JSON Schema, the cost model and the list of problems the prototype did not solve. The numbers this epic is built on:

- A 90-minute game is 18 windows and costs about **$2.84** in model fees (likely $2.42 to $3.26). The formula is $0.093 per window plus $0.013 per minute of video, which is about 3.2 cents a minute. File size does not change the cost.
- With all windows in parallel the analysis itself takes about two and a half minutes. Before that, the video has to reach Google and be prepared, which is estimated at five to ten minutes for a full game and has not been measured on a paid key.
- A window yields 19 to 22 plays, of which 8 to 11 are rated 4 or 5 for one team or the other. So a full game may yield 30 to 80 strong plays for one team. T16140 measures the real number.
- Jersey numbers are almost never readable from a sideline camera (0 to 3 numbered players out of 22 to 47 per run). Players are known by team colour and position only. This is why the parent does the naming.
- Nobody has yet checked an answer against the video. T16140 does that before anything is sold.

## Price (proposal, confirmed in T16140, set in T16160)

**1.5 credits per minute of video, rounded up.** A 90-minute game is 135 credits.

| Pack | Credits | Price | We keep per credit after card fees | 90-minute game earns | Model cost | Margin |
|---|---|---|---|---|---|---|
| One Game | 150 | $6.99 | 4.3 cents | $5.84 | $2.84 to $3.27 | about 45% |
| Popular | 340 | $12.99 | 3.6 cents | $4.89 | $2.84 to $3.27 | about 35% |
| Season | 1000 | $29.99 | 2.9 cents | $3.89 | $2.84 to $3.27 | about 16% |

The upper cost of $3.27 allows 15% for windows that have to be watched again. At 1 credit a minute the Season pack would lose money on every game, and at 2 credits a 90-minute game (180 credits) no longer fits in the One Game pack, so 1.5 is the lowest round number that is profitable on every pack and still fits "one pack, one game" with room for storage. A stored result sold to a second parent costs us nothing, so real margins will sit above the table. The rate lives in the pricing file, not in code.

## How it works (locked unless a task file says otherwise)

- **One analysis per video, for everyone.** Results are stored in the shared database against the video's fingerprint, the sport and the prompt version. The analysis covers both teams, so parents on either side reuse it.
- **Per-parent choices stay per parent.** Which team is theirs, which plays were imported, and which players they tagged live in the parent's own data.
- **Charge.** Credits are reserved when the analysis starts, taken when the result is ready, and released in full if it fails. One parent is never charged twice for the same game.
- **Import.** Plays with relevance 4 or 5 for the chosen team become real plays on the Team line with tags, note and rating filled in, and a small AI mark until the parent touches them.
- **Soccer first.** Only soccer has been tested. The prompt takes its tag list from the sport, and other sports are switched on one at a time after a check like T16140.
- **Safety switches.** A kill switch, a daily spend cap, a per-account daily cap and a maximum video length.
- **Feedback.** Every state, every string and every layout is defined in [UX-FEEDBACK.md](UX-FEEDBACK.md), written by the UX designer. UI tasks build from it and do not invent copy.

## Tasks (dependency order)

| ID | Task | Status |
|----|------|--------|
| T16130 | [Sport chooser where tags go](T16130-sport-chooser-where-tags-go.md) | WAITING ON USER |
| T16140 | [AI play marking recall check](T16140-ai-play-marking-recall-check.md) | WAITING ON USER |
| T16150 | [Game analysis engine](T16150-game-analysis-engine.md) | WAITING ON USER |
| T16160 | [AI analysis price and charge](T16160-ai-analysis-price-and-charge.md) | WAITING ON USER |
| T16170 | [AI checkbox at upload](T16170-ai-checkbox-at-upload.md) | WAITING ON USER |
| T16180 | [AI marking for uploaded games](T16180-ai-marking-for-uploaded-games.md) | WAITING ON USER |
| T16190 | [Team colour and play import](T16190-team-colour-and-play-import.md) | WAITING ON USER |
| T16200 | [Tag players in AI plays](T16200-tag-players-in-ai-plays.md) | WAITING ON USER |

T16130 has no dependency and can ship on its own. T16150 to T16200 sit behind one feature flag and are switched on together.

## Needed from the owner

- Turn on billing for the Google project behind the Gemini key. The prototype key is on the free tier (20 requests a day, 2 GB per file), which cannot analyse a full game. T16140 cannot start without it.
- Confirm the price of 1.5 credits a minute after T16140 reports the measured cost.
- Rule on the open questions in section 9 of [UX-FEEDBACK.md](UX-FEEDBACK.md).

## Open questions

- **Free credits.** A new account starts with 88 free credits, enough for about 58 minutes of analysis that earns us nothing (up to about $2 of model cost per new account). Recommendation: accept it at launch, watch it in the admin margin read-out (T16160), and exclude free credits only if it is abused.
- **Disclosure.** Game video of children is sent to Google's Gemini service. The offer carries one plain line saying so; the terms page should gain a sentence. Recommendation: do both in T16170.
- **Rows this replaces.** Roadmap section 3 holds "Suggested plays proof" (T15820) and "Suggested plays feature" (T15830), which describe an earlier, cheaper-model version of the same idea. Recommendation: remove both once this epic is accepted. They are untouched until the owner rules.

## Completion criteria

- [ ] A parent can tick the box at upload, see the price before paying, and get marked plays for their team on a real 90-minute soccer game.
- [ ] A parent can start the same thing on a game uploaded earlier.
- [ ] A parent without enough credits can buy more without losing their upload.
- [ ] A second account uploading the same video is charged and receives the stored result with no new model calls.
- [ ] Every progress state shown matches what the server is doing; a failed analysis releases the credits.
- [ ] The admin read-out shows credits charged against model cost per analysis, and the total is positive.
- [ ] Imported plays carry tags, note and rating, sit on the Team line, and can be tagged or moved to My player from the tagging screen on a phone.
- [ ] The Journey shows how many game uploaders bought an analysis and how many of them reached a first highlight.

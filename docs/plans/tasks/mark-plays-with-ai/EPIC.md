# Epic: Mark plays with AI

## In plain words

Today a parent who uploads a game (the full match video) has to scrub up to ninety minutes and mark every play (a moment worth keeping) by hand. Only 19 of 100 game uploaders go on to pay for a highlight (a finished short clip), against 45 of 100 who arrive with clips already cut, and the scrub is the gap. This epic sells a paid option, "Mark plays with AI": a video model watches the whole game and marks the plays for the parent's team, each with tags, a rating and a coaching note. The parent ticks one box at upload, sees the price in credits before paying, and is told honestly how far along the work is. When it is done they pick their team's kit colour, the strong plays land in the Team lane, and a fast tagging screen lets them say which player is which. We charge a little more than the model costs us, and a game that was already analysed for one parent is never analysed again for the next.

**Status:** TODO
**Filed:** 2026-11-12
**Started:** not started
**Impact:** 9 **Complexity:** 8 **Priority:** 1.1
**Placement:** runs before the Referral programme (owner, 2026-11-12).
**Design:** approved by the owner on 2026-11-12 (all 13 screens; review page https://claude.ai/artifact/AfoPPibjtfSS3HKx5ktoh9).

## Goal

A parent can pay credits to have a full game marked by the model, at upload time or later on any game they already uploaded, and ends up with tagged, rated, annotated plays for their team that they can assign to players, share, and turn into highlights.

## Owner decisions (2026-11-12, locked)

From the request:

1. **One tick at upload.** "Mark plays with AI" is a checkbox in the upload dialog. Ticking it raises the credit cost shown, before the upload starts. The price depends on the length of the video; storage keeps its own price by file size.
2. **Honest progress.** The screen says what is really happening and how much is really done. No invented percentages.
3. **Sold as coach-level analysis.** The pitch is a coach's eye on every play, not "auto-clipping".
4. **Out of credits is handled.** A parent who is short can buy credits on the spot and the upload carries on; they can also continue without the AI option.
5. **Start later.** A game with no analysis yet can get one from the game itself, for the same price.
6. **Profitable, but not very.** The price covers the model cost with a modest margin on every credit pack.
7. **Analyse once.** The result is stored against the video itself. A second parent of the same game pays the same price and gets the stored result at once; nothing is computed twice.
8. **Sharing is fine.** Plays that came from an analysis are shared like any other play in the Team lane.
9. **Model and format are decided.** `gemini-4-hydrogen` at its default thinking level, the JSON format and prompt from the prototype. No other models are evaluated.
10. **Team colour first.** The parent picks their team's kit colour before anything is imported. Only plays with high relevance to that team are imported.
11. **The parent names the players.** The model cannot tell which child is theirs. Imported plays arrive with tags, a note and a rating already filled in; the parent tags the players mentioned or moves a play to My athlete. The tagging screen should be a pleasure to use.
12. **Sport first.** The analysis needs the sport. If the sport is not set when an analysis is requested, the app asks for it there and then. Separately, the play form must offer a sport chooser where tags would be, never a lock-out (T16130).
13. **Chunk and run in parallel.** The video is analysed as consecutive five-minute windows in parallel to keep the wait short.

From the design review:

14. **Price: 1.5 credits a minute.** 135 credits for a 90-minute game.
15. **The box starts unticked.**
16. **Free credits can pay.** Credits are credits; the cost of analyses bought with free credits is watched in the admin read-out.
17. **AI plays arrive as real plays** in the Team lane, marked as AI until the parent touches them. Plays with relevance 4 or 5 for the chosen team are imported.
18. **A finished analysis is always charged,** even when it finds few plays. Credits come back only when the analysis does not finish.
19. **Cancel is free until the upload finishes.** There is no cancel once the analysis has started.
20. **Lane names do not change.** The feature uses the labels the app shows today.
21. **Moving and editing plays do not change.** A parent can move a play between My athlete and Team and edit it, as today. Moving an AI play does not rewrite its tags, rating or note. The rule that the athlete's own plays carry no teammate names stays.
22. **Remembered positions are suggestions** for the current game only, and the parent can always change the answer.
23. **No recall check before building.** The model is decided; the first full-game measurements come from the engine's own staging run (T16150).
24. **Tagging a teammate is the existing flow.** It means entering the player's name and email address, which gives that family the game and the plays in its Team lane. That flow is not changed; it only has to be easy to reach from each player the model mentions ("Right winger", "Player 10").
25. **The older Suggested plays rows are removed** (T15820, T15830); this epic replaces them.
26. **Both teams, always.** The analysis covers both teams and the parent picks their colour afterwards. Analysing one team only was tested on 2026-11-12 and dropped. There is no per-player analysis.

For the AI reel builder (owner, 2026-11-13):

27. **Each strong action says what it demonstrates.** For every player's part in a play, the model also records one to three qualities from a fixed list for the sport and one plain sentence saying what the action shows about the player. A quality is what the play shows about the athlete (separation, vision, composure); a tag is what happened (Goal, Tackle). This is in the first version of the prompt, because an analysis is stored once per video and adding it later would mean analysing every stored game again. The list comes from the recruiting reel research (T16320), which runs before the engine.
28. **Worked backwards from what coaches look for.** The analysis is told to hunt for the things coaches scout, using the visible signs the research writes for each quality. Every sign is written as something the player does relative to another player in the frame (owner, 2026-11-13). A camera cannot measure how fast a player is, but it can show a player pulling away from an opponent, catching one who started ahead, or jumping higher than one. So the list says "separation" where coaches say "pace", and no sign depends on a distance, a speed, or what a player sees or feels. A play in which one of the team's players clearly demonstrates a quality is scoutable.
29. **Two ways to be Brilliant.** A play is rated Brilliant when the player did better than a good player at that level would be expected to do (owner, 2026-11-13, ruling on T16320). It can clear that bar for scouting, by showing both a strong decision and strong execution and at least one quality from the sport's list, or for social media, by being the kind of play players see in highlight videos of their favorite players. Learning opportunities are found too and keep their lesson, but they are never Brilliant and never reach the reel builder. Both count equally, and a play can be both. Every Brilliant play is always imported. The note and the stored detail say which kind it is, so a recruiting reel can draw on the scoutable ones and a social post on the impressive ones. No other play is rated Brilliant.
30. **Find as many as possible.** Brilliant plays are what parents pay to turn into highlights, so a missed one is lost revenue and the worst mistake the analysis can make. The prompt hunts for both kinds by name and includes a moment when unsure; the staging check counts the ones it missed.
31. **Everything the reel builder needs in one read.** The [AI reel builder](../ai-reel-builder/EPIC.md), planned after the reel builder, reads text only. This epic ends by proving that one call returns every fact it needs about an athlete's highlights (T16205).

For team mix-ups (owner, 2026-11-13):

32. **One play can be marked as the other team's.** The model sometimes credits a play to the wrong team. Switching the whole game (decision 10) fixes a wrong colour choice, not a single wrong play, so each AI play the parent has not touched carries a "Wrong team" button that removes it, keeps it from coming back, and counts the miss (T16190).

## What the prototype already measured

The working prototype is in `gemini_analysis_test/` at the repo root. Read `gemini_analysis_test/HANDOFF_PROMPT.md` before any code: it holds the API facts, the prompt, the JSON Schema, the cost model and the list of problems the prototype did not solve. The numbers this epic is built on:

- A 90-minute game is 18 windows and costs about **$2.84** in model fees (likely $2.42 to $3.26). The formula is $0.093 per window plus $0.013 per minute of video, which is about 3.2 cents a minute. File size does not change the cost.
- With all windows in parallel the analysis itself takes about two and a half minutes. Before that, the video has to reach Google and be prepared, which is estimated at five to ten minutes for a full game and has not been measured on a paid key.
- A window yields 19 to 22 plays, of which 8 to 11 are rated 4 or 5 for one team or the other. So a full game may yield 30 to 80 strong plays for one team.
- Jersey numbers are almost never readable from a sideline camera (0 to 3 numbered players out of 22 to 47 per run). Players are known by team colour and position only. This is why the parent does the naming.

**One-team test (2026-11-12).** The owner asked whether analysing only the parent's team, chosen by tapping a player first, would be cheaper and better. Ten calls on the 20-minute test video said no: about $2.48 a game instead of $2.84 with only 22 cents of that reliable, half as many plays written per window, and no more strong plays for the chosen team. The same calls showed problems the engine must handle: most answers counted time from the start of the window rather than the video, one answer credited a team with the other's actions, three answers reported a goal that did not happen, and the number of strong plays in one window moved between 4 and 7 across repeats. Details are in `gemini_analysis_test/TEAM_ONLY_RESULTS.md`; the fixes and a human check of the staging game are in T16150.

What is still unmeasured, and will first be seen on T16150's staging run: the real cost and wait for a full game on a paid key, how many strong plays a full game returns per team, and how many real highlights the model misses. Nobody has compared an answer with the video. The admin read-out (T16160) and the threshold and rating constants (T16190) are where these get corrected after launch.

## Price

**1.5 credits per minute of video, rounded up.** A 90-minute game is 135 credits.

| Pack | Credits | Price | We keep per credit after card fees | 90-minute game earns | Model cost | Margin |
|---|---|---|---|---|---|---|
| One Game | 150 | $6.99 | 4.3 cents | $5.84 | $2.84 to $3.27 | about 45% |
| Popular | 340 | $12.99 | 3.6 cents | $4.89 | $2.84 to $3.27 | about 35% |
| Season | 1000 | $29.99 | 2.9 cents | $3.89 | $2.84 to $3.27 | about 16% |

The upper cost of $3.27 allows 15% for windows that have to be watched again. At 1 credit a minute the Season pack would lose money on every game, and at 2 credits a 90-minute game (180 credits) no longer fits in the One Game pack, so 1.5 is the lowest round number that is profitable on every pack and still fits "one pack, one game" with room for storage. A stored result sold to a second parent costs us nothing, so real margins will sit above the table. A new account's 88 free credits buy about 58 minutes of analysis that earns nothing, up to about $2 of model cost per new account. The rate lives in the pricing file, not in code.

## How it works (locked unless a task file says otherwise)

- **One analysis per video, for everyone.** Results are stored in the shared database against the video's fingerprint, the sport and the prompt version. The analysis covers both teams, so parents on either side reuse it.
- **Per-parent choices stay per parent.** Which team is theirs, which plays were imported, and which players they tagged live in the parent's own data.
- **Charge.** Credits are reserved when the analysis starts, taken when the result is ready, and released in full if it does not finish. One parent is never charged twice for the same game.
- **Import.** Plays with relevance 4 or 5 for the chosen team, and every Brilliant play (scoutable, or impressive for social media), become real plays in the Team lane with tags, note and rating filled in, and a small AI mark until the parent touches them.
- **Soccer first.** Only soccer has been tried. The prompt takes its tag list from the sport, and other sports are switched on one at a time.
- **Safety switches.** A kill switch, a daily spend cap, a per-account daily cap and a maximum video length.
- **Feedback.** Every state, every string and every layout is defined in [UX-FEEDBACK.md](UX-FEEDBACK.md), written by the UX designer and approved by the owner. Its section 9 holds the owner's rulings and wins where it differs from earlier text. UI tasks build from it and do not invent copy.
- **Disclosure.** Game video of children is sent to Google's Gemini service. The offer carries one plain line saying so, and the terms page gains a sentence (T16170).

## Tasks (dependency order)

| ID | Task | Status |
|----|------|--------|
| T16130 | [Sport chooser where tags go](T16130-sport-chooser-where-tags-go.md) | TODO |
| T16150 | [Game analysis engine](T16150-game-analysis-engine.md) | TODO |
| T16160 | [AI analysis price and charge](T16160-ai-analysis-price-and-charge.md) | TODO |
| T16170 | [AI checkbox at upload](T16170-ai-checkbox-at-upload.md) | TODO |
| T16180 | [AI marking for uploaded games](T16180-ai-marking-for-uploaded-games.md) | TODO |
| T16190 | [Team colour and play import](T16190-team-colour-and-play-import.md) | TODO |
| T16200 | [Tag players in AI plays](T16200-tag-players-in-ai-plays.md) | TODO |
| T16205 | [Highlight facts in one read](T16205-highlight-facts-in-one-read.md) | TODO |

T16130 has no dependency and can ship on its own. T16150 to T16200 sit behind one feature flag and are switched on together. T16150 waits for the quality list from the recruiting reel research ([T16320](../ai-reel-builder/T16320-recruiting-reel-research.md)).

## Needed from the owner

- Turn on billing for the Google project behind the Gemini key. The prototype key is on the free tier (20 requests a day, 2 GB per file), which cannot analyse a full game. T16150 cannot be proven on staging without it.

## Completion criteria

- [ ] A parent can tick the box at upload, see the price before paying, and get marked plays for their team on a real 90-minute soccer game.
- [ ] A parent can start the same thing on a game uploaded earlier.
- [ ] A parent without enough credits can buy more without losing their upload.
- [ ] A second account uploading the same video is charged and receives the stored result with no new model calls.
- [ ] Every progress state shown matches what the server is doing; an analysis that does not finish releases the credits.
- [ ] On the staging game a person has compared six windows with the video, and the owner has seen how many plays were credited to the wrong team and how many reported goals were not real, before the feature is switched on.
- [ ] The admin read-out shows credits charged against model cost per analysis, and the total is positive.
- [ ] Imported plays carry tags, note and rating, sit in the Team lane, and can be moved to My athlete or have a teammate tagged by name and email from the tagging screen on a phone.
- [ ] A parent can mark one AI play as the other team's; it is removed and does not come back, and the count of such plays is visible to the owner.
- [ ] A teammate tagged from the tagging screen receives the game and its Team plays exactly as they would today.
- [ ] A play marked by the AI, assigned to the parent's athlete and made into a highlight, returns its qualities and its sentence in the one read of highlight facts.
- [ ] The Journey shows how many game uploaders bought an analysis and how many of them reached a first highlight.

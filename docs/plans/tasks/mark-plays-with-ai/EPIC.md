# Epic: AI Coach

## In plain words

Today a parent who uploads a game (the full match video) has to scrub up to ninety minutes and mark every play (a moment worth keeping) by hand. Only 19 of 100 game uploaders go on to pay for a highlight (a finished short clip), against 45 of 100 who arrive with clips already cut, and the scrub is the gap. This epic sells a paid option called AI Coach: a video model watches the whole game and marks the plays for the parent's team, each with tags, a rating and a coaching note. While the game uploads, a dialog offers it with the price in credits, and the same offer is on every game afterwards. The parent is told honestly how far along the work is. When it is done they pick their team's kit colour, the strong plays land in the Team lane, and a fast tagging screen lets them say which player is which. One payment covers the team: a game with AI Coach can be shared with other families, who get it free, and that is how we expect the feature to spread. We charge a little more than the model costs us, and a game is never analysed twice. What we ask the model, and the format it answers in, is tried in the prototype and shown to the owner before it is built.

**Status:** TODO
**Filed:** 2026-11-12
**Started:** not started
**Impact:** 9 **Complexity:** 8 **Priority:** 1.1
**Placement:** runs before the Referral programme (owner, 2026-11-12).
**Design:** progress, team choice, AI plays, tagging and the sport chooser were approved by the owner on 2026-11-12 (review page https://claude.ai/artifact/AfoPPibjtfSS3HKx5ktoh9). The offer dialog, the short-of-credits flow, starting from a game, and sharing (UX-FEEDBACK.md sections 1, 2, 4 and 11) were drawn on 2026-11-14 and the owner ruled on them the same day (decisions 35 to 44; review page https://claude.ai/artifact/Xm83MkV831gV5xMwJmvzz7). All four are approved as they now stand (decisions 36, 40 and 45).

## Goal

A parent can pay credits to have a full game marked by the model, at upload time or later on any game they already uploaded, and ends up with tagged, rated, annotated plays for their team that they can assign to players, turn into highlights, and share with other families, who get the same thing free.

## Owner decisions (locked)

From the request (2026-11-12, except where a later date is given):

1. **Offered in its own dialog, once the upload is running** (owner, 2026-11-14). The upload dialog does not change. When the upload has started, a separate dialog offers AI Coach with an example, the exact price for this game and the free-share promise. The parent is waiting anyway, and saying no or being short of credits can never hold up the upload. The price depends on the length of the video; storage keeps its own price by file size.
2. **Honest progress.** The screen says what is really happening and how much is really done. No invented percentages.
3. **Sold as coach-level analysis.** The pitch is a coach's eye on every play, not "auto-clipping".
4. **Out of credits is handled.** A parent who is short can buy credits on the spot and the upload carries on; they can also continue without the AI option.
5. **Start later.** A game without AI Coach offers it from the game itself, for the same price, through the same dialog as at upload. It is reachable on the game's page and from the game's menu, but it is not one of the page's main action cards (decision 40).
6. **Profitable, but not very.** The price covers the model cost with a modest margin on every credit pack.
7. **Analyse once.** The result is stored against the video itself and nothing is computed twice. A parent who uploads the same video on their own, without a share, pays the same price and gets the stored result at once.
8. **One payment covers the team** (owner, 2026-11-14). When a parent who has AI Coach on a game shares that game, the receiving family gets the full AI Coach on it for free: the AI plays, the tagging screen to find their own child, the "Wrong team" button and the team switch. They can share it on. The app says "Pay once. Share it with your whole team for free." wherever AI Coach is sold and wherever a game is shared. A receiver costs us nothing, because the analysis already exists, and is a family that has now used the product (T16202).
9. **The model is decided; the prompt and format go through the prototype first** (owner, 2026-11-14). The model is `gemini-4-hydrogen` at its default thinking level, and no other models are evaluated. Any change to what we ask the model or to the format of its answer is first made in the prototype, run on test video, and the latest output files are shown to the owner, who iterates until satisfied. Only an approved version is built into the server, and a test fails if the two differ (T16145).
10. **Team colour first.** The parent picks their team's kit colour before anything is imported. Only plays with high relevance to that team are imported.
11. **The parent names the players.** The model cannot tell which child is theirs. Imported plays arrive with tags, a note and a rating already filled in; the parent tags the players mentioned or moves a play to My athlete. The tagging screen should be a pleasure to use.
12. **Sport first.** The analysis needs the sport. If the sport is not set when an analysis is requested, the app asks for it there and then. Separately, the play form must offer a sport chooser where tags would be, never a lock-out (T16130).
13. **Five-minute pieces, overlapping by 30 seconds, in parallel** (owner, 2026-11-14). The video is analysed as five-minute windows run at the same time to keep the wait short. Each window runs 30 seconds into the next, so a play on the line between two windows is seen whole by at least one of them. The windows' answers are joined by code that keeps the complete version of a play over a cut-off one, never lists the same moment twice, and stitches a play too long for the overlap (T16145 defines it).

From the design review:

14. **Price: 1.5 credits a minute.** 135 credits for a 90-minute game.
15. **Never added without the parent's tap.** Nothing in the offer is selected in advance.
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

For the name and the teams (owner, 2026-11-14):

33. **The result says which way each team attacked.** At the top of the stored result, next to each team's kit colour, is the direction that team attacked in the first period, as the camera saw it. Each window reports the direction it sees, and the joining works out the rest. Windows sometimes disagree about which team is which, and the direction is a second, independent sign of that alongside the colour; the overlap is a third, because the same 30 seconds are described twice. A window that disagrees with its neighbours is watched again with a second, narrower question (decision 42), and a play whose team is still in doubt is recorded and counted (decision 45). The team chooser also shows the direction, as a second way for the parent to recognise their team.
34. **Called AI Coach.** That is the name on every screen. "Coach-level analysis of the whole game" is its one-line promise.

From the owner's review of the open choices (2026-11-14):

35. **The offer carries no small print.** The "Good to know" paragraph, the line about Google's Gemini service and the note about credits being set aside are removed from the offer. What they described still happens; the terms page says where the video is analysed.
36. **The free-share promise looks like a celebration.** It keeps its own panel under the benefit lines, drawn as a gold ribbon: a gold border, a gold "FREE FOR YOUR TEAM" label and a bold heading. The plain tinted box was too quiet.
37. **Examples rotate.** A bank of real AI plays, each with its picture and coaching note, is kept for each sport. The offer shows the bank for the sport being analysed and moves to the next example every 5 seconds. Soccer starts with six that the owner picks from the first approved prototype run.
38. **Three "Not now" answers in a row** stop the offer opening by itself. Buying AI Coach once turns it back on.
39. **Buying the missing credits from the offer also adds AI Coach,** with no second tap.
40. **Not a main action on the game's page.** A parent who skipped AI Coach at upload has shown it is a lower priority, so on the Annotate page it sits below the four main action cards. The UX designer drew, and the owner approved, one quiet line under the cards, "Let AI Coach mark the plays", with the game's menu as a second door; once AI Coach is bought, its progress, the team choice and "Tag players" appear in the status card above the action cards, which is where a paid-for thing belongs.
41. **A share works as it does today.** The receiving family gets the sharer's team plays, cleaned up by the sharer and not specific to the sharer's own child, and AI Coach travels with them. There is no separate fresh set. Tags the sharer made for the receiver's child arrive as suggestions. Receivers can share on. Families the game was shared with before AI Coach was bought get it automatically, with an email. A receiving family is sold AI Coach with one quiet line after their first pass and one line in their next upload's offer, and no email.
42. **A second question settles a suspect window.** A window that disagrees with its neighbours about which team is which is watched again once, with a narrower question that asks only who is who and is given everything that helps: the colours, the neighbours' directions, the plays from the overlaps and the window's own plays. A play it gives to the other team is turned over; a play it cannot tell is marked. This question goes through the prototype like the first (T16145).
43. **Joining details.** A cut-off play with no whole version is kept only when it is rated 4 or 5. Both wordings for the attack direction are run on the same video and the owner picks from the counts. The team chooser shows each team's direction.
44. **The price stays** at 1.5 credits a minute and is looked at again after the first 50 paid games, with their real cost.
45. **A play whose team stays in doubt gets no screen of its own yet.** The analysis records and counts such plays, and the prototype and the staging run report how many there are. Until one has been seen in real results, the app treats it like any other AI play. The owner ruled that we do not design for a state we have not seen.

For the AI reel builder (owner, 2026-11-13):

27. **Each strong action says what it demonstrates.** For every player's part in a play, the model also records one to three qualities from a fixed list for the sport and one plain sentence saying what the action shows about the player. A quality is what the play shows about the athlete (separation, vision, composure); a tag is what happened (Goal, Tackle). This is in the first version of the prompt, because an analysis is stored once per video and adding it later would mean analysing every stored game again. The list comes from the recruiting reel research (T16320), which runs before the engine.
28. **Worked backwards from what coaches look for.** The analysis is told to hunt for the things coaches scout, using the visible signs the research writes for each quality. Every sign is written as something the player does relative to another player in the frame (owner, 2026-11-13). A camera cannot measure how fast a player is, but it can show a player pulling away from an opponent, catching one who started ahead, or jumping higher than one. So the list says "separation" where coaches say "pace", and no sign depends on a distance, a speed, or what a player sees or feels. A play in which one of the team's players clearly demonstrates a quality is scoutable.
29. **Two ways to be Brilliant.** A play is rated Brilliant when the player did better than a good player at that level would be expected to do (owner, 2026-11-13, ruling on T16320). It can clear that bar for scouting, by showing both a strong decision and strong execution and at least one quality from the sport's list, or for social media, by being the kind of play players see in highlight videos of their favorite players. Learning opportunities are found too and keep their lesson, but they are never Brilliant and never reach the reel builder. Both count equally, and a play can be both. Every Brilliant play is always imported. The note and the stored detail say which kind it is, so a recruiting reel can draw on the scoutable ones and a social post on the impressive ones. No other play is rated Brilliant.
30. **Find as many as possible.** Brilliant plays are what parents pay to turn into highlights, so a missed one is lost revenue and the worst mistake the analysis can make. The prompt hunts for both kinds by name and includes a moment when unsure; the staging check counts the ones it missed.
31. **Everything the reel builder needs in one read.** The [AI reel builder](../ai-reel-builder/EPIC.md), planned after the reel builder, reads text only. This epic ends by proving that one call returns every fact it needs about an athlete's highlights (T16205).

For team mix-ups (owner, 2026-11-13):

32. **One play can be flipped to the other team's side.** The model sometimes has the teams the wrong way round on a play. Switching the whole game (decision 10) fixes a wrong colour choice, not a single wrong play. The stored result describes every play twice, once for each team, and a play that is good for one team is bad for the other, so each AI play carries a "Wrong team" button that keeps the play and shows it from the other team's section: new tags, rating, note and players. Removing the play was ruled out as no more help than deleting it. The flip is remembered and counted (T16190).

## What the prototype already measured

The working prototype is in `gemini_analysis_test/` at the repo root. Read `gemini_analysis_test/HANDOFF_PROMPT.md` before any code: it holds the API facts, the prompt, the JSON Schema, the cost model and the list of problems the prototype did not solve. These numbers were measured on windows without an overlap; T16145 measures them again with it. The numbers this epic is built on:

- A 90-minute game is 18 windows and costs about **$2.84** in model fees without an overlap (likely $2.42 to $3.26). The formula is $0.093 per window plus $0.013 per minute of video, which is about 3.2 cents a minute. File size does not change the cost. The 30-second overlap adds eight and a half minutes of video across the 17 joins, about 11 cents, so the working estimate is **$2.95**.
- With all windows in parallel the analysis itself takes about two and a half minutes. Before that, the video has to reach Google and be prepared, which is estimated at five to ten minutes for a full game and has not been measured on a paid key.
- A window yields 19 to 22 plays, of which 8 to 11 are rated 4 or 5 for one team or the other. So a full game may yield 30 to 80 strong plays for one team.
- Jersey numbers are almost never readable from a sideline camera (0 to 3 numbered players out of 22 to 47 per run). Players are known by team colour and position only. This is why the parent does the naming.

**One-team test (2026-11-12).** The owner asked whether analysing only the parent's team, chosen by tapping a player first, would be cheaper and better. Ten calls on the 20-minute test video said no: about $2.48 a game instead of $2.84 with only 22 cents of that reliable, half as many plays written per window, and no more strong plays for the chosen team. The same calls showed problems the engine must handle: most answers counted time from the start of the window rather than the video, one answer credited a team with the other's actions, three answers reported a goal that did not happen, and the number of strong plays in one window moved between 4 and 7 across repeats. Details are in `gemini_analysis_test/TEAM_ONLY_RESULTS.md`; the fixes and a human check of the staging game are in T16150.

What the prototype task (T16145) measures next, on 20-minute test videos: whether the overlap and the joining leave any play cut or doubled, how often windows mix the teams up with and without the direction, and what the new fields cost. What is still unmeasured after that, and will first be seen on T16150's staging run: the real cost and wait for a full game on a paid key, how many strong plays a full game returns per team, and how many real highlights the model misses. Nobody has compared an answer with the video. The admin read-out (T16160) and the threshold and rating constants (T16190) are where these get corrected after launch.

## Price

**1.5 credits per minute of video, rounded up.** A 90-minute game is 135 credits.

| Pack (label in the app) | Credits | Price | We keep per credit after card fees | 90-minute game earns | Model cost | Margin |
|---|---|---|---|---|---|---|
| Starter | 150 | $6.99 | 4.3 cents | $5.84 | $2.95 to $3.39 | about 42% |
| Popular | 340 | $12.99 | 3.6 cents | $4.89 | $2.95 to $3.39 | about 31% |
| Best value | 1000 | $29.99 | 2.9 cents | $3.89 | $2.95 to $3.39 | about 13% |

The upper cost of $3.39 allows 15% for windows that have to be watched again, and the margin column is worked out against it. The app describes a pack by roughly how many highlights it covers and never promises a game or a season, so the offer names a pack only by its credits and price. At 1 credit a minute the largest pack would lose money on every game, and at 2 credits a 90-minute game (180 credits) no longer fits in the smallest pack, so 1.5 is the lowest round number that is profitable on every pack and lets the smallest pack cover one game with room for storage. The owner will look at the price again after the first 50 paid games (decision 44). Each game is paid for once: families who receive it through a share pay nothing, so the table is the whole margin on a game and there is rarely a second sale to lift it. What a free receiver is worth is measured instead (T16202): how many are new accounts, and how many buy AI Coach for a game of their own. A new account's 88 free credits buy about 58 minutes of analysis that earns nothing, up to about $2 of model cost per new account. The rate lives in the pricing file, not in code.

## How it works (locked unless a task file says otherwise)

- **Prototype first.** The prompt and the answer format live in the prototype. The server's copy must equal the version the owner approved, and a test enforces it.
- **One analysis per video, for everyone.** Results are stored in the shared database against the video's fingerprint, the sport and the prompt version. The analysis covers both teams, so parents on either side reuse it.
- **Overlap and joining.** Windows start every five minutes and run 30 seconds into the next. Joining keeps complete plays over cut-off ones, removes doubles, stitches plays longer than the overlap, and keeps a report of every decision beside the result.
- **Three checks on which team is which.** Kit colour named in words to every window; attack direction, which must agree among the windows of one period; and the overlap, where two windows describe the same seconds. A suspect window is watched again once with a second, narrower question that asks only who is who. A play still in doubt after that is recorded and counted, not shown differently.
- **Per-parent choices stay per parent.** Which team is theirs, which plays were imported, and which players they tagged live in the parent's own data.
- **Charge.** Credits are reserved when the analysis starts, taken when the result is ready, and released in full if it does not finish. One parent is never charged twice for the same game. A family that receives the game through a share is recorded as having AI Coach at no charge.
- **Import.** Plays with relevance 4 or 5 for the chosen team, and every Brilliant play (scoutable, or impressive for social media), become real plays in the Team lane with tags, note and rating filled in, and a small AI mark until the parent touches them.
- **Soccer first.** Only soccer has been tried. The prompt takes its tag list from the sport, and other sports are switched on one at a time.
- **Safety switches.** A kill switch, a daily spend cap, a per-account daily cap and a maximum video length.
- **Feedback.** Every state, every string and every layout is defined in [UX-FEEDBACK.md](UX-FEEDBACK.md), written by the UX designer and approved by the owner. Its section 9 holds the owner's rulings and wins where it differs from earlier text. UI tasks build from it and do not invent copy.
- **Sharing.** A share of a game with AI Coach carries AI Coach. The receiver gets the sharer's team plays as the share delivers them today, with what the AI wrote kept on each AI play. A game shared before the purchase is brought up to date for its receivers when the AI plays are added.
- **Disclosure.** Game video of children is sent to Google's Gemini service. The terms page gains a sentence saying so (T16170). The offer does not carry the line (decision 35).

## Tasks (dependency order)

| ID | Task | Status |
|----|------|--------|
| T16130 | [Sport chooser where tags go](T16130-sport-chooser-where-tags-go.md) | TODO |
| T16145 | [Prototype the prompt and the joining](T16145-prototype-prompt-and-joining.md) | TODO |
| T16150 | [Game analysis engine](T16150-game-analysis-engine.md) | TODO |
| T16160 | [AI analysis price and charge](T16160-ai-analysis-price-and-charge.md) | TODO |
| T16170 | [AI Coach offer after upload](T16170-ai-coach-offer-after-upload.md) | TODO |
| T16180 | [AI Coach for uploaded games](T16180-ai-coach-for-uploaded-games.md) | TODO |
| T16190 | [Team colour and play import](T16190-team-colour-and-play-import.md) | TODO |
| T16200 | [Tag players in AI plays](T16200-tag-players-in-ai-plays.md) | TODO |
| T16202 | [Share AI Coach for free](T16202-share-ai-coach-free.md) | TODO |
| T16205 | [Highlight facts in one read](T16205-highlight-facts-in-one-read.md) | TODO |

T16130 has no dependency and can ship on its own. T16145 is done with the owner in an interactive session and changes no app code; it waits for the quality list from the recruiting reel research ([T16320](../ai-reel-builder/T16320-recruiting-reel-research.md)), and T16150 waits for the version the owner approves in it. T16150 to T16202 sit behind one feature flag and are switched on together.

## Needed from the owner

- Read the prototype's output files in T16145 and approve a version of the prompt and format.
- Choose six soccer example plays for the offer from the first approved prototype run.

## Completion criteria

- [ ] The owner has read the prototype's latest output files and approved the prompt and format the server uses; the server's copy equals it.
- [ ] A parent can accept the offer shown while a game uploads, see the price before paying, and get marked plays for their team on a real 90-minute soccer game. The upload dialog is unchanged.
- [ ] A parent can start the same thing on a game uploaded earlier.
- [ ] A parent without enough credits can buy more without losing their upload.
- [ ] A second account uploading the same video is charged and receives the stored result with no new model calls.
- [ ] A second account that receives the game through a share pays nothing and can find its own athlete's plays; the owner can see receivers per paid analysis and how many later bought.
- [ ] On the staging game no play is cut off at a line between two windows and no moment is listed twice, and the stored result names each team's colour and first-period attack direction.
- [ ] Every progress state shown matches what the server is doing; an analysis that does not finish releases the credits.
- [ ] On the staging game a person has compared six windows with the video, and the owner has seen how many plays were credited to the wrong team and how many reported goals were not real, before the feature is switched on.
- [ ] The admin read-out shows credits charged against model cost per analysis, and the total is positive.
- [ ] Imported plays carry tags, note and rating, sit in the Team lane, and can be moved to My athlete or have a teammate tagged by name and email from the tagging screen on a phone.
- [ ] A parent can flip one AI play to the other team's side of it; the play stays, its tags, rating and note change, it stays flipped, and the count of flipped plays is visible to the owner.
- [ ] A teammate tagged from the tagging screen receives the game and its Team plays exactly as they would today.
- [ ] A play marked by the AI, assigned to the parent's athlete and made into a highlight, returns its qualities and its sentence in the one read of highlight facts.
- [ ] The Journey shows how many game uploaders bought an analysis and how many of them reached a first highlight.

## Changed 2026-11-20 (owner): no player boxes

The analysis does not say where a player is on screen. The prototype tried it: boxes from the video call were not on the players, and boxes from still frames cost more than the analysis itself. Nothing in this epic stores or draws a box. The research is kept for the Click-once Spotlight milestone: [click-once-spotlight/RESEARCH-gemini-boxes-2026-11-20.md](../click-once-spotlight/RESEARCH-gemini-boxes-2026-11-20.md).

## Added 2026-11-20 (owner): skip dead time

The analysis writes each stoppage down as its own entry. T16206 uses them: a parent watching a game with AI Coach can skip the dead stretches in playback. T16150 keeps the stoppages in the stored result and T16190's read returns them.

## Go or no-go gate (owner, 2026-11-20)

The epic is gated on one question, answered by the prototype (T16145 step 9): does the analysis find a child's highlights, with no false statements about the game? No parent pays without that; coaching notes are secondary. Cost decides how many parents try it, not whether it ships, so the earlier $3.39 cost ceiling is lifted and the price follows from the configuration that works. If none reaches the bar, the epic is shelved until models improve. T16150 and every task after it wait for the owner's go; the price helpers and ledger groundwork already built in T16160 stand either way.

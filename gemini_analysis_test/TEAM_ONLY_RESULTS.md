# One-team analysis: results (measured 2026-11-12)

## Summary

- One-team mode works mechanically: the kit picture plus colour words fixed the requested team as
  `team_0` in 7 of 7 answers, with the existing schema unchanged.
- It is a little cheaper: about **$2.48 for a 90-minute game against $2.84**, a saving of about 13%.
  Only about 8% of that ($0.22) is a reliable saving (a shorter answer); the rest is lower thinking,
  and that difference is inside the noise.
- The owner's theory did not hold. The model did not spend the freed space on the requested team.
  It returned 9 to 10 plays per window instead of about 20, and found about the same number of that
  team's highlights as the both-teams run (4 and 5 against 4 in window 600 to 900 s).
- Two new problems appeared. Six of the seven answers timed plays from the start of the window
  (00:06) instead of the file's clock (10:06). And two repeat runs disagreed about whether a goal
  was scored; in both cases the frames show no goal.
- Follow-up: both-teams analysis with the kit picture attached, filtered afterwards, was then
  tested with three calls. It kept the full play list and the right colour on `team_0`, but one
  call credited the play to the wrong teams. See the follow-up section near the end.
- Recommendation: do not switch to one-team mode. See the last section.

Ten model calls were made in all (seven one-team, three follow-up), which is the whole budget.
None failed, none was retried, no 429.

## The seven calls

Model `gemini-4-hydrogen`, default thinking, Interactions API, static 5-minute windows of
`videos/breakers-20min.mp4`. Cost is list price: $1.50 per 1M input, $7.50 per 1M answer and
thinking. Team A is navy blue, team B is white. "Rel 4-5" counts plays where the requested team's
relevance is 4 or 5. "Gap" is the window's end minus the end of the last play, after putting the
timestamps on the file's clock.

| Call | Team | Window (s) | Input | Answer | Thinking | Cost | Time | Plays | Rel 4-5 | Last play ends | Clock used | Gap | team_0 / team_1 as answered |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| teamA-300-600-run1 | A | 300-600 | 35,716 | 1,883 | 6,296 | $0.115 | 75 s | 10 | 4 | 09:59 | file | 1 s | navy blue / white and black |
| teamA-300-600-run2 | A | 300-600 | 35,716 | 1,657 | 10,764 | $0.147 | 84 s | 9 | 7 | 04:59 | window | 1 s | navy blue / white |
| teamA-600-900-run1 | A | 600-900 | 35,716 | 1,765 | 12,017 | $0.157 | 95 s | 9 | 4 | 04:06 | window | 54 s | navy blue / white |
| teamA-600-900-run2 | A | 600-900 | 35,716 | 1,609 | 8,041 | $0.126 | 75 s | 9 | 5 | 04:07 | window | 53 s | Navy blue / White |
| teamA-900-1200-run1 | A | 900-1200 | 35,716 | 1,563 | 9,957 | $0.140 | 79 s | 10 | 8 | 04:53 | window | 7 s | Navy blue / White |
| teamA-900-1200-run2 | A | 900-1200 | 35,716 | 1,596 | 10,256 | $0.142 | 84 s | 10 | 8 | 04:54 | window | 6 s | navy blue / white and black |
| teamB-600-900-run1 | B | 600-900 | 35,705 | 1,392 | 9,104 | $0.132 | 72 s | 8 | 6 | 04:07 | window | 53 s | White shirts with dark shoulder trim, navy blue shorts, dark socks / Navy blue |

Six team A calls, mean and range:

| | Mean | Range | Both-teams baseline |
|---|---|---|---|
| Input tokens | 35,716 | all the same | 34,463 |
| Answer tokens | 1,679 | 1,563 to 1,883 | 3,312 (one window) |
| Thinking tokens | 9,555 | 6,296 to 12,017 | 10,612 (5,565 to 18,913, 10 calls) |
| Cost per call | $0.138 | $0.115 to $0.157 | $0.16 |
| Wall time | 82 s | 75 to 95 s | 95 s |
| Plays | 9.5 | 9 to 10 | 19 |
| Plays at relevance 4 or 5 | 6.0 | 4 to 8 | 4 for navy in window 600-900 |

Other measurements:

- **Coverage.** Every call reached the last action in its window. The 53-second gap in window
  600 to 900 s is the walk back after the goal, which the baseline also scored 0. No call stopped early.
- **Input.** 1,253 more input tokens than the baseline call: 1,080 for the picture and 173 for the
  longer prompt.
- **Opponent kept out.** In all 65 plays `team_1` has relevance 0 and no players, and every play
  lists at least one player of the requested team. Reading the summaries, one play is really about
  the opponent: teamA-900-1200-run1 at 02:03 ("an opponent whips a deep cross ... the attacker
  heads over unchallenged behind our left-back", left-back listed with no tags).
- **Jersey numbers.** 0 numbered entries out of 118. The model did not copy the 2 or the 22 from the pictures.
- **No play was returned below relevance 2**, as the prompt asks.

## Both teams against one team, window 600 to 900 s

| | Both teams (baseline) | Team A run 1 | Team A run 2 | Team B |
|---|---|---|---|---|
| Input tokens | 34,463 | 35,716 | 35,716 | 35,705 |
| Answer tokens | 3,312 | 1,765 | 1,609 | 1,392 |
| Thinking tokens | 11,516 | 12,017 | 8,041 | 9,104 |
| Time | 95 s | 95 s | 75 s | 72 s |
| Cost | $0.16 | $0.157 | $0.126 | $0.132 |
| Plays | 19 | 9 | 9 | 8 |
| Highlights for the requested team | 4 navy, 6 white (8 plays in all) | 4 | 5 | 6 |
| Player entries for the requested team | 19 navy, 18 white | 19 | 16 | 15 |

The baseline already gave navy 12 plays at relevance 2 or more. One-team mode gave navy 9. So the
requested team got slightly fewer plays, not more.

Team A (navy) highlights. Times are on the file's clock; the one-team answers were shifted by 10:00.

| Baseline navy highlight | Run 1 | Run 2 |
|---|---|---|
| 10:12 to 10:25, long ball to the striker, shot wide (4) | reappears, 10:12 to 10:24 (4) | reappears, 10:12 to 10:24 (4) |
| 10:49 to 11:00, right winger's press wins the ball high (4) | missing as a highlight; the nearest plays, 10:47 to 10:56 and 10:57 to 11:13, are scored 3 and describe it differently | missing as a highlight; 10:57 to 11:13 is scored 3 |
| 11:58 to 12:12, midfield tackle and through ball, striker blocked (4) | reappears, 11:58 to 12:11 (4) | reappears, 11:58 to 12:11 (4) |
| 13:51 to 14:12, the goal (5) | reappears, 13:51 to 14:06 (5) | reappears, 13:51 to 14:07 (5) |
| New in one-team mode | 10:06 to 10:13, centre-back wins the ball in the box (baseline scored it 3) | the same 10:06 play, and 12:45 to 12:52, centre-back cuts out a cross (baseline scored it 3) |

So 3 of the 4 baseline navy highlights reappear in both runs, 1 drops to relevance 3 in both, and 1
to 2 plays the baseline scored 3 are raised to 4. Nothing appears that the baseline had not seen at all.

Team B (white): of the baseline's 6 white highlights, 5 reappear (the short-corner interception at
12:36 and the counter-attack at 12:41 are merged into one play). The goalkeeper's long kick at 11:13
is missing. Two plays the baseline scored 3 for white are raised to 4.

**Thinking tokens.** The six team A calls averaged 9,555 (6,296 to 12,017) against the baseline's
10,612 (5,565 to 18,913). The difference is 1,057 tokens, about 0.7 of its standard error. It is
not larger than the noise. One-team mode cannot be said to reduce thinking.

**Hand-marked annotations.** Skipped. The handoff points at `formal annotations\`, but nothing
there lines up with this 20-minute cut. The only candidate is a one-line note ("17:44 Goal") for a
Breakers game, with no team and no offset into the cut.

## Cost formula for one-team mode

    windows = minutes of video / 5, rounded up
    cost = $0.090 x number of windows + $0.0095 x minutes of video

| Tokens | Per window | Per second of video | Price per 1M | Against both-teams |
|---|---|---|---|---|
| Input: prompt, schema and kit picture | 3,954 (2,874 text, 1,080 picture) | none | $1.50 | 2,700 |
| Input: frames, timestamps, audio | none | 105.9 | $1.50 | same |
| Output: the JSON answer | 1,679 for a 5-minute window | not separable, only 5-minute windows were run | $7.50 | about 3,534 for a 5-minute window |
| Output: thinking | 9,555 (6,296 to 12,017, 6 calls) | none | $7.50 | 10,612 |

One 90-minute game, 18 calls:

| Mode | Cost | Likely range | Batch |
|---|---|---|---|
| Both teams (handoff) | $2.84 | $2.42 to $3.26 | $1.42 |
| One team, measured thinking | $2.48 | $2.22 to $2.74 | $1.24 |
| One team, if thinking is really unchanged at 10,612 | $2.62 | | $1.31 |

The saving is $0.36 a game (13%) as measured. Of that, $0.22 (8%) comes from the shorter answer
less the picture, and is reliable. The other $0.14 is lower thinking and may not be real. The two
ranges overlap. The answer term is fitted to 5-minute windows only, so a short last window is
slightly overpriced. Time per call was 82 s against about 98 s in the handoff's model.

## Did the kit picture pin the team

- **Yes, 7 of 7.** `team_0` was navy blue in all six team A answers, across three windows and both
  repeats, and white in the team B answer.
- **Team B's run returned team B's plays.** All 8 plays describe white players. It includes the
  goal white conceded at 13:51 as a relevance 5 lesson.
- The colour text is not stable: `team_1` was "white" four times and "white and black" twice, and
  team B's `team_0` colour repeated the full kit description from the prompt. Store the team by its
  slot, not by this string.
- The picture and the colour words were always sent together, so this run does not show which one
  did the work.

## What went wrong

1. **Timestamps changed clock.** Six of seven answers count MM:SS from the start of the window
   (00:06 to 04:07). One (teamA-300-600-run1) and the baseline use the file's clock (05:05 to
   09:59). The same prompt gave both in the same window. The cause is not known: the baseline
   prompt does not state a clock either, so the picture or the new wording may have tipped it.
   For any window after the first the two ranges cannot overlap, so the clock can be detected and
   corrected in code (`analyze_team_only.py` does this). A sentence in the prompt fixing the clock
   is the better fix and is untested.
2. **Repeat runs disagree on goals.** I checked frames every 2 seconds for both cases.
   - Window 300 to 600 s: run 1 reports a navy goal from a corner at 09:36 (relevance 5, tagged
     Goal and Assist). Run 2 says the goalkeeper smothered it. The frames show open play moving
     upfield from 09:46 with no kickoff, so there was no goal.
   - Window 900 to 1200 s: run 1 says the opponent scores at about 19:26. Run 2 says the navy
     goalkeeper saves. The frames show the goalkeeper holding the ball and kicking long at 19:38,
     so there was no goal.
   The baseline was never checked against the video, so this is not known to be worse in one-team
   mode. It does mean a Goal tag cannot be trusted from one call.
3. **Relevance is unstable between repeats.** Window 300 to 600 s gave 4 highlights in one run and
   7 in the other, from nearly the same moments. In window 900 to 1200 s, 8 of 10 plays are scored
   4 or 5.
4. **One baseline highlight was lost in both repeats** (the press at 10:49), and team B lost the
   goalkeeper's long kick. Both are the "less obvious" kind of highlight the product most wants.
5. Nothing stopped early, nothing came back empty, and no call needed a retry.

Not tested: one-team mode on a window with no picture, or with words only; a game where the two
kits are close in colour; a goalkeeper's highlights (the picture shows an outfield kit).

## The exact prompt and the schema

**Schema: unchanged.** `PLAY_BY_PLAY_SCHEMA` from `prompts.py` is sent as it is. `team_0` is the
reference team; `team_1` is the opponent, with its colour filled in and, in every play, relevance 0
and an empty players list. The stored format still holds a both-teams answer.

The request has three parts in this order: the video window, the kit picture (inline PNG), then the
text below. `{kit_words}` was "navy blue shirts, navy blue shorts, dark socks" for team A and "white
shirts with dark shoulder trim, navy blue shorts, dark socks" for team B. The authoritative copy is
`TEAM_ONLY_PLAY_BY_PLAY` in `team_only_prompts.py`.

```text
Analyze this game video for one team only: the team wearing the kit in the attached picture ({kit_words}). The picture shows one outfield player of that team, cropped from this same game. This team is "our team" below. Its goalkeeper wears a different colour but belongs to it. Ignore the particular player and the number in the picture; they only show the kit. Do not follow any single player.

Watch the whole video, from the first second to the last, and return, in order, only the plays worth our team reviewing. Leave out every passage where our team does nothing worth showing or learning from (stoppages, routine possession, spells where only the opponent does something of note).

A play is one continuous passage of the game: a possession, an attack, a set piece, a restart, a transition, or a defensive stand. Start a new play when possession changes or the ball goes dead.

The most important job is to catch every individual player highlight of our team. Players use these clips for college recruiting reels and social media, so a missed highlight is the worst mistake you can make here. A player highlight is any moment where one player does something worth showing: a goal, an assist, a shot on target, a key pass or through ball, a dribble that beats a defender, a skill move, a cross that creates a chance, a save, a tackle, an interception, a block, a header won, a recovery run that stops an attack, a strong piece of hold-up play. Rules for highlights:
- Look for them in every position of our team. Defenders and goalkeepers need highlights as much as attackers do.
- Give each highlight its own play entry; never bury it inside a longer passage. Set start a few seconds before the player's action begins and end just after its outcome is clear, so the clip can be cut straight from those timestamps.
- Give our team a relevance of 4 or 5 for the play.
- When you are unsure whether a moment is good enough, include it. An extra clip costs nothing; a missing one cannot be recovered.
- Before you finish, go back through the video once more looking only for our team's player highlights you may have skipped, especially away from the main attacking moves and near the end of the video.

Teams: team_0 is always our team, the one in the attached picture. team_1 is the opponent. Give each its kit colour. Use those same two teams for the whole answer.

Do not analyze the opponent. In every play set team_1 to relevance 0 with an empty players list. Never return a play only because of something the opponent did. The summary may mention the opponent only as far as needed to explain what our team's players did.

For each play give the start and end timestamps as MM:SS, a one-sentence summary, and then the team_0 section:

- relevance: 0 to 5, how much this play is worth our team reviewing, either as a highlight or as a lesson (0 = nothing to show or learn, 1 = routine, 2 = minor interest, 3 = worth a look, 4 = strong highlight or a clear lesson, 5 = must-see highlight or a key lesson). Plays that would score 0 or 1 are the ones to leave out.
- players: every player of our team who meaningfully takes part in the play, in order. For each player:
  - jersey_number: see the rule below
  - position: the player's position or role in this play (for example "right winger", "goalkeeper", "left centre-back"). Always fill this in; it is how the player is identified when there is no number.
  - tags: every tag from the list below that describes what this player did in this play. Tag every player in every play, not only the highlights. Use the exact tag names. A player can earn more than one tag in a play, and any player can earn any tag (a defender who scores gets "Goal"). Tag what the player attempted even when it did not come off; the execution score records how well it went. Use an empty list only when nothing on the list fits.
    - "Goal": all types of finishes in scoring situations, including shots that do not go in.
    - "Assist": the final pass that leads directly to a goal.
    - "Dribble": beating defenders in individual attacking duels.
    - "Pass": short, long, and line-breaking passes to advance play.
    - "Chance Creation": key passes that set up opportunities for teammates.
    - "Control": quick turnover play and composure under pressure.
    - "Tackle": defensive challenges that win the ball.
    - "Interception": reading and winning possession before the opponent.
    - "Build-Up": passes from the back that start attacks.
    - "Save": all goalkeeper shot-stopping and 1v1 saves.
    - "Distribution": goalkeeper throws and kicks that start attacks.
  - decision_score: 1 to 5, was it the right idea in that moment (1 = poor choice, 2 = questionable, 3 = reasonable, 4 = good, 5 = the best option available)
  - execution_score: 1 to 5, how well the player carried it out (1 = failed, 2 = poor, 3 = adequate, 4 = good, 5 = clean)
  - note: if this was a learning opportunity, the note is the lesson: say what the player should do next time. If this was a great play there is no lesson; use the note to compare the action to a famous player known for exactly that kind of play.

Jersey number rule: give a jersey number only when you can read the digits clearly on screen and have high confidence in them. In every other case set jersey_number to null and rely on position. Never guess, never infer a number from position, from an earlier play or from the attached picture, and never invent one. A null is correct; a wrong number is a serious error.
```

## Files added (nothing existing was changed, nothing committed)

- `team_only_prompts.py`: the prompt and the two kit descriptions.
- `run_team_only.py`: the runner (10-request cap, no retry on 429, 10-minute timeout).
- `analyze_team_only.py`: prints the table above from the saved answers.
- `team_only/kits/team_a_navy.png`, `team_b_white.png`: the kit crops, both from the frame at
  838 s (`source_frame_838s.png`). Each shows one outfield player from behind.
- `outputs/team_only/<call>.json` (raw answer), `<call>.usage.json` (usage and timing),
  `<call>.steps.json`, `attempts.json`; `outputs/team_only_run.log`.

## Follow-up: both teams with the kit picture attached, filtered afterwards

Three more calls (the last 3 of the 10-call budget; all succeeded first time). The prompt is the
existing both-teams prompt with one paragraph replaced, the team definition:

```text
First define the two teams by kit colour. team_0 is always the team wearing the kit in the attached picture ({kit_words}). The picture shows one outfield player of that team, cropped from this same game; it only shows the kit, so ignore the particular player and the number on the shirt. team_1 is the other team. Use those same two teams for the whole answer.
```

Schema unchanged. Runner: `run_pinned_both.py`. Answers: `outputs/pinned_both/`.

| Call | Picture | Window (s) | Input | Answer | Thinking | Cost | Time | Plays | Clock used | Gap to window end | team_0 as answered |
|---|---|---|---|---|---|---|---|---|---|---|---|
| pinnedA-600-900 | navy | 600-900 | 35,605 | 3,559 | 9,251 | $0.149 | 82 s | 18 | window | 0 s | navy blue |
| pinnedB-600-900 | white | 600-900 | 35,594 | 4,620 | 9,808 | $0.162 | 78 s | 22 | window | 0 s | white |
| pinnedA-300-600 | navy | 300-600 | 35,605 | 6,849 | 13,006 | $0.202 | 106 s | 24 | file | 1 s | navy blue |
| baseline, no picture | none | 600-900 | 34,463 | 3,312 | 11,516 | $0.16 | 95 s | 19 | file | 1 s | navy blue |

What it shows:

- **The label is pinned, 3 of 3.** `team_0` carried the pictured team's colour every time, and the
  white picture flipped `team_0` to white.
- **The full play list is kept:** 18 to 24 plays covering the whole window, against 9 to 10 in
  one-team mode.
- **Filtering to the parent's team gives about what one-team mode gave** in window 600 to 900 s.
  Navy: 3 of the 4 baseline highlights reappear, the press at 10:49 is again scored below 4, and 1
  play is raised to 4. White: 4 of the 6 baseline highlights reappear, 2 are missing as highlights
  (the goalkeeper's long kick, and the short-corner interception now scored 3), 2 are new.
- **It is not cheaper.** Mean $0.171 a call against $0.158 in the handoff's model, which would put
  a 90-minute game near $3.08. Three calls are too few to fit a formula; the picture itself adds
  about 1,140 input tokens a call, roughly $0.03 a game, and the rest is noise in answer length
  and thinking.
- **The clock problem follows the picture.** Two of three answers count from the start of the
  window. Across both experiments, 8 of 10 calls with a picture used the window's clock; the one
  baseline window call without a picture used the file's clock.
- **One call attributed the play to the wrong teams.** pinnedA-300-600 names `team_0` navy
  correctly but describes the window with the teams swapped. It has white attacking and taking the
  corners at 07:38 and 09:33, and white scoring from the second one. Both one-team runs of the same
  window have navy attacking at those moments, and the frames agree with them: the goal being
  attacked is defended by the goalkeeper in pink, who is in the goal navy scores into at 13:58.
  The frames also show no goal at 09:33 (open play continues, no kickoff). A parent of the navy
  team filtering this answer would get navy "highlights" that are really white's defending.
  Whether the picture caused this is unknown: there is no both-teams run of this window without one.

## Recommendation

Do not switch the product to one-team analysis, and do not treat the kit picture as having solved
team identity. One-team mode saves little (about $0.22 to $0.36 on a $2.84 game) and gives the
requested team no more plays or highlights; it wrote half as many plays and lost one baseline
highlight in each comparison. Both-teams analysis with the picture attached keeps the full play
list and put the right colour on `team_0` in 3 of 3 calls, and filtering it afterwards returns
about the same highlights as one-team mode while keeping the other team's plays for a second
parent. But in 1 of those 3 calls the colour label was right and the actions were credited to the
wrong teams, so a pinned label is not proof the answer is about the right team. Of the two, the
pinned both-teams mode is the better direction, at slightly higher cost than today. Before it
ships it needs three things this run could not provide: a sentence in the prompt fixing the
timestamp clock (8 of 10 calls with a picture changed it), a check of team attribution against
the video over more windows, and a check of goals, since three answers here reported a goal that
did not happen.

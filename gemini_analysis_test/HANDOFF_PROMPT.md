## What we already learned from the Gemini prototype (measured 2026-11-12)

A working prototype lives in `C:\Users\imank\projects\video-editor\gemini_analysis_test\`.
Read it before writing anything; it already exercises the API end to end.

### The owner's goal
Take a full soccer game video (about 90 minutes, about 2 to 3 GB, 1080p, wide sideline
camera) and produce a complete play-by-play as JSON. **The top priority is that no
individual player highlight is missed**: players use these clips for college recruiting
reels and social media. A missed highlight is a worse failure than an extra one. Every
player action is also tagged with the app's existing soccer tags and scored.

### Decisions already made by the owner
- Model: `gemini-4-hydrogen` at its default thinking level. This is final; do not
  evaluate other models, thinking levels or processing modes.
- Output: the JSON Schema at the end of this document.
- Jersey numbers only at high confidence, otherwise null with the position as fallback.

### The design (decided by the owner, supported by the measurements)
Upload the game once, then analyze it as consecutive 5-minute windows in static mode
through the Interactions API, using `start_offset` / `end_offset` on the uploaded file.
Run the windows in parallel. Leave the thinking level unset (the model's default).
Validate every window's coverage.
Reasons, each measured:
- Static windows of 5 minutes covered the whole window (19 to 22 plays each).
- One static call on a 20-minute video wrote 25 plays, stopped at 05:18 and reported
  success. Static mode does not cover long videos in one call; it silently stops.
- Offsets work and need no file cutting: a 600 s to 900 s window of an uploaded 20-minute
  file was billed for 300 s only (34,463 input tokens) and returned timestamps on the
  uploaded file's own clock (10:00 to 14:59). No offset arithmetic is needed.

### Code to read
- `run_interactions.py`: the Interactions API runner. Run it with `--processing static`
  and an optional `--start/--end` window; it requests JSON Schema output and captures
  usage. This is the closest thing to production code. Its other options are not part of
  the chosen design; leave them unset.
- `run_analysis.py`: the older `generate_content` runner (same static processing).
  Holds the shared upload, retry and save helpers.
- `prompts.py`: the model prompt (`PLAY_BY_PLAY`), the tag list (`TAGS`), the rating scales
  and the JSON Schema (`PLAY_BY_PLAY_SCHEMA`). Single source of truth.
- `estimate_cost.py`: the cost and time model below, runnable
  (`--minutes 90 --gb 2`; the defaults are the chosen design).
- `pricing.py`: paid list prices.
- Real answers, with token usage in each folder's `results.json`, all under `outputs\`:
  `playbyplay\default\*__gemini-4-hydrogen.json` (the 5-minute and 89-second clips),
  `interactions\static-default-600-900\` (one window of the 20-minute file) and
  `interactions\static-default\` (the 20-minute file in one call, which stopped early).
- The key is in `.env` as `GEMINI_API_KEY` (git-ignored). Never print or commit it.
- Test videos: `..\formal annotations\test.short\staging-verification-fixture-5min.mp4`
  (301 s, audio), `..\formal annotations\test.short\wcfc-carlsbad-trimmed.mp4` (89 s, no
  audio), `videos\breakers-20min.mp4` (20 minutes cut from a real game, audio). Full games
  are under `..\formal annotations\`.
- The app's tag definitions: `src\frontend\src\modes\annotate\constants\soccerTags.js`.

### API facts (python `google-genai` 3.2.0)
- Create the client with `api_version="v1beta"`. On the default version model listing
  returned 403 and current model ids returned 404.
- Upload with `client.files.upload`, poll `client.files.get` until the state leaves
  PROCESSING. Files expire after 48 hours; storage is not billed. Per the docs the limit is
  2 GB per file on the free tier and 20 GB on paid, so a full game needs a paid key.
- Interactions call shape:
  `client.interactions.create(model=..., input=[{"type": "video", "uri": file.uri,
  "mime_type": file.mime_type, "processing": ...}, {"type": "text", "text": prompt}],
  response_format={"type": "text", "mime_type": "application/json", "schema": <JSON Schema>})`.
  Pass no thinking setting, so the model uses its default.
- `processing` is `"static"` for the whole file, or
  `{"type": "static", "start_offset": "600s", "end_offset": "900s"}` for one window.
  The optional `fps` field and the per-video `resolution` setting are untested.
- Usage is on `interaction.usage`: `total_input_tokens`, `total_output_tokens` (the
  answer), `total_thought_tokens`, plus per-modality lists. The answer text is
  `interaction.output_text`.
- The schema is standard JSON Schema. `minimum`, `maximum`, `enum` and nullable types were
  accepted, and no rating in any answer fell outside its range.
- Set a timeout. Without one a `generate_content` call hung for over 20 minutes.
- Retry on 503 UNAVAILABLE ("high demand", seen often) and on 403 SERVICE_DISABLED (seen
  intermittently on this project, passes on retry). Do not retry 429.
- The current key is on the free tier: 20 requests per day for this model, and failed attempts
  appeared to count. Billing must be enabled on the Google project before more testing.
- Limits for `gemini-4-hydrogen`: 1,048,576 input tokens, 65,536 output tokens.

### Every run with the final prompt and tags (static processing, default thinking)
Costs are paid list prices applied to measured tokens: $1.50 per 1M input, $7.50 per 1M
output, thinking billed as output. Batch is half price. A "highlight" here means a play
where either team's relevance is 4 or 5.

| Run | Video | Input tokens | Answer tokens | Thinking tokens | Time | Cost | Plays | Highlights | Player entries |
|---|---|---|---|---|---|---|---|---|---|
| whole clip (via `generate_content`) | 5 min | 33,707 | 3,769 | 5,565 | 67 s | $0.12 | 22 | 9 | 44 |
| whole clip (via `generate_content`) | 89 s, no audio | 8,602 | 1,895 | 18,913 | 105 s | $0.17 | 11 | 5 | 22 |
| window 600 to 900 s (Interactions API) | 5 of 20 min | 34,463 | 3,312 | 11,516 | 95 s | $0.16 | 19 | 8 | 37 |
| whole file in one call (Interactions API) | 20 min | 128,981 | 4,057 | 11,129 | 106 s | $0.31 | 25, stopped at 05:18 | 11 | 47 |

What these show:
- **Thinking is a flat cost per call, unrelated to video length.** Across the 10 calls
  measured during prototyping (the four above included) it averaged 10,612 tokens (5,565 to 18,913). It is about
  two thirds of the cost of a 5-minute call. So fewer, longer calls would be cheaper, but
  calls longer than 5 minutes lose coverage.
- **A call writes about 19 to 25 plays for 5 minutes or more of video and then stops**,
  whatever the video length.
- **Jersey numbers are almost never readable** from this camera: 0 to 3 numbered entries
  per run, out of 22 to 47. Players are identified by team colour and position.
- Nobody has checked any answer against the video. Play counts, tags, scores and
  timestamps are unverified, and recall of highlights has not been measured.

### Cost and time model (gemini-4-hydrogen, default thinking, 5-minute windows)
File size never affects cost; Gemini bills by video length. Size only affects upload time.

    windows = minutes of video / 5, rounded up
    cost = $0.093 x number of windows + $0.0130 x minutes of video
           ($0.0103 per minute when the file has no audio track; batch API is half price)
    time = 84 s x windows + 2.9 s x minutes, one call after another
           about 150 s in total with all windows in parallel

| Tokens | Per window | Per second of video | Price per 1M |
|---|---|---|---|
| Input: prompt and schema | 2,700 | none | $1.50 |
| Input: frames and timestamps | none | 75.6 | $1.50 |
| Input: audio, if present | none | 30.3 | $1.50 |
| Output: the JSON answer | 1,200 | 7.78 | $7.50 |
| Output: thinking | 10,612 (5,565 to 18,913) | none | $7.50 |

One 90-minute, 2 GB game:

| Calls | Cost | Likely range | Batch | Time, calls in sequence | Time, calls in parallel |
|---|---|---|---|---|---|
| 18 | $2.84 | $2.42 to $3.26 | $1.42 | about 30 min | about 2.5 min |

Before analysis can start: uploading 2 GB took about 3.9 minutes per GB from the owner's
machine (about 8 minutes), and Google then prepares the file (about 0.065 s per second of
video on short clips, so roughly 6 minutes for a game; not measured at that length).
All times come from a free-tier key and were noisy; re-measure on a paid key.

### Problems the production design must solve (none solved in the prototype)
- **Coverage check.** After every call compare the last play's `end` with the window's end
  and re-request the uncovered remainder. A call can stop early without any error.
- **Window boundaries.** A play can straddle two windows. Overlapping windows and merging
  duplicate plays is untested.
- **Team identity.** The model picks which colour is `team_0` independently in every call.
  Fix the two colours in the prompt for every window after the first.
- **Linking highlights to a named player.** With jersey numbers mostly null, a highlight
  is known only by team colour and position. This needs a product answer (roster, user
  confirmation, or a higher-resolution pass over the highlight only).
- **Highlight recall.** Compare the output with a hand-marked list of highlights for at
  least one game before trusting it. The repo holds human annotations under
  `formal annotations\` that may serve.
- **Empty answers.** On an earlier schema one call returned an empty `plays` list. Treat
  an empty or implausibly short answer as a failure and retry.
- **Untested levers:** shorter windows (2 to 3 minutes) for more
  detail, `fps` above 1 for fast action, `resolution="high"` for jersey numbers (about 4x
  the video tokens), the batch API, and paid-tier rate limits for 18 parallel calls.

### Output format: the JSON Schema (authoritative copy: `PLAY_BY_PLAY_SCHEMA` in `prompts.py`)

Every rating carries its `minimum`, `maximum` and the meaning of each value in its
`description`, so the schema alone says how strong a rating is. Three scales:
team `relevance` 0 to 5, player `decision_score` 1 to 5, player `execution_score` 1 to 5.
Tag names are the app's stored values (the app displays `Save` as "Keeper Save").
`start` and `end` are MM:SS on the uploaded file's clock, also when a window is analyzed.

```json
{
  "type": "object",
  "properties": {
    "teams": {
      "type": "object",
      "properties": {
        "team_0": {
          "type": "object",
          "properties": {
            "color": {
              "type": "string",
              "description": "Kit colour that identifies this team."
            }
          },
          "required": [
            "color"
          ]
        },
        "team_1": {
          "type": "object",
          "properties": {
            "color": {
              "type": "string",
              "description": "Kit colour that identifies this team."
            }
          },
          "required": [
            "color"
          ]
        }
      },
      "required": [
        "team_0",
        "team_1"
      ]
    },
    "plays": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "start": {
            "type": "string",
            "description": "MM:SS from the start of the video sent."
          },
          "end": {
            "type": "string",
            "description": "MM:SS from the start of the video sent."
          },
          "summary": {
            "type": "string"
          },
          "team_0": {
            "type": "object",
            "properties": {
              "relevance": {
                "type": "integer",
                "minimum": 0,
                "maximum": 5,
                "description": "How much this play is worth this team reviewing, as a highlight or a lesson. Scale 0 to 5 (maximum 5): 0 = nothing to show or learn; 1 = routine play, no review value; 2 = minor interest; 3 = worth a look; 4 = strong highlight or a clear lesson; 5 = must-see highlight or a key lesson."
              },
              "players": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "jersey_number": {
                      "type": [
                        "integer",
                        "null"
                      ],
                      "description": "Only when the digits are clearly readable with high confidence; otherwise null. Never guessed."
                    },
                    "position": {
                      "type": "string",
                      "description": "Position or role in this play; identifies the player when jersey_number is null."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "enum": [
                          "Goal",
                          "Assist",
                          "Dribble",
                          "Pass",
                          "Chance Creation",
                          "Control",
                          "Tackle",
                          "Interception",
                          "Build-Up",
                          "Save",
                          "Distribution"
                        ]
                      },
                      "description": "Every tag that describes what this player did in this play; empty only when none fits."
                    },
                    "decision_score": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 5,
                      "description": "Was it the right idea in that moment. Scale 1 to 5 (maximum 5): 1 = poor choice, clearly better options were available; 2 = questionable choice; 3 = reasonable, standard choice; 4 = good choice; 5 = the best option available."
                    },
                    "execution_score": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 5,
                      "description": "How well the player carried it out. Scale 1 to 5 (maximum 5): 1 = failed; 2 = poor, mostly did not come off; 3 = adequate; 4 = good; 5 = clean, could not be done better."
                    },
                    "note": {
                      "type": "string",
                      "description": "The lesson when this was a learning opportunity; for a great play, a comparison to a famous player."
                    }
                  },
                  "required": [
                    "jersey_number",
                    "position",
                    "tags",
                    "decision_score",
                    "execution_score",
                    "note"
                  ]
                }
              }
            },
            "required": [
              "relevance",
              "players"
            ]
          },
          "team_1": {
            "type": "object",
            "properties": {
              "relevance": {
                "type": "integer",
                "minimum": 0,
                "maximum": 5,
                "description": "How much this play is worth this team reviewing, as a highlight or a lesson. Scale 0 to 5 (maximum 5): 0 = nothing to show or learn; 1 = routine play, no review value; 2 = minor interest; 3 = worth a look; 4 = strong highlight or a clear lesson; 5 = must-see highlight or a key lesson."
              },
              "players": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "jersey_number": {
                      "type": [
                        "integer",
                        "null"
                      ],
                      "description": "Only when the digits are clearly readable with high confidence; otherwise null. Never guessed."
                    },
                    "position": {
                      "type": "string",
                      "description": "Position or role in this play; identifies the player when jersey_number is null."
                    },
                    "tags": {
                      "type": "array",
                      "items": {
                        "type": "string",
                        "enum": [
                          "Goal",
                          "Assist",
                          "Dribble",
                          "Pass",
                          "Chance Creation",
                          "Control",
                          "Tackle",
                          "Interception",
                          "Build-Up",
                          "Save",
                          "Distribution"
                        ]
                      },
                      "description": "Every tag that describes what this player did in this play; empty only when none fits."
                    },
                    "decision_score": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 5,
                      "description": "Was it the right idea in that moment. Scale 1 to 5 (maximum 5): 1 = poor choice, clearly better options were available; 2 = questionable choice; 3 = reasonable, standard choice; 4 = good choice; 5 = the best option available."
                    },
                    "execution_score": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 5,
                      "description": "How well the player carried it out. Scale 1 to 5 (maximum 5): 1 = failed; 2 = poor, mostly did not come off; 3 = adequate; 4 = good; 5 = clean, could not be done better."
                    },
                    "note": {
                      "type": "string",
                      "description": "The lesson when this was a learning opportunity; for a great play, a comparison to a famous player."
                    }
                  },
                  "required": [
                    "jersey_number",
                    "position",
                    "tags",
                    "decision_score",
                    "execution_score",
                    "note"
                  ]
                }
              }
            },
            "required": [
              "relevance",
              "players"
            ]
          }
        },
        "required": [
          "start",
          "end",
          "summary",
          "team_0",
          "team_1"
        ]
      }
    }
  },
  "required": [
    "teams",
    "plays"
  ]
}
```

### The model prompt that produced these results (authoritative copy: `PLAY_BY_PLAY` in `prompts.py`)

```text
Analyze this game video and write a complete play-by-play of the whole video, from the first second to the last, in order, with no gaps.

A play is one continuous passage of the game: a possession, an attack, a set piece, a restart, a transition, or a defensive stand. Start a new play when possession changes or the ball goes dead.

The most important job is to catch every individual player highlight. Players use these clips for college recruiting reels and social media, so a missed highlight is the worst mistake you can make here. A player highlight is any moment where one player does something worth showing: a goal, an assist, a shot on target, a key pass or through ball, a dribble that beats a defender, a skill move, a cross that creates a chance, a save, a tackle, an interception, a block, a header won, a recovery run that stops an attack, a strong piece of hold-up play. Rules for highlights:
- Look for them on both teams and in every position. Defenders and goalkeepers need highlights as much as attackers do.
- Give each highlight its own play entry; never bury it inside a longer passage. Set start a few seconds before the player's action begins and end just after its outcome is clear, so the clip can be cut straight from those timestamps.
- Give that player's team a relevance of 4 or 5 for the play.
- When you are unsure whether a moment is good enough, include it. An extra clip costs nothing; a missing one cannot be recovered.
- Before you finish, go back through the video once more looking only for player highlights you may have skipped, especially away from the main attacking moves.

First define the two teams by kit colour: team_0 and team_1. Use those same two teams for the whole answer.

For each play give the start and end timestamps as MM:SS, a one-sentence summary, and then a section for each team (team_0 and team_1). In each team's section give:

- relevance: 0 to 5, how much this play is worth that team reviewing, either as a highlight or as a lesson (0 = nothing to show or learn, 1 = routine, 2 = minor interest, 3 = worth a look, 4 = strong highlight or a clear lesson, 5 = must-see highlight or a key lesson). Score each team on its own; one play can be a 5 for both.
- players: every player of that team who meaningfully takes part in the play, in order. An empty list is fine when the team has no meaningful part. For each player:
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

Jersey number rule: give a jersey number only when you can read the digits clearly on screen and have high confidence in them. In every other case set jersey_number to null and rely on position. Never guess, never infer a number from position or from an earlier play, and never invent one. A null is correct; a wrong number is a serious error.
```

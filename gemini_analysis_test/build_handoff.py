"""Write HANDOFF_PROMPT.md: what the prototype learned, for the AI that will build the product.

Usage: .venv/Scripts/python build_handoff.py
The JSON Schema and the model prompt are pulled from prompts.py so the document cannot drift
from the code. The findings text below is hand-written; update it when new runs change it.
"""
import json
from pathlib import Path

from prompts import PLAY_BY_PLAY, PLAY_BY_PLAY_SCHEMA

HERE = Path(__file__).parent

FINDINGS = r"""## What we already learned from the Gemini prototype (measured 2026-11-12)

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
"""


def main():
    doc = [
        FINDINGS.strip(), "",
        "### Output format: the JSON Schema (authoritative copy: `PLAY_BY_PLAY_SCHEMA` in `prompts.py`)", "",
        "Every rating carries its `minimum`, `maximum` and the meaning of each value in its",
        "`description`, so the schema alone says how strong a rating is. Three scales:",
        "team `relevance` 0 to 5, player `decision_score` 1 to 5, player `execution_score` 1 to 5.",
        "Tag names are the app's stored values (the app displays `Save` as \"Keeper Save\").",
        "`start` and `end` are MM:SS on the uploaded file's clock, also when a window is analyzed.", "",
        "```json", json.dumps(PLAY_BY_PLAY_SCHEMA, indent=2), "```", "",
        "### The model prompt that produced these results (authoritative copy: `PLAY_BY_PLAY` in `prompts.py`)", "",
        "```text", PLAY_BY_PLAY, "```", "",
    ]
    out = HERE / "HANDOFF_PROMPT.md"
    out.write_text("\n".join(doc), encoding="utf-8")
    print(f"wrote {out} ({len(out.read_text(encoding='utf-8')):,} characters)")


if __name__ == "__main__":
    main()

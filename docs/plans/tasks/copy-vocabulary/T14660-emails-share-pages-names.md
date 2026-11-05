# T14660: Emails, share pages and server-made names

**Status:** WIP
**Impact:** 6
**Complexity:** 4
**Created:** 2026-11-03
**Updated:** 2026-11-03

## Problem

- **Emails** (`src/backend/app/services/email.py`) use five nouns for shares: "shared a highlight"
  with a footer saying "shared a video", "shared game footage" with heading "a game", "shared game
  annotations" / "Watch Annotations", "shared game highlights", "tagged {tag} in a highlight". CTAs
  are Title Case ("Watch Highlights", "Start Making Highlights", "View Game"). The game-ready email
  says "start making highlights" where the next step is marking plays. The welcome email says
  "game film". The footer says "soccer parents" though the product covers 11 sports.
- **Share and unfurl pages** (`src/frontend/functions/shared/**`) use four description formats,
  mix " -- " and " - ", say "team recap", "Shared Video", "Shared Game", the wordmark
  "REEL BALLERS", and "Make your own free" (the product is credits, not free).
- **Server-made names**: "Clip {id}" and "Game {id}" (expose internal ids), "Untitled Highlight"
  for an unnamed play, "Mixes", "Top Plays", "{Game} Game Highlights - Portrait (2:30)",
  download file names `Mixes.mp4`, `Game_Highlights.mp4`, `video_ReelBallers.mp4`.

Task 7 of 8 in the [Copy Vocabulary epic](EPIC.md). Read EPIC.md for the glossary, verbs and
style rules. Rating words in names were removed by T14550; server error text by T14540.

## Solution

- Emails: one scheme. "{name} shared a highlight with you" / "shared a game with you" / "shared
  the plays they marked from {game}" / "shared a highlight reel with you"; CTAs sentence case
  ("Watch highlight", "Watch game", "Watch plays"); game-ready "Your game is ready: start marking
  plays" with CTA "Mark plays"; "game video" not "game film"; "sports parents".
- Share pages: one description template, e.g. "{title}: shared from ReelBallers. Make your own
  highlights, free to start."; "game plays" instead of team recap; "ReelBallers" wordmark;
  fallbacks "Highlight shared on ReelBallers".
- Names: "Play at {m:ss}", "Game on {date}", "My highlights" instead of Mixes / Top Plays;
  collection titles "{Game}: highlights"; every download file `{Title}_ReelBallers.mp4` with
  fallback `highlight_ReelBallers.mp4`. Portrait/Landscape wording is NOT decided; leave it.

## Context

### Relevant Files
- `src/backend/app/services/email.py`, `src/backend/app/routers/email_subscription.py`
- `src/frontend/functions/shared/[token].js`, `functions/shared/game/[token].js`, `functions/shared/collection/**`, `functions/shared/teammate/**`
- `src/backend/app/routers/clips.py` (default names ~1200, ~3541), `collections.py` (~474, 840-846, 1495-1510), `downloads.py` (~430, 687-694)

Findings with lines: [audit/E-landing-backend.md](audit/E-landing-backend.md) D1-D11, E1-E6, G1-G3.

### Technical Notes
- **Persisted names:** check whether default names ("Clip {id}", "Untitled Highlight", collection titles) are stored or computed on read. Stored defaults keep their old text unless migrated; ask the user before adding a migration (same rule as T14550).
- Never send real email from tests; render the HTML in tests instead.
- Share pages run on Cloudflare Pages Functions; test with the existing functions tests if present.

### Persisted vs computed (checked 2026-11-04)

No migration was added; existing rows keep their old text until the user decides.

| Default name | Where it lives | Effect of this task |
|---|---|---|
| "Clip {id}" | STORED in `projects.name` at project creation, reachable when a play has no tags, notes or time (`raw_clips.start_time` is nullable) | New projects read "Play". Existing rows keep "Clip {id}". |
| "Untitled Highlight" | STORED in the share row `clip_names` (Postgres) | New teammate shares read "Play at m:ss". Existing shares keep it. |
| "{Game} Game Highlights - Portrait", "Top Plays - ...", "Mixes - ..." | STORED, frozen in `collection_definition.title` (Postgres) and part of link identity | New links use the new title. Existing links keep theirs, and re-sharing an unchanged collection makes a new link once, because `find_collection_share` compares the whole definition. |
| "Top Plays" card name | COMPUTED on read (`TOP_PLAYS`) | Changes everywhere at once. `key` stays `top_plays`. |
| "Game {id}" | COMPUTED on read, unless frozen in a collection title as above | Changes at once. |
| Download file names, embedded video titles | COMPUTED per download | Change at once. |

## Implementation

1. [x] Persisted vs computed check for each default name; record in this file
2. [x] Failing tests: share email subject/footer use one noun; game share page description template; default play name for an unnamed play
3. [x] Change emails, share pages and name builders
4. [x] Relevant backend + functions tests, ruff, lint

## Acceptance Criteria

- [x] Every share email uses one noun throughout (subject, heading, CTA, footer)
- [x] One share-page description format; "ReelBallers" wordmark
- [x] No server-made name exposes an internal id or uses Mixes / Top Plays / annotations / clip
- [x] Tests pass
